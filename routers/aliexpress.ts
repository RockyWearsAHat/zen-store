import { Request, Response, Router } from "express";
import { connectDB } from "../db";
import crypto from "crypto";
import mongoose from "mongoose";
// --- add express-session ---
import session from "express-session";

// --- Add this block to extend session type ---
declare module "express-session" {
  interface SessionData {
    ali_oauth_state?: string;
  }
}

// --- Mongoose model for tokens (define here) ---
const aliTokenSchema = new mongoose.Schema({
  access_token: String,
  refresh_token: String,
  expires_at: Date,
});
export const AliToken =
  mongoose.models.AliToken || mongoose.model("AliToken", aliTokenSchema);

// Ensure APP_KEY, APP_SECRET, and REDIRECT_URI are loaded and trimmed
const APP_KEY = (process.env.ALI_APP_KEY || "").trim();
const APP_SECRET = (process.env.ALI_APP_SECRET || "").trim();
const REDIRECT_URI = (
  process.env.ALI_REDIRECT_URI ||
  "https://zen-essentials.store/ali/oauth/callback"
).trim();

// Debug: Log the APP_KEY, APP_SECRET, and REDIRECT_URI at startup (mask secret)
console.log(
  "[AliExpress] Loaded APP_KEY:",
  APP_KEY ? `"${APP_KEY}"` : "(not set)"
);
console.log(
  "[AliExpress] Loaded APP_SECRET:",
  APP_SECRET ? APP_SECRET.slice(0, 4) + "..." : "(not set)"
);
console.log(
  "[AliExpress] Loaded REDIRECT_URI:",
  REDIRECT_URI ? `"${REDIRECT_URI}"` : "(not set)"
);

export const aliexpressRouter = Router();

// --- add session middleware (should be added to your main app, but for router-local use, add here) ---
aliexpressRouter.use(
  session({
    secret: process.env.SESSION_SECRET || "ali-session-secret",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }, // set to true if using HTTPS
  })
);

// Check for required env vars at startup
if (!APP_KEY || !APP_SECRET || !REDIRECT_URI) {
  console.error(
    "[AliExpress] Missing required environment variables: " +
      [
        !APP_KEY && "ALI_APP_KEY",
        !APP_SECRET && "ALI_APP_SECRET",
        !REDIRECT_URI && "REDIRECT_URI",
      ]
        .filter(Boolean)
        .join(", ")
  );
  // Optionally, throw here to fail fast:
  // throw new Error("Missing AliExpress env vars");
}

// Health check endpoint for debugging
aliexpressRouter.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    APP_KEY: !!APP_KEY,
    APP_SECRET: !!APP_SECRET,
    REDIRECT_URI: !!REDIRECT_URI,
  });
});

/* ────────────── AliExpress OAuth Endpoints ────────────── */

// ─── OAuth endpoints (allow override for easy testing) ───────────
const TOKEN_ENDPOINT =
  process.env.ALI_TOKEN_ENDPOINT?.trim() ||
  "https://oauth.aliexpress.com/token";

// Step 1: Start OAuth (build authorize URL) -----------------------
aliexpressRouter.get("/oauth/start", (req, res) => {
  try {
    // Check for missing or empty APP_KEY
    if (!APP_KEY) {
      res
        .status(500)
        .send(
          "AliExpress not configured: APP_KEY missing or empty. Please set ALI_APP_KEY in your environment."
        );
      return;
    }
    if (!REDIRECT_URI) {
      res.status(500).send("AliExpress not configured (missing REDIRECT_URI)");
      return;
    }
    // Generate a random state and store in session for CSRF protection
    const state = crypto.randomBytes(8).toString("hex");
    req.session.ali_oauth_state = state;

    // Ensure session is saved before redirecting, especially for async stores
    req.session.save((err) => {
      if (err) {
        console.error("[AliExpress] Session save error before redirect:", err);
        res.status(500).send("Failed to save session before OAuth redirect.");
        return;
      }

      // Log for debugging - these are the critical values for the auth URL
      console.log(
        "[AliExpress] Constructing Auth URL with APP_KEY:",
        `"${APP_KEY}"`
      );
      console.log(
        "[AliExpress] Constructing Auth URL with REDIRECT_URI:",
        `"${REDIRECT_URI}"`
      );
      console.log(
        "[AliExpress] Constructing Auth URL with state:",
        `"${state}"`
      );

      // Parameters in the order specified by AliExpress documentation:
      // client_id, response_type, redirect_uri, sp, state, view
      const authParams = new URLSearchParams([
        ["client_id", APP_KEY],
        ["response_type", "code"],
        ["redirect_uri", REDIRECT_URI],
        ["sp", "ae"], // Re-added
        ["state", state],
        ["view", "web"], // Re-added
      ]);

      const authUrl = `https://oauth.aliexpress.com/authorize?${authParams.toString()}`;
      console.log(
        "[AliExpress] Attempting OAuth URL (with sp & view):",
        authUrl
      );
      res.redirect(authUrl);
    });
  } catch (err: any) {
    console.error("OAuth start error:", err);
    res
      .status(500)
      .send("Failed to build AliExpress OAuth URL: " + err.message);
  }
});

// Step 2: OAuth callback, exchange code for tokens (use correct POST body)
aliexpressRouter.get("/oauth/callback", async (req: Request, res: Response) => {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;

  // Check state for CSRF protection
  if (!req.session || !req.session.ali_oauth_state) {
    res.status(400).send("Session missing or expired. Please try again.");
    return;
  }
  if (state !== req.session.ali_oauth_state) {
    res.status(400).send("Invalid state parameter (possible CSRF)");
    return;
  }
  // Optionally clear state after use
  delete req.session.ali_oauth_state;
  req.session.save(); // ensure session is saved

  if (!code) {
    res.status(400).send("Missing authorization code");
    return;
  }
  try {
    console.log("[AliExpress] Received code:", code);
    console.log("[AliExpress] Using APP_KEY:", APP_KEY);
    console.log("[AliExpress] Using REDIRECT_URI:", REDIRECT_URI);

    // Doc-ordered body for token exchange: grant_type, code, client_id, client_secret, redirect_uri, sp, view, state
    const tokenPairs: [string, string][] = [
      ["grant_type", "authorization_code"], // 1
      ["code", code], // 2
      ["client_id", APP_KEY], // 3
      ["client_secret", APP_SECRET], // 4
      ["redirect_uri", REDIRECT_URI], // 5
      ["sp", "ae"], // 6
      ["view", "web"], // 7 (Optional, but good to include if used in auth)
      ["state", state || ""], // 8 (Optional, but good to include if used in auth)
    ];
    const body = tokenPairs
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");

    console.log("[AliExpress] Token request body:", body);

    const resp = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    let data: any;
    try {
      data = await resp.json();
    } catch {
      // dump raw text to diagnose AliExpress errors
      const text = await resp.text();
      console.error("[AliExpress] Raw token response:", text);
      throw new Error("AliExpress token response not JSON: " + text);
    }

    if (!data.access_token) {
      console.error("[AliExpress] Token error payload:", data); // extra log
      // Show error to user for debugging
      res.status(500).send(`
        <html>
          <head><title>AliExpress OAuth Error</title></head>
          <body>
            <h1>❌ AliExpress OAuth Error</h1>
            <pre>${JSON.stringify(data, null, 2)}</pre>
            <p>${data.error_description || "No access_token returned"}</p>
          </body>
        </html>
      `);
      return;
    }

    await connectDB();
    await AliToken.findOneAndUpdate(
      {},
      {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: new Date(
          Date.now() + (parseInt(data.expires_in, 10) || 0) * 1000
        ), // Ensure expires_in is treated as number
      },
      { upsert: true, new: true }
    );

    res.send(`
      <html>
        <head><title>AliExpress Connected</title></head>
        <body>
          <h1>✅ AliExpress Connected</h1>
          <p>Your AliExpress account has been successfully connected.</p>
          <p><b>Access Token:</b> ${data.access_token}</p> 
          <p><b>Refresh Token:</b> ${data.refresh_token || "N/A"}</p>
          <p><b>Expires In:</b> ${data.expires_in} seconds</p>
          <p><b>Note:</b> Refresh tokens functionality might vary. If your access token expires, you may need to re-authorize.</p>
        </body>
      </html>
    `);
  } catch (err: any) {
    console.error("OAuth callback error:", err);
    res.status(500).send(`
      <html>
        <head><title>AliExpress OAuth Error</title></head>
        <body>
          <h1>❌ AliExpress OAuth Error</h1>
          <pre>${err?.message || err}</pre>
        </body>
      </html>
    `);
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
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

// Helper: get valid access token (refresh if needed)
async function getAliAccessToken(): Promise<string> {
  try {
    await connectDB();
    let token = await AliToken.findOne().exec();
    if (!token) throw new Error("AliExpress not connected");
    if (
      token.expires_at &&
      token.expires_at.getTime() < Date.now() + 60 * 1000
    ) {
      // refresh if expiring in <1min
      const tokenUrl = "https://api-sg.aliexpress.com/oauth2/token";
      const params = new URLSearchParams();
      params.append("grant_type", "refresh_token");
      params.append("client_id", APP_KEY);
      params.append("client_secret", APP_SECRET);
      params.append("refresh_token", token.refresh_token);

      const resp = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params,
      });
      const data = await resp.json();
      if (!data.access_token)
        throw new Error(data.error_description || "No access_token");
      token.access_token = data.access_token;
      token.refresh_token = data.refresh_token || token.refresh_token;
      token.expires_at = new Date(Date.now() + data.expires_in * 1000);
      await token.save();
    }
    return token.access_token;
  } catch (err: any) {
    console.error("AliExpress token error:", err);
    throw err;
  }
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
  try {
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
        getOrderData.aliexpress_trade_ds_order_get_response?.result
          ?.order_amount
      ) || 0;

    return {
      orderId,
      trackingNumber,
      orderCost,
    };
  } catch (err: any) {
    console.error("AliExpress order error:", err);
    throw new Error("AliExpress order failed: " + (err?.message || err));
  }
}
