import { Router, Request, Response } from "express";
import express from "express";
import Stripe from "stripe";
import "dotenv/config";
import { sendSuccessEmail, sendFailureEmail } from "./email.js"; // <- extension added
import { createAliExpressOrder } from "../aliexpress"; // TS helper

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// raw body required for webhook sig verification
router.post(
  "/",
  express.raw({ type: "application/json" }), // ← swap in‑house parser
  async (req: Request, res: Response): Promise<void> => {
    const sig = req.headers["stripe-signature"] as string;
    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET || ""
      );
    } catch (err: any) {
      console.error("Webhook signature verification failed.", err.message);
      res.status(400).send(`Webhook Error: ${err.message}`);
      return;
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      console.log("✅  Payment received for session", session.id);
      // TODO: handle order fulfillment
    }

    if (event.type === "payment_intent.succeeded") {
      const base = event.data.object as Stripe.PaymentIntent;

      // fully expanded PI (latest_charge + balance_tx)
      const intent = (await stripe.paymentIntents.retrieve(base.id, {
        expand: ["latest_charge.balance_transaction", "payment_method"],
      })) as Stripe.PaymentIntent;

      // ---------- create AliExpress order immediately ----------
      let aliOrderId = "",
        aliTracking = "",
        aliCost = 0;
      try {
        const raw = JSON.parse(intent.metadata.items ?? "[]");
        const itemsForAli = raw.map((i: any) => ({
          id: i.aliId, // always use aliId
          quantity: i.quantity,
        }));

        const { orderId, trackingNumber, orderCost } =
          await createAliExpressOrder(
            itemsForAli,
            intent.metadata.shipping
              ? JSON.parse(intent.metadata.shipping)
              : null
          );
        aliOrderId = orderId;
        aliTracking = trackingNumber;
        aliCost = orderCost;

        await stripe.paymentIntents.update(intent.id, {
          metadata: {
            ali_order_id: orderId,
            ali_tracking: trackingNumber,
            ali_cost_usd: aliCost,
          },
        });
        console.log("📦 AliExpress order placed (immediate):", orderId);
      } catch (err) {
        console.error("AliExpress order failed (immediate):", err);
      }

      await createPayoutForIntent(intent); // ← payout after order

      /* ---------- e-mail / card-brand logging ---------- */
      const charge = intent.latest_charge as Stripe.Charge | null; // ← added

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

      const email =
        intent.receipt_email || charge?.billing_details?.email || null;

      console.log(
        "✅ payment_intent.succeeded:",
        intent.id,
        email,
        brand,
        last4
      );
    }

    /* ─── NEW: wait until the payout is marked “paid” ──────────────── */
    if (event.type === "payout.paid") {
      const payout = event.data.object as Stripe.Payout;
      const piId = payout.metadata?.payment_intent_id;
      if (!piId) {
        res.json({ received: true });
        return;
      }

      const intent = (await stripe.paymentIntents.retrieve(
        piId
      )) as Stripe.PaymentIntent;

      /* ---------- integrity checks ---------- */
      const expectedPayout = Number(
        intent.metadata?.expected_payout_cents || 0
      );
      if (payout.amount !== expectedPayout) {
        await stripe.paymentIntents.update(piId, {
          metadata: { payout_status: "incomplete_payout_mismatch" },
        });
        console.warn("Payout amount mismatch – aborting fulfilment");
        res.json({ received: true });
        return;
      }

      const expectedTotal = Math.round(
        (Number(intent.metadata.subtotal ?? 0) +
          Number(intent.metadata.tax ?? 0) +
          Number(intent.metadata.fee ?? 0)) *
          100
      );

      if (expectedTotal !== intent.amount) {
        await stripe.paymentIntents.update(piId, {
          metadata: { payout_status: "incomplete_amount_mismatch" },
        });
        console.warn("Payment amount mismatch – aborting fulfilment");
        res.json({ received: true });
        return;
      }

      // avoid duplicate fulfilment
      if (intent.metadata?.ali_order_id) {
        console.log("AliExpress order already placed for", piId);
        res.json({ received: true });
        return;
      }

      /* ---------- create AliExpress order now that funds have cleared ---------- */
      let aliCost = 0,
        profit = 0;
      try {
        const raw = JSON.parse(intent.metadata.items ?? "[]");
        // Use aliId for AliExpress product id
        const itemsForAli = raw.map((i: any) => ({
          id: i.aliId, // always use aliId
          quantity: i.quantity,
        }));

        const { orderId, trackingNumber, orderCost } =
          await createAliExpressOrder(
            itemsForAli,
            intent.metadata.shipping
              ? JSON.parse(intent.metadata.shipping)
              : null
          );
        aliCost = orderCost;
        const feeUsd = parseFloat(intent.metadata?.stripe_fee_usd ?? "0");
        profit = intent.amount / 100 - feeUsd - aliCost;

        await stripe.paymentIntents.update(piId, {
          metadata: {
            ali_order_id: orderId,
            ali_tracking: trackingNumber,
            ali_cost_usd: aliCost,
            stripe_fee_usd: feeUsd.toFixed(2),
            profit_usd: profit.toFixed(2),
          },
        });
        console.log("📦 AliExpress order placed:", orderId);
      } catch (err) {
        console.error("AliExpress order failed:", err);
      }

      /* ---------- e-mail confirmation ---------- */
      try {
        const charges = (intent as any).charges?.data;
        const charge = charges?.[charges.length - 1] as
          | Stripe.Charge
          | undefined;
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
          await sendSuccessEmail(intent, email, charge, paymentMethod);
        } else {
          console.warn("No email found for payout-paid PI", piId);
        }
      } catch (err) {
        console.error("Success email failed:", err);
      }
    }
    /* ──────────────────────────────────────────────────────────────── */

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
  }
);

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
