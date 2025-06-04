import nodemailer from "nodemailer";
import Stripe from "stripe";
import "dotenv/config";
// import path from "path";

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
                 padding:24px;">
        ${inner}
        <p style="margin-top:32px;font-size:13px;opacity:.6">
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
const DEMO_UPS_NUMBER = "1Z12345E0205271688"; // kept as fallback
const FALLBACK_LABEL = "United States";
const FALLBACK_MARKER = encodeURIComponent("39.8283,-98.5795");

/* absolute path to the on-disk product thumbnail (no remote fetch) */
// const MAIN_IMG_PATH = path.resolve(__dirname, "../../public/Main.png");
const webUrl = (process.env.WEB_URL || "https://zen-essentials.store").replace(
  /\/+$/,
  ""
);

/* ─── exported helpers ─────────────────────────────────────── */
export async function sendSuccessEmail(
  intent: Stripe.PaymentIntent,
  to: string,
  chargeParam?: Stripe.Charge | null,
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

  // card logo is now served remote (same as product image), no attachment needed

  // (per-item thumbnails are no longer attached)

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
  const trackingNumber =
    (intent.metadata && intent.metadata.ali_tracking) || DEMO_UPS_NUMBER;
  const trackBaseUrl = `https://parcelsapp.com/en/tracking/${trackingNumber}`;

  /* ─── static Google Maps image (embedded) ─── */
  const mapsKey = process.env.GOOGLE_MAPS_KEY;
  let mapHtml = "";
  if (mapsKey) {
    const locRes = await getUPSLocation(DEMO_UPS_NUMBER).catch(() => null);
    const marker = locRes?.marker ?? FALLBACK_MARKER;
    const label = locRes?.label ?? FALLBACK_LABEL;

    const staticUrl =
      `https://maps.googleapis.com/maps/api/staticmap` +
      `?size=600x320&scale=2&zoom=4&markers=color:red|${marker}&key=${mapsKey}`;

    mapHtml = `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"
             style="width:100%;border-collapse:collapse;margin:24px 0 0 0;">
        <tr>
          <td style="padding:0;text-align:left;">
            <img src="${staticUrl}" alt="Package current location: ${label}"
                 style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:0;text-decoration:none;">
          </td>
        </tr>
      </table>`;
  }

  /* ---------- items table (thumbnail + title perfectly centred) ---------- */
  const rows = parsed
    .map((item, idx) => {
      const name = (item as any).title ?? item.id;
      /* unique query param prevents Apple Mail deduplication */
      const imgUrl = `${webUrl}/Main.png?v=${idx}`;
      return `
        <tr>
          <td style="text-align:left;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td>
                  <img src="${imgUrl}" alt="${name}"
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
          <td style="width:48px;text-align:right;vertical-align:middle;">
            ${item.quantity}
          </td>
        </tr>`;
    })
    .join("");

  console.log(addr);

  /* ─── assemble html ─── */
  const bodyInner = container(`
    <h2 style="color:#0f766e">Thank you for your purchase!</h2>
    <p>Your order #<strong>${orderNumber}</strong> is confirmed.</p>

    <table style="width:100%;border-collapse:collapse;margin-top:24px">
      <tbody>
        <tr>
          <td style="text-align:left;margin-bottom:8px"><h3>Items</h3></td>
          <td style="text-align:right;margin-bottom:8px;width:48px;"><h3>Qty</h3></td>
        </tr>
        ${rows}
      </tbody>
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
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                 align="right" style="border-collapse:collapse;">
            <tr>
              ${
                iconUrl
                  ? `<td style="padding:0 6px 0 0;">
                       <img src="${iconUrl}?v=${brand}"
                            alt="${brand} logo" width="24" height="15"
                            style="display:block;width:24px;height:15px;border:0;outline:0;vertical-align:middle;">
                     </td>`
                  : ""
              }
              <td style="font-family:inherit;line-height:15px;white-space:nowrap;vertical-align:middle;">
                •••• ${paymentMethod?.card?.last4 ?? "XXXX"}
              </td>
            </tr>
          </table>
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

  const html = `
  <!DOCTYPE html>
  <html>
   <head>
     <meta name="color-scheme" content="light dark">
     <meta name="supported-color-schemes" content="light dark">
   </head>
   <body style="margin:0;padding:0;background:inherit;color:inherit;">
     ${bodyInner}
   </body>
  </html>`;

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
