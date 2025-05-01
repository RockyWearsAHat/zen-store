import { Router, Request, Response } from "express";
import bodyParser from "body-parser";
import Stripe from "stripe";
import "dotenv/config";
import { sendSuccessEmail, sendFailureEmail } from "./email.js"; // <- extension added

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// raw body required for webhook sig verification
router.post(
  "/",
  bodyParser.raw({ type: "application/json" }),
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

      // ─── 1) get a fully‑expanded PI (card details inside charges) ───
      const intent = (await stripe.paymentIntents.retrieve(base.id, {
        expand: ["charges.data.payment_method_details.card"],
      })) as Stripe.PaymentIntent;

      // ─── 2) get the PaymentMethod object referenced by the PI ───
      let paymentMethod: Stripe.PaymentMethod | null = null;
      if (typeof intent.payment_method === "string") {
        paymentMethod = (await stripe.paymentMethods.retrieve(
          intent.payment_method
        )) as Stripe.PaymentMethod;
      } else if (
        intent.payment_method &&
        typeof intent.payment_method === "object"
      ) {
        paymentMethod = intent.payment_method as Stripe.PaymentMethod;
      }

      // ─── 3) pick the newest charge (may still be undefined for e‑checks) ───
      const charges = (intent as any).charges?.data as
        | Stripe.Charge[]
        | undefined;
      let charge = charges?.at(-1);

      // if charge exists but card details not expanded, fetch once
      if (charge && !charge.payment_method_details?.card) {
        charge = (await stripe.charges.retrieve(charge.id, {
          expand: ["payment_method_details.card"],
        })) as Stripe.Charge;
      }

      // ─── 4) derive brand / last4 from PaymentMethod (works for all types) ───
      let brand: string | undefined;
      let last4: string | undefined;

      if (paymentMethod?.type === "card" && paymentMethod.card) {
        brand = paymentMethod.card.brand;
        last4 = paymentMethod.card.last4;
      }

      const email =
        intent.receipt_email ||
        charge?.billing_details?.email ||
        paymentMethod?.billing_details?.email ||
        null;

      console.log(
        "✅ payment_intent.succeeded:",
        intent.id,
        email,
        brand,
        last4
      );

      if (email) {
        await sendSuccessEmail(intent, email, charge, paymentMethod).catch(
          console.error
        );
      } else {
        console.warn("No e‑mail found on successful payment", intent.id);
      }
    }

    if (event.type === "payment_intent.payment_failed") {
      const intent = event.data.object as Stripe.PaymentIntent;
      const chargeFail = (intent as any).charges?.data?.[0] as
        | Stripe.Charge
        | undefined;
      const email =
        intent.receipt_email || chargeFail?.billing_details?.email || null;

      console.log("❌ payment_intent.payment_failed:", intent.id, email);

      if (email) {
        sendFailureEmail(intent, email).catch(console.error);
      } else {
        console.warn("No e‑mail found on failed payment", intent.id);
      }
    }

    res.json({ received: true });
  }
);

export default router;
