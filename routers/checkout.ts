import { Router, Request, Response } from "express";
import Stripe from "stripe";
import { calculateOrderAmount } from "../src/lib/pricing";

// ─── simple in‑memory catalogue ───────────────────────────────────────────────
const catalogue: Record<string, { title: string; price: number }> = {
  "desktop-fountain": { title: "ZenFlow™ Desktop Fountain", price: 109.99 },
  // add more products here…
};
// ──────────────────────────────────────────────────────────────────────────────

/* simple, collision‑safe order‑number generator */
function generateOrderNumber() {
  // e.g. ZE‑20240611‑AB12
  const date = new Date()
    .toLocaleString("en-US", {
      timeZone: "America/Denver",
      month: "numeric",
      year: "numeric",
      day: "2-digit",
    })
    .split("/");

  console.log(date);

  const yyyymmdd = `${date[2]}${date[0]}${date[1]}`; // YYYYMMDD

  const rand = Math.floor(Math.random() * 1000000);
  return `${yyyymmdd}${rand}`;
}

/* ---------- helpers (safe JSON parsing) ---------- */
function toObject(maybeString: any): any {
  if (typeof maybeString === "string") {
    try {
      return JSON.parse(maybeString);
    } catch {
      return {}; // malformed JSON → empty object
    }
  }
  return maybeString ?? {};
}
/* ----------------------------------------------- */

function parseItems(raw: unknown): { id: string; quantity: number }[] | null {
  if (Array.isArray(raw)) return raw;
  if (
    typeof raw === "object" &&
    raw !== null &&
    Array.isArray((raw as any).items)
  )
    return (raw as any).items;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function getBody(req: Request): any {
  if (typeof req.body === "string" && req.body.trim()) {
    try {
      return JSON.parse(req.body);
    } catch {
      /* fallthrough */
    }
  }
  return req.body;
}
// ---------- end helpers ----------

const router = Router();

router.get("/test", (_req: Request, res: Response) => {
  res.json({ test: "hello from the test route" });
});

// router.post("/create-checkout-session", async (req, res) => {
//   const items = JSON.parse(req.body).items || [];

//   if (!items || items.length === 0) {
//     res.status(400).json({ error: "Missing or invalid items array" });
//     return;
//   }

//   /* ─── derive pricing from catalogue ─── */
//   const subtotal = items.reduce((sum: number, i: any) => {
//     const product = catalogue[i.id];
//     return product ? sum + product.price * i.quantity : sum;
//   }, 0);
//   const { tax, fee } = calculateOrderAmount(subtotal);

//   /* build Stripe line_items from catalogue */
//   const productLines = items
//     .map((i: any) => {
//       const product = catalogue[i.id];
//       if (!product) return null; // skip unknown
//       return {
//         price_data: {
//           currency: "usd",
//           unit_amount: Math.round(product.price * 100),
//           product_data: { name: product.title },
//         },
//         quantity: i.quantity,
//       };
//     })
//     .filter(Boolean) as Stripe.Checkout.SessionCreateParams.LineItem[];

//   try {
//     const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
//     const session = await stripe.checkout.sessions.create({
//       mode: "payment",
//       payment_method_types: ["card"],
//       line_items: [
//         ...productLines,
//         {
//           price_data: {
//             currency: "usd",
//             unit_amount: Math.round(tax * 100),
//             product_data: { name: "Tax" },
//           },
//           quantity: 1,
//         },
//         {
//           price_data: {
//             currency: "usd",
//             unit_amount: Math.round(fee * 100),
//             product_data: { name: "Processing Fee" },
//           },
//           quantity: 1,
//         },
//       ],
//       metadata: { subtotal, tax, fee },
//       success_url:
//         "http://localhost:4000/success?session_id={CHECKOUT_SESSION_ID}",
//       cancel_url: "http://localhost:4000/cart",
//       payment_intent_data: {
//         statement_descriptor_suffix: "My Store",
//         description: `Order ${new Date().toISOString()}`,
//       },
//     });

//     res.json({ id: session.id });
//   } catch (err: any) {
//     console.error("Stripe error", err);
//     res.status(500).json({ error: err.message });
//   }
// });

router.post(
  "/create-or-update-payment-intent",
  async (req: Request, res: Response) => {
    // Netlify sometimes hands us a string – salvage it
    const body = toObject(req.body);
    const items = parseItems(body?.items ?? body);
    const { paymentIntentId, email, shipping } = body as any;

    if (!items || items.length === 0) {
      res.status(400).json({ error: "Missing or empty items array" });
      return;
    }

    // use catalogue prices, ignore anything coming from client
    const subtotal = items.reduce((sum, i) => {
      const product = catalogue[i.id];
      return product ? sum + product.price * i.quantity : sum;
    }, 0);

    // calculate tax and fees
    const { tax, fee, total } = calculateOrderAmount(subtotal);

    try {
      let intent: Stripe.PaymentIntent;
      if (paymentIntentId) {
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
        // ── UPDATE ──
        intent = await stripe.paymentIntents.update(paymentIntentId, {
          amount: total, // total includes tax and fees
          payment_method_types: ["card"],
          metadata: {
            subtotal,
            tax,
            fee,
            items: JSON.stringify(items),
            shipping: shipping ? JSON.stringify(shipping) : null, // ← add
          },
          receipt_email: email || undefined,
        });
      } else {
        // ── CREATE ──
        const orderNumber = generateOrderNumber();
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
        intent = await stripe.paymentIntents.create({
          amount: total, // total includes tax and fees
          currency: "usd",
          payment_method_types: ["card"],
          metadata: {
            order_number: orderNumber, // ← new
            subtotal,
            tax,
            fee,
            items: JSON.stringify(items),
            shipping: shipping ? JSON.stringify(shipping) : null, // ← add
          },
          receipt_email: email || undefined,
        });
      }
      res.json({ id: intent.id, clientSecret: intent.client_secret });
    } catch (err: any) {
      console.error("Stripe PI error", err);
      res.status(500).json({ error: err.message });
    }
  }
);

router.get("/retrieve-payment-intent", async (req, res) => {
  const { clientSecret, expandCards } = req.query as {
    clientSecret: string;
    expandCards?: string;
  };
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const intent = (await stripe.paymentIntents.retrieve(
      clientSecret.split("_secret_")[0],
      expandCards === "1"
        ? { expand: ["charges.data.payment_method_details.card"] }
        : {}
    )) as Stripe.PaymentIntent;
    let brand, last4;
    if (expandCards === "1" && (intent as any)?.charges?.data?.length) {
      const card = (intent as any).charges.data[0].payment_method_details?.card;
      brand = card?.brand;
      last4 = card?.last4;
    }
    res.json({ amount: intent.amount, brand, last4 });
  } catch (err: any) {
    console.error("Stripe retrieve error", err);
    res.status(500).json({ error: err.message });
  }
});

export const checkoutRouter = router;
