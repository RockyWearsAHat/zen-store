import nodemailer from "nodemailer";
import Stripe from "stripe";
import type { Attachment } from "nodemailer/lib/mailer"; // correct path
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
  /* ensure absolute path even when WEB_URL is missing */
  const base = (process.env.WEB_URL || "https://zen-essentials.store").replace(
    /\/+$/,
    ""
  );
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

/* ------------------------------------------------------------------ */
/*  UPS                                                               */
/* ------------------------------------------------------------------ */

export async function getUPSLocation(trackingNumber: string): Promise<{
  lat?: number;
  lng?: number;
  status?: string;
  label?: string;
  marker?: any;
} | null> {
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
      `https://onlinetools.ups.com/api/track/v1/details/${trackingNumber}`,
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
          transId: trackingNumber,
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
    if (!label) return null; // ← no label → no marker
    return { label, marker: encodeURIComponent(label) };
  } catch (err) {
    console.error("UPS tracking error:", err);
    return null;
  }
}

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
  paymentMethod?: Stripe.PaymentMethod | null,
  explicitTracking?: string | null // ← NEW
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
  /* prefer the AliExpress order-ID (ali_order_id), then order_number, fallback to PI id */
  const orderNumber =
    intent.metadata?.ali_order_id ?? intent.metadata?.order_number ?? intent.id;

  /* ── live UPS location (free) ─────────────────────────────── */
  const trackingNumber =
    explicitTracking !== null
      ? explicitTracking ??
        ((intent.metadata && intent.metadata.ali_tracking) || "")
      : ""; // when explicitTracking is null, force empty string
  const trackBaseUrl = trackingNumber
    ? `https://www.ups.com/track?loc=en_US&tracknum=${trackingNumber}`
    : "#";

  /* ─── static Google Maps image (embedded) ─── */
  const mapsKey = process.env.GOOGLE_MAPS_KEY;
  /* ── log context ───────────────────── */
  const mask = (s?: string) => (s ? s.slice(0, 6) + "…" : "(unset)");
  console.log("[e-mail] map context", {
    explicitTracking,
    metaTracking: intent.metadata?.ali_tracking ?? "—",
    chosenTracking: trackingNumber || "(empty)",
    mapsKey: mask(mapsKey),
  });

  let mapHtml = "";
  const attachments: Attachment[] = []; // ← collect inline images

  if (mapsKey && trackingNumber) {
    const locRes = await getUPSLocation(trackingNumber).catch((e) => {
      console.error("[e-mail] UPS location lookup failed:", e);
      return null;
    });

    console.log("[e-mail] UPS location response:", locRes || "—");

    /* build marker/centre – always have one */
    const fallbackAddress =
      [addr.city, addr.state, addr.country].filter(Boolean).join(", ") ||
      "United States";
    const chosenMarker = locRes?.marker || encodeURIComponent(fallbackAddress);
    const markerColor = locRes ? "red" : "gray";

    const staticUrl =
      `https://maps.googleapis.com/maps/api/staticmap` +
      `?size=600x320&scale=2&zoom=4` +
      `&center=${chosenMarker}` +
      `&markers=color:${markerColor}|${chosenMarker}` +
      `&key=${mapsKey}`;

    console.log("[e-mail] Google Static Maps URL:", staticUrl);

    try {
      /* fetch the PNG so it can be embedded */
      const imgRes = await fetch(staticUrl);
      if (imgRes.ok) {
        const mapBuffer = Buffer.from(await imgRes.arrayBuffer());
        const cid = `map-${trackingNumber}@zen`;
        attachments.push({
          filename: "map.png",
          content: mapBuffer,
          cid,
        });
        mapHtml = `
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                 style="width:100%;border-collapse:collapse;margin:24px 0 0 0;">
            <tr>
              <td style="padding:0;text-align:left;">
                <img src="cid:${cid}"
                     alt="Package current location"
                     style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:0;text-decoration:none;">
              </td>
            </tr>
          </table>`;
        console.log("[e-mail] Map image embedded (cid:", cid, ")");
      } else {
        console.warn(
          "Static map fetch failed:",
          imgRes.status,
          await imgRes.text().catch(() => "")
        );
      }
    } catch (e) {
      console.error("Map download error:", e);
    }
  } else {
    console.log(
      "[e-mail] Map skipped –",
      !mapsKey ? "GOOGLE_MAPS_KEY not set" : "trackingNumber empty"
    );
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
                            style="display:block;width=24px;height=15px;border:0;outline:0;vertical-align:middle;">
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

    ${
      trackingNumber
        ? `
    <p style="margin-top:24px">
      Track your package any time here:
      <a href="${trackBaseUrl}">Track&nbsp;Order</a>
    </p>
    `
        : ""
    }
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
    text,
    attachments, // ← embed map if we have it
  });

  console.log(
    `[e-mail] Confirmation sent to ${to} with`,
    attachments.length,
    "inline attachment(s)"
  );
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
      <a href="mailto:alexwaldmann2004@gmail.com">support@zen-essentials.store</a>.
    </p>
  `);

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: "Issue with your Zen Essentials order",
    html,
  });
}

/* ─── new helper: tracking notification ────────────────────── */
export async function sendTrackingEmail(
  intent: Stripe.PaymentIntent,
  to: string,
  trackingNumber: string,
  mapUrl = `https://www.ups.com/track?loc=en_US&tracknum=${trackingNumber}&requester=WT/trackdetails`
): Promise<void> {
  const orderNo =
    intent.metadata?.ali_order_id ?? intent.metadata?.order_number ?? intent.id;

  const html = container(`
    <h2 style="color:#0f766e">Your order is on the way!</h2>
    <p>Great news! Your Zen Essentials order has shipped and is on its way to you.</p>
    
    <h3 style="margin-top:24px;margin-bottom:8px">Order Details</h3>
    <table style="width:100%;border-collapse:collapse">
      <tbody>
        <tr><td style="text-align:left">Order Number</td><td style="text-align:right"><strong>${orderNo}</strong></td></tr>
        <tr><td style="text-align:left">Tracking Number</td><td style="text-align:right"><strong>${trackingNumber}</strong></td></tr>
      </tbody>
    </table>
    
    <p style="margin-top:24px">
      <a href="${mapUrl}" style="display:inline-block;background:#0f766e;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;">
        Track Your Package
      </a>
    </p>
    
    <p style="margin-top:24px">You can track your package anytime using the tracking number above. Delivery typically takes 7-15 business days depending on your location.</p>
    <p style="margin-top:24px">We appreciate your business!</p>
  `);

  const text = `
Your Zen Essentials order is on the way!

Great news! Your order has shipped and is on its way to you.

Order Details:
Order Number: ${orderNo}
Tracking Number: ${trackingNumber}

Track your package: ${mapUrl}

You can track your package anytime using the tracking number above.
Delivery can be expected typically within 7 business days.
`.trim();

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: "Your Zen Essentials tracking information",
    html,
    text,
  });

  console.log(`[e-mail] Tracking mail sent to ${to} (${trackingNumber})`);
}
