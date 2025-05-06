import nodemailer from "nodemailer";
import Stripe from "stripe";
import "dotenv/config";
import path from "path";
import fs from "fs";

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

/* ─── html helpers (very small, inline-styled for compatibility) ─── */
/*  replaced <div> wrapper with a “bulletproof” table  */
const container = (inner: string) => `
  <table role="presentation" cellspacing="0" cellpadding="0" border="0"
         align="center" width="100%" style="max-width:600px;border-collapse:collapse;">
    <tr>
      <td style="font-family:system-ui,Segoe UI,Roboto,sans-serif;
                 color:#111;padding:24px;">
        ${inner}
        <p style="margin-top:32px;font-size:13px;color:#666">
          Zen&nbsp;Essentials · 123 Peaceful Way · Somewhere,&nbsp;USA
        </p>
      </td>
    </tr>
  </table>`;

/* ⇣⇣  add back the formatter that is referenced later  ⇣⇣ */
function money(n: number): string {
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

/* ─── UPS helper – returns last checkpoint as { label, marker } ─── */
async function getUPSLocation(
  trk: string
): Promise<{ label: string; marker: string } | null> {
  const id = process.env.UPS_CLIENT_ID;
  const secret = process.env.UPS_CLIENT_SECRET;
  if (!id || !secret) return null;

  console.log(id, secret);

  try {
    /* 1️⃣  OAuth token – client‑credentials */
    const tokenRes = await fetch(
      "https://onlinetools.ups.com/security/v1/oauth/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=client_credentials&client_id=${id}&client_secret=${secret}`,
      }
    );
    if (!tokenRes.ok) throw new Error("UPS token fetch failed");
    const { access_token } = (await tokenRes.json()) as {
      access_token: string;
    };

    /* 2️⃣  Tracking details */
    const trackRes = await fetch(
      `https://${
        // !process.env["VITE"] ? `onlinetools` : `wwwcie`
        "wwwcie"
      }.ups.com/api/track/v1/details/${trk}`,
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
          transId: trk,
          transactionSrc: "ZenEssentials",
        },
      }
    );
    if (!trackRes.ok) throw new Error("UPS track fetch failed");
    const data: any = await trackRes.json();

    const act =
      data?.trackResponse?.shipment?.[0]?.package?.[0]?.activity?.[0] ?? null; // latest
    const addr = act?.location?.address ?? {};
    const label = [addr.city, addr.stateProvince, addr.country]
      .filter(Boolean)
      .join(", ");
    if (!label) return null;

    return { label, marker: encodeURIComponent(label) };
  } catch (err) {
    console.error("UPS tracking error:", err);
    return null;
  }
}

/* ---------- constants ---------- */
const DEMO_UPS_NUMBER = "1Z12345E0205271688"; // published sample, should stay live
const FALLBACK_LABEL = "United States";
const FALLBACK_MARKER = encodeURIComponent("39.8283,-98.5795");

/* absolute path to the on-disk product thumbnail (no remote fetch) */
const MAIN_IMG_PATH = path.resolve(__dirname, "../../public/Main.png");
/* base64-encoded thumbnail – eliminates CID issues in Apple Mail */
const MAIN_IMG_BASE64 = fs.readFileSync(MAIN_IMG_PATH).toString("base64");

/* ─── exported helpers ─────────────────────────────────────── */
export async function sendSuccessEmail(
  intent: Stripe.PaymentIntent,
  to: string,
  chargeParam?: Stripe.Charge,
  paymentMethod?: Stripe.PaymentMethod | null
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
    ((intent as any).charges?.data?.slice(-1)[0] as Stripe.Charge | undefined);

  console.log(paymentMethod);

  const brand =
    paymentMethod?.card?.brand?.replaceAll("_", " ").toUpperCase() ?? "CARD";
  const iconUrl = cardIconUrl(brand);
  const iconCid = "card-icon@zen";

  /* ---------- inline attachments (logo + products) ---------- */
  const attachments: {
    filename: string;
    path?: string;
    cid: string;
    contentDisposition: "inline";
    content?: Buffer;
    contentType?: string;
  }[] = [];
  if (iconUrl) {
    attachments.push({
      filename: `${brand}.png`,
      path: iconUrl, // fetched & embedded by Nodemailer
      cid: iconCid,
      contentDisposition: "inline",
    });
  }

  /* base url for product images – always absolute, fallback to site root */
  // const webUrl = (
  //   process.env.WEB_URL || "https://zen-essentials.store"
  // ).replace(/\/+$/, "");

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

  /* ── live UPS location (free) ─────────────────────────────── */
  const trackingNumber = DEMO_UPS_NUMBER; // latest demo number
  const trackBaseUrl = `https://www.ups.com/track?loc=en_US&tracknum=${trackingNumber}`;

  /* ─── static Google Maps image (embedded) ─── */
  const mapsKey = process.env.GOOGLE_MAPS_KEY;
  let mapHtml = "";
  let loc: any = "test";
  if (mapsKey) {
    loc = await getUPSLocation(DEMO_UPS_NUMBER).catch(() => null);
    const marker = loc?.marker ?? FALLBACK_MARKER;
    const label = loc?.label ?? FALLBACK_LABEL;

    const staticUrl = `https://maps.googleapis.com/maps/api/staticmap?size=600x320&scale=2&zoom=4&markers=color:red|${marker}&key=${mapsKey}`;
    const mapCid = "map@zen";
    attachments.push({
      filename: "map.png",
      path: staticUrl, // nodemailer fetches & embeds
      cid: mapCid,
      contentDisposition: "inline",
    });

    mapHtml = `
      <h3 style="margin-top:24px;margin-bottom:8px">Current&nbsp;Location</h3>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
        <tr>
          <td style="padding:0">
            <img src="cid:${mapCid}" alt="Package current location: ${label}"
                 style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:0;text-decoration:none;margin:0;">
          </td>
        </tr>
      </table>
    `;
  }

  /* ---------- items table (thumbnail + title perfectly centred) ---------- */
  const rows = parsed
    .map((item) => {
      const name = (item as any).title ?? item.id;

      return `
        <tr>
          <td style="padding:4px 0;text-align:left;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td>
                  <img src="data:image/png;base64,${MAIN_IMG_BASE64}" alt="${name}"
                       width="40" height="40"
                       style="display:block;width:40px;height:40px;
                              object-fit:cover;border-radius:6px;border:0;outline:0;">
                </td>
                <td style="padding-left:8px;font-family:inherit;line-height:40px;">
                  ${name}
                </td>
              </tr>
            </table>
          </td>
          <td style="width:48px;padding:4px 0;text-align:right;vertical-align:middle;">
            ${item.quantity}
          </td>
        </tr>`;
    })
    .join("");

  console.log(addr);

  /* ---------- html ---------- */
  let html = container(`
    <h2 style="color:#0f766e">Thank you for your purchase!</h2>
    <p>Your order #<strong>${orderNumber}</strong> is confirmed.</p>

    <h3 style="margin-top:24px;margin-bottom:8px">Items</h3>
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr>
          <th style="text-align:left;padding-bottom:4px;">Product</th>
          <th style="text-align:right;padding-bottom:4px;width:48px;">Qty</th>
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
                ? `<img src="cid:${iconCid}" alt="${brand} logo"
                        width="24" height="15"
                        style="width:24px;height:15px;vertical-align:middle;margin-right:2px;border:0;outline:0;display:inline-block;">`
                : ""
            }
            <span>•••• ${paymentMethod?.card?.last4 ?? "XXXX"}</span>
          </div>
        </td>
      </tr>
    </table>
    <!-- /combined shipping + payment row -->

    ${mapHtml}
    <!-- removed debug output of loc.marker / loc.label -->

    <p style="margin-top:24px">
      Track your package any time here:
      <a href="${trackBaseUrl}">Track&nbsp;Order</a>
    </p>
    <p style="margin-top:24px">We appreciate your business!</p>
  `);

  /* ---------- plain‑text fallback ---------- */
  const text = `
Thank you for your purchase!
Order #: ${orderNumber}
Total: ${money(total)}

Shipped To:
${shipping?.name ?? ""}
${addr.line1 ?? ""} ${addr.line2 ?? ""}
${addr.city ?? ""}, ${addr.state ?? ""} ${addr.postal_code ?? ""}
${addr.country ?? ""}

We appreciate your business!
`.trim();

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: "Your Zen Essentials order is confirmed",
    html,
    text, // plain‑text part
    attachments, // now includes logo + product images + map
    headers: {
      "List-Unsubscribe": "<mailto:unsubscribe@zen‑essentials.store>",
    },
  });
}

export async function sendFailureEmail(
  intent: Stripe.PaymentIntent,
  to: string
): Promise<void> {
  const html = container(`
    <h2 style="color:#b91c1c">We’re sorry – your payment did not go through.</h2>
    <p>
      Unfortunately there was an error processing your order
      <strong>${intent.id}</strong>.
    </p>
    <p>
      Your items are <strong>not</strong> on the way.  
      Please try again or contact support at
      <a href="mailto:support@zen‑essentials.store">support@zen‑essentials.store</a>.
    </p>
  `);

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: "Issue with your Zen Essentials order",
    html,
  });
}
