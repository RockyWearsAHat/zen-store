import { Request, Response, Router } from "express";
import "dotenv/config";
import { connectDB } from "../db";
import crypto from "crypto";
import mongoose from "mongoose";

// --- Mongoose model for tokens (define here) ---
const aliTokenSchema = new mongoose.Schema({
  access_token: String,
  refresh_token: String,
  expires_at: Date,
});
export const AliToken =
  mongoose.models.AliToken || mongoose.model("AliToken", aliTokenSchema);

const APP_KEY = process.env.ALI_APP_KEY!;
const APP_SECRET = process.env.ALI_APP_SECRET!;
const REDIRECT_URI = "https://zen-essentials.store/ali/oauth/callback";

export const aliexpressRouter = Router();

/* ────────────── AliExpress OAuth Endpoints ────────────── */

// Step 1: Start OAuth
aliexpressRouter.get("/ali/oauth/start", (_req, res) => {
  const state = crypto.randomBytes(8).toString("hex");
  const authUrl = `https://auth.aliexpress.com/oauth2/authorize?app_key=${APP_KEY}&redirect_uri=${encodeURIComponent(
    REDIRECT_URI
  )}&response_type=code&state=${state}&site=aliexpress`;
  res.redirect(authUrl);
});

// Step 2: OAuth callback, exchange code for tokens
aliexpressRouter.get(
  "/ali/oauth/callback",
  async (req: Request, res: Response) => {
    const code = req.query.code as string | undefined;
    if (!code) {
      res.status(400).send("Missing authorization code");
      return;
    }
    try {
      // Build params for /rest/oauth2/token
      const grant_type = "authorization_code";
      const timestamp = Date.now();
      const params: Record<string, string> = {
        app_key: APP_KEY,
        grant_type,
        code,
        redirect_uri: REDIRECT_URI,
        timestamp: timestamp.toString(),
        sign_method: "sha256",
      };
      const sign = signAliParams(params, APP_SECRET);
      const url = `https://api-sg.aliexpress.com/rest/oauth2/token?${toQueryString(
        {
          ...params,
          sign,
        }
      )}`;

      const resp = await fetch(url, { method: "POST" });
      const data = await resp.json();

      if (!data.access_token)
        throw new Error(data.error_description || "No access_token");

      await connectDB();
      await AliToken.findOneAndUpdate(
        {},
        {
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_at: new Date(Date.now() + data.expires_in * 1000),
        },
        { upsert: true, new: true }
      );

      res.send(`
      <html>
        <head><title>AliExpress Connected</title></head>
        <body>
          <h1>✅ AliExpress Connected</h1>
          <p>Your AliExpress account has been successfully connected.</p>
        </body>
      </html>
    `);
    } catch (err: any) {
      res.status(500).send("OAuth error: " + err.message);
    }
  }
);

// Step 3: Manual token refresh
aliexpressRouter.post("/ali/oauth/manual-refresh", async (_req, res) => {
  try {
    await connectDB();
    const token = await AliToken.findOne().exec();
    if (!token) {
      res.status(404).json({ error: "No token found in database" });
      return;
    }
    const grant_type = "refresh_token";
    const timestamp = Date.now();
    const params: Record<string, string> = {
      app_key: APP_KEY,
      grant_type,
      refresh_token: token.refresh_token,
      timestamp: timestamp.toString(),
      sign_method: "sha256",
    };
    const sign = signAliParams(params, APP_SECRET);
    const url = `https://api-sg.aliexpress.com/rest/oauth2/token?${toQueryString(
      {
        ...params,
        sign,
      }
    )}`;

    const resp = await fetch(url, { method: "POST" });
    const data = await resp.json();

    if (!data.access_token)
      throw new Error(data.error_description || "No access_token");

    token.access_token = data.access_token;
    token.refresh_token = data.refresh_token || token.refresh_token;
    token.expires_at = new Date(Date.now() + data.expires_in * 1000);
    await token.save();

    res.json({ success: true, expires_at: token.expires_at });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ────────────── AliExpress Dropshipping API Helpers ────────────── */

// Helper: sign AliExpress API params (sha256, per docs)
function signAliParams(params: Record<string, string>, secret: string): string {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => k + params[k])
    .join("");
  const base = secret + sorted + secret;
  return crypto.createHash("sha256").update(base).digest("hex").toUpperCase();
}
function toQueryString(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

// Helper: get valid access token (refresh if needed)
async function getAliAccessToken(): Promise<string> {
  await connectDB();
  let token = await AliToken.findOne().exec();
  if (!token) throw new Error("AliExpress not connected");
  if (token.expires_at && token.expires_at.getTime() < Date.now() + 60 * 1000) {
    // refresh if expiring in <1min
    // ...refresh logic (reuse manual-refresh endpoint logic)...
    const grant_type = "refresh_token";
    const timestamp = Date.now();
    const params: Record<string, string> = {
      app_key: APP_KEY,
      grant_type,
      refresh_token: token.refresh_token,
      timestamp: timestamp.toString(),
      sign_method: "sha256",
    };
    const sign = signAliParams(params, APP_SECRET);
    const url = `https://api-sg.aliexpress.com/rest/oauth2/token?${toQueryString(
      {
        ...params,
        sign,
      }
    )}`;
    const resp = await fetch(url, { method: "POST" });
    const data = await resp.json();
    if (!data.access_token)
      throw new Error(data.error_description || "No access_token");
    token.access_token = data.access_token;
    token.refresh_token = data.refresh_token || token.refresh_token;
    token.expires_at = new Date(Date.now() + data.expires_in * 1000);
    await token.save();
  }
  return token.access_token;
}

/* ---------- Place AliExpress Dropshipping Order ---------- */
export interface AliOrderResult {
  orderId: string;
  trackingNumber: string;
  orderCost: number;
}

export async function createAliExpressOrder(
  items: { id: string; quantity: number }[],
  shipping: any
): Promise<AliOrderResult> {
  const access_token = await getAliAccessToken();
  const timestamp = Date.now();
  // 1. Create order (method: aliexpress.trade.ds.order.create)
  const method = "aliexpress.trade.ds.order.create";
  const bizParams = {
    out_order_id: "order_" + Date.now(),
    product_items: items.map((i) => ({
      product_id: i.id,
      quantity: i.quantity,
    })),
    address: shipping?.address,
    contact_person: shipping?.name,
    country_code: shipping?.country_code,
    // ...add other required fields per API...
  };
  const params: Record<string, string> = {
    method,
    app_key: APP_KEY,
    access_token,
    timestamp: timestamp.toString(),
    sign_method: "sha256",
    param_json: JSON.stringify(bizParams),
  };
  const sign = signAliParams(params, APP_SECRET);
  const url = `https://api-sg.aliexpress.com/sync?${toQueryString({
    ...params,
    sign,
  })}`;
  const resp = await fetch(url, { method: "POST" });
  const data = await resp.json();

  if (!data.aliexpress_trade_ds_order_create_response?.result?.order_id) {
    throw new Error(
      "AliExpress order creation failed: " + JSON.stringify(data)
    );
  }
  const orderId =
    data.aliexpress_trade_ds_order_create_response.result.order_id;

  // 2. Pay for order (method: aliexpress.trade.ds.order.pay)
  const payMethod = "aliexpress.trade.ds.order.pay";
  const payParams: Record<string, string> = {
    method: payMethod,
    app_key: APP_KEY,
    access_token,
    timestamp: Date.now().toString(),
    sign_method: "sha256",
    param_json: JSON.stringify({ order_id: orderId }),
  };
  const paySign = signAliParams(payParams, APP_SECRET);
  const payUrl = `https://api-sg.aliexpress.com/sync?${toQueryString({
    ...payParams,
    sign: paySign,
  })}`;
  const payResp = await fetch(payUrl, { method: "POST" });
  const payData = await payResp.json();
  console.log("Pay response:", payData);

  // 3. Get tracking number (method: aliexpress.logistics.ds.trackinginfo.query)
  const trackMethod = "aliexpress.logistics.ds.trackinginfo.query";
  const trackParams: Record<string, string> = {
    method: trackMethod,
    app_key: APP_KEY,
    access_token,
    timestamp: Date.now().toString(),
    sign_method: "sha256",
    param_json: JSON.stringify({ order_id: orderId }),
  };
  const trackSign = signAliParams(trackParams, APP_SECRET);
  const trackUrl = `https://api-sg.aliexpress.com/sync?${toQueryString({
    ...trackParams,
    sign: trackSign,
  })}`;
  const trackResp = await fetch(trackUrl, { method: "POST" });
  const trackData = await trackResp.json();
  const trackingNumber =
    trackData.aliexpress_logistics_ds_trackinginfo_query_response?.result_list
      ?.result?.[0]?.logistics_no ?? "PENDING";

  // 4. Get order cost (method: aliexpress.trade.ds.order.get)
  const getOrderMethod = "aliexpress.trade.ds.order.get";
  const getOrderParams: Record<string, string> = {
    method: getOrderMethod,
    app_key: APP_KEY,
    access_token,
    timestamp: Date.now().toString(),
    sign_method: "sha256",
    param_json: JSON.stringify({ order_id: orderId }),
  };
  const getOrderSign = signAliParams(getOrderParams, APP_SECRET);
  const getOrderUrl = `https://api-sg.aliexpress.com/sync?${toQueryString({
    ...getOrderParams,
    sign: getOrderSign,
  })}`;
  const getOrderResp = await fetch(getOrderUrl, { method: "POST" });
  const getOrderData = await getOrderResp.json();
  const orderCost =
    Number(
      getOrderData.aliexpress_trade_ds_order_get_response?.result?.order_amount
    ) || 0;

  return {
    orderId,
    trackingNumber,
    orderCost,
  };
}

/* ─── exports ──────────────────────────────────────────────── */
export { aliexpressRouter as aliexpressaliexpressRouter };
