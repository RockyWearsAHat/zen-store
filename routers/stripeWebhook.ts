import { Router, Request, Response } from "express";
import Stripe from "stripe";
import { sendSuccessEmail, sendFailureEmail } from "./email.js";
import { createAliExpressOrder } from "./aliexpress"; // ← NEW

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// Only apply basic JSON parsing to the webhook route
router.post("/", async (req: Request, res: Response): Promise<void> => {
  try {
    /* ---------- resolve Stripe.Event ---------- */
    const sig = req.headers["stripe-signature"] as string | undefined;
    const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim() || "";

    let event: Stripe.Event;
    if (sig && secret) {
      // preferred – signature check
      event = stripe.webhooks.constructEvent(req.body, sig, secret);
    } else {
      // fallback – already-JSON (test / missing secret)
      event = JSON.parse(
        Buffer.isBuffer(req.body)
          ? req.body.toString("utf8")
          : (req.body as any)
      );
    }

    console.log("[stripeWebhook] ↪ event:", event.type, event.id);

    /* ---------- handle payment_intent.succeeded ---------- */
    if (event.type === "payment_intent.succeeded") {
      const base = event.data.object as Stripe.PaymentIntent;

      // fully expanded PI
      const intent = (await stripe.paymentIntents.retrieve(base.id, {
        expand: ["latest_charge.balance_transaction", "payment_method"],
      })) as Stripe.PaymentIntent;

      /* ---------- derive charge / pm / e-mail once ---------- */
      const charge = intent.latest_charge as Stripe.Charge | undefined;
      let paymentMethod: Stripe.PaymentMethod | null = null;
      if (typeof intent.payment_method === "string") {
        paymentMethod = await stripe.paymentMethods.retrieve(
          intent.payment_method
        );
      } else {
        paymentMethod = intent.payment_method as Stripe.PaymentMethod;
      }
      const email =
        intent.receipt_email ||
        charge?.billing_details?.email ||
        paymentMethod?.billing_details?.email ||
        null;

      /* ---------- create AliExpress order ---------- */
      // let aliCost = 0;

      try {
        /* ---------- build AliExpress payload from PI metadata ---------- */
        const raw = JSON.parse(intent.metadata.items ?? "[]");
        const itemsForAli = raw.map((i: any) => ({
          id: i.aliId,
          quantity:
            process.env.ALI_TEST_ENVIRONMENT === "true" ? 0 : i.quantity,
          sku_attr: i.sku_attr ?? "",
        }));

        // build shipping object
        const shippingMeta = intent.metadata.shipping
          ? JSON.parse(intent.metadata.shipping)
          : null;

        const stripeShip =
          intent.shipping as Stripe.PaymentIntent.Shipping | null;

        const shipping =
          shippingMeta ||
          (stripeShip?.address
            ? {
                address: stripeShip.address.line1,
                address2: stripeShip.address.line2 ?? "",
                city: stripeShip.address.city ?? "",
                contact_person: stripeShip.name ?? "",
                country: stripeShip.address.country ?? "",
                mobile_no: stripeShip.phone ?? "",
                phone_country: "+", // Stripe phone is full; keep “+” for now
                phone_number: stripeShip.phone ?? "",
                province: stripeShip.address.state ?? "",
                zip: stripeShip.address.postal_code ?? "",
              }
            : null);

        if (!shipping) {
          console.error("❌ AliExpress order skipped – no shipping address");
          return;
        }

        /* ---------- place the order ---------- */
        let orderId: string | null = null;
        let trackingNumber: string | null = null;
        try {
          const ali = await createAliExpressOrder(
            itemsForAli,
            shipping,
            intent.metadata.order_number
          );
          orderId = ali.orderId;
          trackingNumber = ali.trackingNumber;

          await stripe.paymentIntents.update(intent.id, {
            metadata: {
              ali_order_id: orderId,
              ali_tracking: trackingNumber,
              ali_cost_usd: ali.orderCost ?? "",
            },
          });
          console.log("📦 AliExpress order placed:", orderId);
        } catch (err) {
          console.error("AliExpress order failed:", err);
        }

        /* ---------- e-mail ---------- */
        if (orderId && email) {
          await sendSuccessEmail(
            intent,
            email,
            charge,
            paymentMethod // ← removed trackingNumber argument
          );
        } else if (!orderId) {
          console.warn("Skipping success email – AliExpress order not created");
        } else {
          console.warn("Skipping success email – no e-mail address found");
        }
      } catch (err) {
        console.error("AliExpress order failed (immediate):", err);
      }

      await createPayoutForIntent(intent); // ← payout after order

      // ─── derive brand / last4 for console log ───
      let brand: string | undefined;
      let last4: string | undefined;
      if (paymentMethod?.type === "card" && paymentMethod.card) {
        brand = paymentMethod.card.brand;
        last4 = paymentMethod.card.last4;
      }

      console.log(
        "✅ payment_intent.succeeded:",
        intent.id,
        email,
        brand,
        last4
      );
    }

    /* ---------- handle payment_intent.payment_failed ---------- */
    if (event.type === "payment_intent.payment_failed") {
      const intent = event.data.object as Stripe.PaymentIntent;

      const email = await pickEmail(stripe, intent); // ← updated lookup

      console.log("❌ payment_intent.payment_failed:", intent.id, email ?? "—");

      if (email) {
        sendFailureEmail(intent, email).catch(console.error);
      } else {
        console.warn("No e-mail found on failed payment", intent.id);
      }
    }

    res.json({ received: true });
  } catch (err: any) {
    console.error("[stripeWebhook] fatal", err);
    res.status(400).send("Webhook processing error");
  }
});

/* ---------- shared helper to create / retry a payout ---------- */
const createPayoutForIntent = async (intent: Stripe.PaymentIntent) => {
  // 1) payout amount derives purely from stored metadata
  const subtotalUsd = Number(intent.metadata?.subtotal ?? 0);
  const taxUsd = Number(intent.metadata?.tax ?? 0);

  const netForPayout = Math.floor((subtotalUsd + taxUsd) * 100); // cents

  if (netForPayout <= 0) {
    console.warn("Computed payout is ≤ 0 for", intent.id);
    return false;
  }

  // 2) ensure funds are available in the same currency
  const balance = await stripe.balance.retrieve();
  const avail =
    balance.available.find((b) => b.currency === intent.currency)?.amount ?? 0;

  if (avail < netForPayout) {
    await stripe.paymentIntents.update(intent.id, {
      metadata: {
        payout_status: "incomplete_insufficient_funds",
        expected_payout_cents: netForPayout,
      },
    });
    console.warn("Insufficient funds – payout deferred for", intent.id);
    return false;
  }

  // 3) create the payout, linking back to the PI
  const payout = await stripe.payouts.create({
    amount: netForPayout,
    currency: intent.currency,
    statement_descriptor: "Dropship profit",
    metadata: {
      payment_intent_id: intent.id,
      order_number: intent.metadata?.order_number ?? intent.id,
    },
  });

  await stripe.paymentIntents.update(intent.id, {
    metadata: {
      payout_id: payout.id,
      expected_payout_cents: netForPayout,
      payout_status: "pending",
    },
  });

  console.log("💸 payout created:", payout.id, "for PI:", intent.id);
  return true;
};

/* ---------- helper: try every place an email can live ---------- */
const pickEmail = async (
  stripe: Stripe,
  intent: Stripe.PaymentIntent
): Promise<string | null> => {
  if (intent.receipt_email) return intent.receipt_email;

  /* 1) try attached customer object */
  if (intent.customer && typeof intent.customer === "string") {
    const customer = await stripe.customers.retrieve(intent.customer);
    if (!("deleted" in customer) && customer.email) return customer.email;
  }

  /* 2) try payment_method billing details */
  let pm: Stripe.PaymentMethod | null = null;
  if (typeof intent.payment_method === "string") {
    pm = await stripe.paymentMethods.retrieve(intent.payment_method);
  } else if (intent.payment_method) {
    pm = intent.payment_method as Stripe.PaymentMethod;
  }
  if (pm?.billing_details?.email) return pm.billing_details.email;

  /* 3) iterate over charges for a billing e-mail */
  const charges = (intent as any).charges?.data as Stripe.Charge[] | undefined;
  for (const c of charges ?? []) {
    const e = c.billing_details?.email;
    if (e) return e;
  }

  return null;
};

/* ─── exports ──────────────────────────────────────────────── */
export { router as stripeWebhookRouter };
