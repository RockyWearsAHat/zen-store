import crypto from "crypto";
import { URLSearchParams } from "url";
import mongoose from "mongoose";
import { connectDB } from "./db";

/* ─── env vars you must set ────────────────────────────────────────── */
const APP_KEY = process.env.ALI_APP_KEY!; // e.g. 123456
const APP_SECRET = process.env.ALI_APP_SECRET!; // e.g. abcde...
// Access token now lives in Mongo, not .env
/* ──────────────────────────────────────────────────────────────────── */

interface AliTokenDoc extends mongoose.Document {
  access_token: string;
  refresh_token: string;
  expires_at: Date; // absolute UTC expiry
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
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tok.refresh_token,
      app_key: APP_KEY,
      app_secret: APP_SECRET,
    });

    const resp = await fetch("https://api-seller.aliexpress.com", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    }).then((r) => r.json() as Promise<any>);

    if (resp.error) throw new Error("AliExpress refresh failed: " + resp.error);

    tok.access_token = resp.access_token;
    tok.refresh_token = resp.refresh_token ?? tok.refresh_token;
    tok.expires_at = new Date(Date.now() + resp.expires_in * 1000);
    await tok.save();
  }
  return tok.access_token;
}

type Item = { id: string; quantity: number };
type Shipping = null | {
  firstName: string;
  lastName: string;
  country: string;
  state: string;
  city: string;
  address1: string;
  zip: string;
  phone: string;
};

export async function createAliExpressOrder(
  items: Item[],
  shipping: Shipping
): Promise<{
  orderId: string;
  trackingNumber: string | null;
  orderCost: number;
}> {
  if (!items.length) throw new Error("No items passed to AliExpress order");

  const ACCESS_TOKEN = await getValidAccessToken(); // ← live token

  const apiName = "aliexpress.logistics.ds.order.create";
  const timestamp = Date.now();

  /* ---------- 1) build parameter map ---------- */
  const bizContent: any = {
    sender_type: "SUPPLIER",
    warehouse_service_type: "warehouse_service",
    product_list: items.map((i) => ({
      product_id: i.id,
      product_count: i.quantity,
    })),
  };

  if (shipping) {
    bizContent.receive_address = {
      contact_name: shipping.firstName + " " + shipping.lastName,
      phone: shipping.phone,
      province: shipping.state,
      city: shipping.city,
      detail_address: shipping.address1,
      zip_code: shipping.zip,
      country: shipping.country,
    };
  }

  const publicParams: Record<string, string> = {
    app_key: APP_KEY,
    method: apiName,
    sign_method: "sha256",
    timestamp: timestamp.toString(),
    access_token: ACCESS_TOKEN,
    v: "2.0",
    format: "json",
    partner_id: "DropshipStore/1.0",
  };

  const fullParams: Record<string, string> = {
    ...publicParams,
    biz_content: JSON.stringify(bizContent),
  };

  /* ---------- 2) sign ---------- */
  const signed = signAliRequest(fullParams, APP_SECRET);
  fullParams.sign = signed;

  /* ---------- 3) execute ---------- */
  const endpoint = `https://api-seller.aliexpress.com`;
  const body = new URLSearchParams(fullParams);

  const res = await fetch(endpoint, {
    method: "POST",
    body,
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });

  const json: any = await res.json();

  if (json?.error_response) {
    throw new Error(
      `AliExpress error ${json.error_response.code}: ${json.error_response.msg}`
    );
  }

  const result =
    json.aliexpress_logistics_ds_order_create_response?.result?.result_data;

  if (!result) throw new Error("Unexpected AliExpress response format");

  return {
    orderId: result.trade_order_id.toString(),
    trackingNumber: result.waybill_no_list?.[0]?.mail_no?.toString() ?? null,
    orderCost: Number(result.order_amount ?? 0) / 100, // convert cents → USD
  };
}

/* ---------- util: Open-Platform SHA-256 signer ---------- */
function signAliRequest(
  params: Record<string, string>,
  secret: string
): string {
  // sort keys asc
  const sortedKeys = Object.keys(params).sort();
  const baseStr =
    secret + sortedKeys.map((k) => k + params[k]).join("") + secret;
  return crypto
    .createHash("sha256")
    .update(baseStr)
    .digest("hex")
    .toUpperCase();
}

/* ─── exports ──────────────────────────────────────────────── */
export { AliToken }; // ← add this line
