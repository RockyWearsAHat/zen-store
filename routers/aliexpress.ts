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

// ─── OAuth endpoints based on provided documentation (docId=1590) ───────────
const AUTH_ENDPOINT =
  process.env.ALI_AUTH_ENDPOINT?.trim() ||
  "https://api-sg.aliexpress.com/oauth/authorize"; // Updated
const TOKEN_ENDPOINT =
  process.env.ALI_TOKEN_ENDPOINT?.trim() ||
  "https://api-sg.aliexpress.com/auth/token/create"; // Updated

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
    // This state is for our server to verify the callback, not necessarily sent to AliExpress
    // if their endpoint rejects it.
    const stateValueForSession = crypto.randomBytes(8).toString("hex");
    req.session.ali_oauth_state = stateValueForSession;

    req.session.save((err) => {
      if (err) {
        console.error("[AliExpress] Session save error before redirect:", err);
        res.status(500).send("Failed to save session before OAuth redirect.");
        return;
      }

      console.log(
        "[AliExpress] Constructing Auth URL with APP_KEY:",
        `"${APP_KEY}"`
      );
      console.log(
        "[AliExpress] Constructing Auth URL with REDIRECT_URI:",
        `"${REDIRECT_URI}"`
      );
      // Log the state we are storing, even if not sending
      console.log(
        "[AliExpress] Storing state in session:",
        `"${stateValueForSession}"`
      );

      // Parameters exactly as per the user-provided working URL:
      // response_type, force_auth, client_id, redirect_uri
      // Omitting state, view, and sp from the redirect to AliExpress
      const authParams = new URLSearchParams([
        ["response_type", "code"],
        ["force_auth", "true"],
        ["client_id", APP_KEY],
        ["redirect_uri", REDIRECT_URI], // URLSearchParams handles encoding
      ]);

      const authUrl = `${AUTH_ENDPOINT}?${authParams.toString()}`;
      console.log(
        "[AliExpress] Attempting OAuth URL (user-provided structure):",
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
  const returnedState = req.query.state as string | undefined; // State returned by AliExpress in query params, if any.

  const expectedStateFromSession = req.session.ali_oauth_state;

  // Clear the state from session immediately after retrieving it
  // to prevent reuse, regardless of what happens next.
  if (req.session) {
    delete req.session.ali_oauth_state;
    // Asynchronously save the session. If this fails, log it, but proceed with OAuth logic.
    // Critical operations should ideally await session save or handle its error more directly.
    req.session.save((err) => {
      if (err) {
        console.error(
          "[AliExpress] Error saving session after clearing state:",
          err
        );
      }
    });
  }

  // 1. Check if our server had set a state for this session.
  if (!expectedStateFromSession) {
    console.error(
      "[AliExpress] Session state (ali_oauth_state) missing. Possible session expiry, CSRF attempt, or cookies not enabled."
    );
    res
      .status(400)
      .send(
        "Session state missing or expired. Please try again or ensure cookies are enabled."
      );
    return;
  }

  // 2. Handle the 'state' parameter returned by AliExpress (if any).
  // Since the /oauth/start route currently does NOT send a 'state' parameter to AliExpress
  // (based on the user-provided working URL), AliExpress should NOT return a 'state' in the callback.
  // Thus, 'returnedState' is expected to be undefined.
  // If AliExpress *does* return a state, and it doesn't match what we stored, it's an issue.
  if (
    returnedState !== undefined &&
    returnedState !== expectedStateFromSession
  ) {
    console.warn(
      `[AliExpress] State mismatch! Returned by Authorization Server: "${returnedState}", Expected from session: "${expectedStateFromSession}". This is unexpected as state was not sent to AS in the initial request.`
    );
    res
      .status(400)
      .send(
        "Invalid state parameter returned by authorization server. Possible CSRF attempt."
      );
    return;
  }
  // If returnedState is undefined (as expected) and expectedStateFromSession is valid, the CSRF check based on state effectively passes.
  // The core protection is that expectedStateFromSession was present and unpredictable.

  if (!code) {
    res.status(400).send("Missing authorization code");
    return;
  }
  try {
    console.log("[AliExpress] Received code:", code);
    console.log("[AliExpress] Using APP_KEY for token exchange:", APP_KEY); // Ensure this is not empty/undefined
    console.log(
      "[AliExpress] Using APP_SECRET for token exchange (first 4 chars):",
      APP_SECRET ? APP_SECRET.slice(0, 4) + "..." : "(not set)"
    ); // Ensure this is not empty/undefined
    console.log(
      "[AliExpress] Using REDIRECT_URI for token exchange:",
      REDIRECT_URI
    );

    // Parameters for https://api-sg.aliexpress.com/auth/token/create
    // Required: client_id, client_secret, code.
    // Optional: redirect_uri, uuid.
    const tokenPairs: [string, string][] = [
      ["client_id", APP_KEY],
      ["client_secret", APP_SECRET],
      ["code", code!],
      ["redirect_uri", REDIRECT_URI],
    ];
    const body = tokenPairs
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");

    console.log(
      "[AliExpress] Token request body (for /auth/token/create):",
      body
    );

    const resp = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    let data: any;
    try {
      data = await resp.json();
    } catch (e) {
      const text = await resp.text();
      console.error("[AliExpress] Raw token response:", text);
      throw new Error("AliExpress token response not JSON: " + text);
    }

    // Check response structure from /auth/token/create
    // It might return 'expire_time' (a timestamp in ms) instead of 'expires_in' (a duration in seconds)
    if (!data.access_token) {
      console.error("[AliExpress] Token error payload:", data);
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

    let expiresInSeconds: number;
    if (data.expire_time && typeof data.expire_time === "number") {
      // If expire_time is a future timestamp in milliseconds
      expiresInSeconds = Math.floor((data.expire_time - Date.now()) / 1000);
    } else if (
      data.expires_in &&
      (typeof data.expires_in === "number" ||
        typeof data.expires_in === "string") // Corrected type check
    ) {
      // If expires_in is a duration in seconds
      expiresInSeconds = parseInt(String(data.expires_in), 10);
    } else {
      console.warn(
        "[Aliexpress] Token expiry information not found or in unexpected format, defaulting to 1 hour."
      );
      expiresInSeconds = 3600; // Default to 1 hour if not provided or recognized
    }

    if (isNaN(expiresInSeconds) || expiresInSeconds <= 0) {
      console.warn(
        `[Aliexpress] Invalid expiresInSeconds calculated: ${expiresInSeconds}. Defaulting to 1 hour.`
      );
      expiresInSeconds = 3600;
    }

    await AliToken.findOneAndUpdate(
      {},
      {
        access_token: data.access_token,
        refresh_token: data.refresh_token, // Ensure this field is returned by /auth/token/create
        expires_at: new Date(Date.now() + expiresInSeconds * 1000),
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
          <p><b>User Nick:</b> ${data.user_nick || "N/A"}</p>
          <p><b>Expires At:</b> ${new Date(
            Date.now() + expiresInSeconds * 1000
          ).toLocaleString()}</p>
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
