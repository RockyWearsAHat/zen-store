import nodemailer from "nodemailer";
import Stripe from "stripe";
import "dotenv/config";

/* ─── SMTP transport───────────────────────────────────────── */
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: false, // STARTTLS on port 587
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/* quick sanity‑check */
transporter
  .verify()
  .then(() => {
    console.log("📧 SMTP connection verified");
  })
  .catch((err) => {
    console.error("SMTP verification failed:", err);
  });

/* ─── html helpers (very small, inline‑styled for compatibility) ─── */
const container = (inner: string) => `
  <div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;
              max-width:600px;margin:0 auto;padding:24px;color:#111">
    ${inner}
    <p style="margin-top:32px;font-size:13px;color:#666">
      Zen Essentials · 123 Peaceful Way · Somewhere, USA
    </p>
  </div>`;

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

/* map card brand → remote 32 px PNG (Gmail blocks SVG) */
function cardIconUrl(brand: string): string | undefined {
  const base = (process.env.WEB_URL || "").replace(/\/+$/, "");
  switch (brand.toUpperCase()) {
    case "AMEX":
      return `${base}/amex.png`;
    case "DINERS":
      return `${base}/diners.png`;
    case "DISCOVER":
      return `${base}/discover.png`;
    case "EFTPOS":
      return `${base}/eftpos.png`;
    case "JCB":
      return `${base}/jcb.png`;
    case "MASTERCARD":
      return `${base}/mastercard.png`;
    case "UNIONPAY":
      return `${base}/unionpay.png`;
    case "VISA":
      return `${base}/visa.png`;
    default:
      return; // fallback to plain text
  }
}

/* local fallback when Stripe typings don’t expose Shipping */
interface ShippingInfo {
  name?: string;
  address?: {
    line1?: string;
    line2?: string;
    city?: string;
    postal_code?: string;
    state?: string;
    country?: string;
  };
}

/* ─── exported helpers ─────────────────────────────────────── */
export async function sendSuccessEmail(
  intent: Stripe.PaymentIntent,
  to: string,
  chargeParam?: Stripe.Charge,
  paymentMethod?: Stripe.PaymentMethod | null // ← new
): Promise<void> {
  const {
    subtotal = 0,
    tax = 0,
    fee = 0,
    items = "[]",
  } = (intent as Stripe.PaymentIntent).metadata;
  const total = intent.amount / 100;

  /* parse items (sent as JSON string) */
  const parsed: { id: string; quantity: number }[] = JSON.parse(items);

  /* ── resolve charge object ── */
  const charge =
    chargeParam ??
    ((intent as any).charges?.data?.slice(-1)[0] as Stripe.Charge | undefined); // ← new fallback

  console.log(paymentMethod);

  const brand =
    paymentMethod?.card?.brand?.replaceAll("_", " ").toUpperCase() ?? "CARD";
  const iconUrl = cardIconUrl(brand);
  const last4 = paymentMethod?.card?.last4 ?? "XXXX";

  let shipping: ShippingInfo =
    charge?.shipping ?? (intent as any).shipping ?? {};
  if ((!shipping || !shipping.address) && intent.metadata?.shipping) {
    shipping = JSON.parse(intent.metadata.shipping);
  }
  const addr = shipping.address ?? {};

  // Stripe does not generate a human-friendly order number by default.
  // We'll use the PaymentIntent's id as a fallback, but if you want a shorter order number,
  // you can generate one and store it in intent.metadata.order_number.
  // We'll check for metadata.order_number first:
  const orderNumber =
    (intent.metadata && intent.metadata.order_number) || intent.id;

  /* ---------- items table ---------- */
  const webUrl = (process.env.WEB_URL || "").replace(/\/+$/, "");
  const rows = parsed
    .map(
      (i) => `
      <tr>
        <td style="text-align:left">
          <img src="${webUrl}/Main.avif" alt="${i.id}"
               style="width:40px;height:40px;object-fit:cover;border-radius:6px;margin-right:8px;vertical-align:middle;display:inline-block;border:none;outline:none;text-decoration:none;" />
          ${i.id}
        </td>
        <td style="text-align:right">${i.quantity}</td>
      </tr>`
    )
    .join("");

  console.log(addr);

  /* ---------- html ---------- */
  const html = container(`
    <h2 style="color:#0f766e">Thank you for your purchase!</h2>
    <p>Your order #<strong>${orderNumber}</strong> is confirmed.</p>

    <h3 style="margin-top:24px;margin-bottom:8px">Items</h3>
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr>
          <th style="text-align:left">Product</th>
          <th style="text-align:right">Qty</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <!-- restored receipt section -->
    <h3 style="margin-top:24px;margin-bottom:8px">Receipt</h3>
    <table style="width:100%;border-collapse:collapse">
      <tbody>
        <tr><td style="text-align:left">Subtotal</td><td style="text-align:right">${money(
          +subtotal
        )}</td></tr>
        <tr><td style="text-align:left">Tax</td><td style="text-align:right">${money(
          +tax
        )}</td></tr>
        <tr><td style="text-align:left">Processing&nbsp;Fee</td><td style="text-align:right">${money(
          +fee
        )}</td></tr>
        <tr><td style="font-weight:bold;text-align:left">Total</td><td style="text-align:right;font-weight:bold">${money(
          total
        )}</td></tr>
      </tbody>
    </table>
    <!-- /restored receipt section -->

    <!-- combined shipping + payment row -->
    <table style="width:100%;border-collapse:collapse;margin-top:24px">
      <tr>
        <td style="text-align:left;vertical-align:top">
          <h3 style="margin:0 0 8px 0">Shipped&nbsp;To</h3>
          <p style="margin:0">
            ${shipping?.name ?? ""}<br/>
            ${addr.line1 ?? ""}${addr.line2 ? ", " + addr.line2 : ""}<br/>
            ${addr.city ?? ""}, ${addr.postal_code ?? ""}<br/>
            ${addr.state ?? ""} ${addr.country ?? ""}
          </p>
        </td>
        <td style="text-align:right;vertical-align:top">
          <h3 style="margin:0 0 8px 0">Paid&nbsp;With</h3>
          <div>
            ${
              iconUrl
                ? `<img src="${iconUrl}"
                        alt="${brand} logo"
                        height="15"
                        style="width:auto;aspect-ratio:auto;vertical-align:middle;margin-right:2px;border:none;outline:none;">`
                : ""
            }
            <span>${brand} •••• ${last4}</span>
          </div>
        </td>
      </tr>
    </table>
    <!-- /combined shipping + payment row -->

    <p style="margin-top:24px">
      Track your package any time here:
      <a href="https://zen‑essentials.example/track/${
        intent.id
      }">Track&nbsp;Order</a>
    </p>
    <p style="margin-top:24px">We appreciate your business!</p>
  `);

  console.log(to, html);

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: "Your Zen Essentials order is confirmed",
    html,
  });
}

export async function sendFailureEmail(
  intent: Stripe.PaymentIntent,
  to: string
): Promise<void> {
  const html = container(`
    <h2 style="color:#b91c1c">We’re sorry – your payment did not go through.</h2>
    <p>
      Unfortunately there was an error processing order
      <strong>${intent.id}</strong>.
    </p>
    <p>
      Your items are <strong>not</strong> on the way.  
      Please try again or contact support at
      <a href="mailto:support@zen‑essentials.example">support@zen‑essentials.example</a>.
    </p>
  `);

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: "Issue with your Zen Essentials order",
    html,
  });
}
