import { Router, Request, Response } from "express";
import Stripe from "stripe";
import { sendTrackingEmail } from "./email.js";
import { getAliOrderTracking } from "./aliexpress";

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

/* ---------- local copy of e-mail-picker from stripeWebhook ---------- */
const pickEmail = async (
  stripe: Stripe,
  intent: Stripe.PaymentIntent
): Promise<string | null> => {
  if (intent.receipt_email) return intent.receipt_email;
  if (intent.customer && typeof intent.customer === "string") {
    const customer = await stripe.customers.retrieve(intent.customer);
    if (!("deleted" in customer) && customer.email) return customer.email;
  }
  let pm: Stripe.PaymentMethod | null = null;
  if (typeof intent.payment_method === "string") {
    pm = await stripe.paymentMethods.retrieve(intent.payment_method);
  } else if (intent.payment_method) {
    pm = intent.payment_method as Stripe.PaymentMethod;
  }
  if (pm?.billing_details?.email) return pm.billing_details.email;
  const charges = (intent as any).charges?.data as Stripe.Charge[] | undefined;
  for (const c of charges ?? []) {
    const e = c.billing_details?.email;
    if (e) return e;
  }
  return null;
};

/* ---------- AliExpress push-callback ---------- */
router.post("/", async (req: Request, res: Response) => {
  try {
    // NB: adapt key names to the exact payload AliExpress sends you
    const orderId: string | undefined =
      (req.body?.orderId ||
        req.body?.order_id ||
        req.body?.id ||
        req.body?.ae_order_id) ??
      undefined;

    if (!orderId) {
      res.status(400).send("orderId missing in callback");
      return;
    }

    console.log("[aliOrderWebhook] callback for order", orderId);

    /* fetch / refresh tracking number */
    const trackingNumber = await getAliOrderTracking(orderId);
    if (!trackingNumber) {
      console.warn("[aliOrderWebhook] no tracking yet for", orderId);
      res.json({ received: true });
      return;
    }

    /* locate corresponding PaymentIntent by metadata.order_number */
    let intent: Stripe.PaymentIntent | undefined;
    try {
      const result = await stripe.paymentIntents.search({
        query: `metadata['order_number']:'${orderId}'`,
        limit: 1,
      });
      intent = result.data[0];
    } catch (e) {
      console.error("[aliOrderWebhook] Stripe search error", e);
    }

    if (!intent) {
      console.warn("[aliOrderWebhook] no PI found for order", orderId);
      res.json({ received: true });
      return;
    }

    /* update PI metadata (optional) */
    try {
      if (intent.metadata?.ali_tracking !== trackingNumber) {
        await stripe.paymentIntents.update(intent.id, {
          metadata: { ...intent.metadata, ali_tracking: trackingNumber },
        });
      }
    } catch (e) {
      console.error("[aliOrderWebhook] metadata update failed", e);
    }

    /* send tracking e-mail */
    const email = await pickEmail(stripe, intent);
    if (email) {
      await sendTrackingEmail(intent, email, trackingNumber);
      console.log(
        "[aliOrderWebhook] tracking mail sent to",
        email,
        "for",
        orderId
      );
    } else {
      console.warn("[aliOrderWebhook] no e-mail for intent", intent.id);
    }

    res.json({ received: true });
  } catch (err) {
    console.error("[aliOrderWebhook] fatal", err);
    res.status(400).send("AliExpress order webhook error");
  }
});

export { router as aliOrderWebhookRouter };
