import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "./db";

/* ─── env vars you must set ────────────────────────────────────────── */
// const APP_KEY = process.env.ALI_APP_KEY!; // e.g. 123456
// const APP_SECRET = process.env.ALI_APP_SECRET!; // e.g. abcde...
// Access token now lives in Mongo, not .env
/* ──────────────────────────────────────────────────────────────────── */

/* ---------- AliExpress token model ---------- */
interface AliTokenDoc extends mongoose.Document {
  access_token: string;
  refresh_token: string;
  expires_at: Date;
}

const AliTokenSchema = new mongoose.Schema<AliTokenDoc>({
  access_token: { type: String, required: true },
  refresh_token: { type: String, required: true },
  expires_at: { type: Date, required: true },
});

const AliToken =
  (mongoose.models.AliToken as mongoose.Model<AliTokenDoc>) ??
  mongoose.model<AliTokenDoc>("AliToken", AliTokenSchema);

/* ---------- helper: get valid token (auto-refresh) ---------- */
async function getValidAccessToken(): Promise<string> {
  await connectDB();
  let tok = await AliToken.findOne().exec();
  if (!tok) throw new Error("AliExpress token not found in Mongo");

  // refresh if <5 min from expiry
  const fiveMin = 5 * 60 * 1000;
  if (tok.expires_at.getTime() - Date.now() < fiveMin) {
    const refreshUrl = "https://api.aliexpress.com/auth/token/security/refresh";
    const params = new URLSearchParams();
    params.append("client_id", process.env.ALI_APP_KEY!);
    params.append("client_secret", process.env.ALI_APP_SECRET!);
    params.append("refresh_token", tok.refresh_token);
    params.append("grant_type", "refresh_token");

    const resp = await fetch(refreshUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    const data = await resp.json();
    if (data.error_msg)
      throw new Error(`AliExpress refresh failed: ${data.error_msg}`);
    tok.access_token = data.access_token;
    tok.refresh_token = data.refresh_token || tok.refresh_token;
    tok.expires_at = new Date(Date.now() + data.expires_in * 1000);
    await tok.save();
  }
  return tok.access_token;
}

/* ---------- types ---------- */
export interface AliOrderResult {
  orderId: string;
  trackingNumber: string;
  orderCost: number;
}

/* ---------- create order using latest API ---------- */
export async function createAliExpressOrder(
  items: { id: string; quantity: number }[],
  shipping: {
    firstName: string;
    lastName: string;
    country: string;
    state: string;
    city: string;
    address1: string;
    zip: string;
    phone: string;
  } | null
): Promise<AliOrderResult> {
  const accessToken = await getValidAccessToken();

  // Build order lines as per docs
  const orderLines = items.map((i) => ({
    product_id: i.id,
    quantity: i.quantity,
  }));

  // Build shipping address as per docs
  const logisticsAddress = shipping
    ? {
        contact_name: `${shipping.firstName} ${shipping.lastName}`,
        country: shipping.country,
        province: shipping.state,
        city: shipping.city,
        address: shipping.address1,
        zip: shipping.zip,
        phone: shipping.phone,
      }
    : undefined;

  // 1️⃣ Create order
  const createResp = await fetch("https://api-sg.aliexpress.com/order/create", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ae-app-key": process.env.ALI_APP_KEY!,
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      order_lines: orderLines,
      logistics_address: logisticsAddress,
    }),
  }).then((r) => r.json());

  if (!createResp.order_id) {
    throw new Error(
      "AliExpress order creation failed: " +
        (createResp.error_msg || JSON.stringify(createResp))
    );
  }
  const orderId = createResp.order_id as string;

  // 2️⃣ Pay for order
  const payResp = await fetch("https://api-sg.aliexpress.com/order/pay", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ae-app-key": process.env.ALI_APP_KEY!,
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ order_id: orderId }),
  }).then((r) => r.json());

  const orderCost = Number(payResp.order_amount || 0);

  // 3️⃣ Get tracking number
  const trackResp = await fetch(
    `https://api-sg.aliexpress.com/order/${orderId}/tracking`,
    {
      headers: {
        "x-ae-app-key": process.env.ALI_APP_KEY!,
        authorization: `Bearer ${accessToken}`,
      },
    }
  ).then((r) => r.json());

  return {
    orderId,
    trackingNumber: trackResp.tracking_no ?? "PENDING",
    orderCost,
  };
}

/* ─── exports ──────────────────────────────────────────────── */
export { AliToken };
