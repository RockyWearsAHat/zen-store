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

/* ---------- AliExpress webhook handler ---------- */
router.post("/", async (req: Request, res: Response) => {
  try {
    console.log(
      "[aliOrderWebhook] Received payload:",
      JSON.stringify(req.body, null, 2)
    );

    // AliExpress webhook payload structure based on docs
    const { data, message_type, timestamp } = req.body;

    if (!data || message_type !== 53) {
      console.warn("[aliOrderWebhook] Invalid message type or missing data:", {
        message_type,
        hasData: !!data,
      });
      res.status(200).json({ success: true }); // Still return 200 for AliExpress
      return;
    }

    const { orderId, orderStatus, buyerId } = data;

    if (!orderId) {
      console.warn("[aliOrderWebhook] Missing orderId in data");
      res.status(200).json({ success: true });
      return;
    }

    console.log("[aliOrderWebhook] Processing order:", {
      orderId,
      orderStatus,
      buyerId,
      timestamp: new Date(timestamp * 1000).toISOString(),
    });

    // Only process when order is shipped (tracking available)
    if (orderStatus !== "OrderShipped") {
      console.log(
        "[aliOrderWebhook] Order not shipped yet, status:",
        orderStatus
      );
      res.status(200).json({ success: true });
      return;
    }

    /* fetch tracking number */
    const trackingNumber = await getAliOrderTracking(orderId.toString());
    if (!trackingNumber) {
      console.warn(
        "[aliOrderWebhook] No tracking number available for order:",
        orderId
      );
      res.status(200).json({ success: true });
      return;
    }

    /* locate corresponding PaymentIntent by order ID */
    let intent: Stripe.PaymentIntent | undefined;
    try {
      // Try searching by ali_order_id first, then order_number
      let result = await stripe.paymentIntents.search({
        query: `metadata['ali_order_id']:'${orderId}'`,
        limit: 1,
      });

      if (result.data.length === 0) {
        result = await stripe.paymentIntents.search({
          query: `metadata['order_number']:'${orderId}'`,
          limit: 1,
        });
      }

      intent = result.data[0];
    } catch (e) {
      console.error("[aliOrderWebhook] Stripe search error", e);
    }

    if (!intent) {
      console.warn(
        "[aliOrderWebhook] No PaymentIntent found for order:",
        orderId
      );
      res.status(200).json({ success: true });
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

    console.log(
      "[aliOrderWebhook] Webhook processing completed successfully for order:",
      orderId
    );
    res.status(200).json({ success: true });
  } catch (err) {
    console.error("[aliOrderWebhook] Error processing webhook:", err);
    // Always return 200 to AliExpress to avoid retries
    res
      .status(200)
      .json({ success: false, error: "Internal processing error" });
  }
});

/* ---------- webhook verification endpoint ---------- */
router.get("/", async (_req: Request, res: Response) => {
  res.json({
    status: "AliExpress webhook endpoint is active",
    timestamp: new Date().toISOString(),
    endpoint: "/api/ali-order-webhook",
  });
});

export { router as aliOrderWebhookRouter };
