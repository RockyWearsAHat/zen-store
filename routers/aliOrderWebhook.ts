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
    // Handle case where body is received as Buffer (Netlify issue)
    let body = req.body;
    if (Buffer.isBuffer(req.body)) {
      try {
        body = JSON.parse(req.body.toString("utf8"));
        console.log(
          "[aliOrderWebhook] Parsed Buffer to JSON:",
          JSON.stringify(body, null, 2)
        );
      } catch (parseError) {
        console.error(
          "[aliOrderWebhook] Failed to parse Buffer as JSON:",
          parseError
        );
        res.status(400).json({ success: false, error: "Invalid JSON" });
        return;
      }
    }

    console.log(
      "[aliOrderWebhook] Received payload:",
      JSON.stringify(body, null, 2)
    );
    console.log("[aliOrderWebhook] Headers:", req.headers);

    // Handle webhook verification/challenge requests
    if (body.challenge) {
      console.log(
        "[aliOrderWebhook] Verification challenge received:",
        body.challenge
      );
      res.status(200).json({ challenge: body.challenge });
      return;
    }

    // Handle verification by returning success for any test payload
    if (body.test || body.verification) {
      console.log("[aliOrderWebhook] Test/verification request received");
      res
        .status(200)
        .json({ success: true, message: "Webhook endpoint verified" });
      return;
    }

    // AliExpress webhook payload structure based on docs
    const { data, message_type, timestamp } = body;

    console.log("[aliOrderWebhook] Destructured values:", {
      data: data,
      dataType: typeof data,
      dataExists: !!data,
      message_type: message_type,
      timestamp: timestamp,
    });

    // For initial webhook setup, AliExpress might send empty or minimal payload
    if (!data) {
      console.log("[aliOrderWebhook] Empty data - likely verification request");
      res
        .status(200)
        .json({ success: true, message: "Webhook endpoint active" });
      return;
    }

    if (message_type !== 53) {
      console.warn("[aliOrderWebhook] Invalid message type:", message_type);
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

    // Log all order status updates for debugging
    const validStatuses = [
      "paymentFailedEvent",
      "OrderCreated",
      "OrderClosed",
      "PaymentAuthorized",
      "OrderShipped",
      "OrderConfirmed",
    ];

    if (!validStatuses.includes(orderStatus)) {
      console.warn("[aliOrderWebhook] Unknown order status:", orderStatus);
    }

    // Only process when order is confirmed or shipped (tracking should be available)
    // OrderConfirmed = order completed and ready for tracking
    // OrderShipped = order has shipped with tracking info
    if (orderStatus !== "OrderConfirmed" && orderStatus !== "OrderShipped") {
      console.log(
        "[aliOrderWebhook] Order not ready for tracking, status:",
        orderStatus,
        "- Valid statuses for tracking:",
        ["OrderConfirmed", "OrderShipped"]
      );
      res.status(200).json({ success: true });
      return;
    }

    console.log(
      "[aliOrderWebhook] Order ready for tracking, fetching tracking number..."
    );

    /* fetch tracking number from AliExpress API */
    let trackingNumber: string | null = null;
    try {
      trackingNumber = await getAliOrderTracking(orderId.toString());
      console.log("[aliOrderWebhook] Tracking lookup result:", {
        orderId,
        trackingNumber: trackingNumber || "(none)",
      });
    } catch (error) {
      console.error("[aliOrderWebhook] Error fetching tracking number:", error);
    }

    if (!trackingNumber) {
      console.warn(
        "[aliOrderWebhook] No tracking number available for order:",
        orderId,
        "- Will retry when tracking becomes available"
      );
      res
        .status(200)
        .json({ success: true, message: "No tracking available yet" });
      return;
    }

    console.log("[aliOrderWebhook] Tracking number found:", trackingNumber);

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
router.get("/", async (req: Request, res: Response) => {
  console.log("[aliOrderWebhook] GET request received for verification");
  console.log("[aliOrderWebhook] Query params:", req.query);
  console.log("[aliOrderWebhook] Headers:", req.headers);

  // Handle any challenge parameter for verification
  if (req.query.challenge) {
    res.status(200).send(req.query.challenge);
    return;
  }

  res.status(200).json({
    status: "success",
    message: "AliExpress webhook endpoint is active and ready",
    timestamp: new Date().toISOString(),
    endpoint: "/api/ali-order-webhook",
  });
});

/* ---------- OPTIONS handler for CORS preflight ---------- */
router.options("/", async (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

export { router as aliOrderWebhookRouter };
