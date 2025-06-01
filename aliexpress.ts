import "dotenv/config";
import crypto from "crypto";
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
  if (!items.length) throw new Error("No items passed to AliExpress order");

  const ACCESS_TOKEN = await getValidAccessToken();

  // Build order payload per AliExpress API
  const timestamp = Date.now().toString();
  const uuid = crypto.randomUUID();

  // Build params for signing
  const paramsForSign: Record<string, string> = {
    app_key: process.env.ALI_APP_KEY!,
    timestamp,
    sign_method: "sha256",
    access_token: ACCESS_TOKEN,
    uuid,
  };

  // Build the string to sign
  const sortedKeys = Object.keys(paramsForSign).sort();
  const baseStr =
    process.env.ALI_APP_SECRET! +
    sortedKeys.map((k) => k + paramsForSign[k]).join("") +
    process.env.ALI_APP_SECRET!;
  const sign = crypto
    .createHash("sha256")
    .update(baseStr)
    .digest("hex")
    .toUpperCase();

  // Build POST body
  const orderPayload: any = {
    product_list: items.map((i) => ({
      product_id: i.id, // SKU
      product_count: i.quantity,
    })),
  };

  if (shipping) {
    orderPayload.receive_address = {
      contact_name: shipping.firstName + " " + shipping.lastName,
      phone: shipping.phone,
      province: shipping.state,
      city: shipping.city,
      detail_address: shipping.address1,
      zip_code: shipping.zip,
      country: shipping.country,
    };
  }

  const bodyParams = new URLSearchParams();
  bodyParams.append("app_key", process.env.ALI_APP_KEY!);
  bodyParams.append("timestamp", timestamp);
  bodyParams.append("sign_method", "sha256");
  bodyParams.append("sign", sign);
  bodyParams.append("access_token", ACCESS_TOKEN);
  bodyParams.append("uuid", uuid);
  bodyParams.append("biz_content", JSON.stringify(orderPayload));

  const endpoint = "https://api.aliexpress.com/order/create"; // Use the correct endpoint

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=utf-8",
    },
    body: bodyParams,
  });

  const json: any = await res.json();

  if (json?.error_response) {
    throw new Error(
      `AliExpress error ${json.error_response.code}: ${json.error_response.msg}`
    );
  }

  const result = json.result;

  if (!result || !result.trade_order_id)
    throw new Error("Unexpected AliExpress response format");

  return {
    orderId: result.trade_order_id.toString(),
    trackingNumber: result.waybill_no_list?.[0]?.mail_no?.toString() ?? null,
    orderCost: Number(result.order_amount ?? 0) / 100, // convert cents → USD
  };
}

/* ─── exports ──────────────────────────────────────────────── */
export { AliToken };
