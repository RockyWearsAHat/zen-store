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

      // fully expanded PI (latest_charge + balance_tx)
      const intent = (await stripe.paymentIntents.retrieve(base.id, {
        expand: ["latest_charge.balance_transaction", "payment_method"],
      })) as Stripe.PaymentIntent;

      // ---------- create AliExpress order immediately ----------
      // let aliCost = 0;

      try {
        /* ---------- build AliExpress payload from PI metadata ---------- */
        const raw = JSON.parse(intent.metadata.items ?? "[]");
        const itemsForAli = raw.map((i: any) => ({
          id: i.aliId,
          quantity:
            process.env.ALI_TEST_ENVIRONMENT === "true" ? 0 : i.quantity,
        }));
        const shipping = intent.metadata.shipping
          ? JSON.parse(intent.metadata.shipping)
          : null;

        /* ---------- place the order ---------- */
        const { orderId, trackingNumber, orderCost } =
          await createAliExpressOrder(
            itemsForAli,
            shipping,
            intent.metadata.order_number
          );

        /* ---------- persist on PaymentIntent ---------- */
        await stripe.paymentIntents.update(intent.id, {
          metadata: {
            ali_order_id: orderId,
            ali_tracking: trackingNumber,
            ali_cost_usd: orderCost ?? "",
          },
        });
        console.log("📦 AliExpress order placed (immediate):", orderId);
      } catch (err) {
        console.error("AliExpress order failed (immediate):", err);
      }

      // Send success email with tracking number
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
      if (email) {
        await sendSuccessEmail(
          intent,
          email,
          charge,
          paymentMethod
          // trackingNumber is now read from intent.metadata.ali_tracking inside sendSuccessEmail
        );
      }
      await createPayoutForIntent(intent); // ← payout after order

      // ─── derive brand / last4 ───
      let brand: string | undefined;
      let last4: string | undefined;

      if (intent.payment_method && typeof intent.payment_method === "object") {
        const paymentMethod = intent.payment_method as Stripe.PaymentMethod;
        if (paymentMethod?.type === "card" && paymentMethod.card) {
          brand = paymentMethod.card.brand;
          last4 = paymentMethod.card.last4;
        }
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
