import { Request, Response, NextFunction, Router } from "express";
import crypto from "crypto";
import mongoose from "mongoose";
// --- add express-session ---
import session from "express-session";
import { connectDB } from "../server/db";

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
  last_refresh_at: Date, // ← used both for throttle & atomic lock
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
  "https://api-sg.aliexpress.com/oauth/authorize";
const TOKEN_ENDPOINT = // Updated to include /rest
  process.env.ALI_TOKEN_ENDPOINT?.trim() ||
  "https://api-sg.aliexpress.com/rest/auth/token/create";
const REFRESH_TOKEN_ENDPOINT = // Added for refresh token
  process.env.ALI_REFRESH_TOKEN_ENDPOINT?.trim() ||
  "https://api-sg.aliexpress.com/rest/auth/token/refresh";

/* ────── constants for timing ────── */
const ONE_MIN = 60_000;
const ONE_DAY = 24 * 60 * ONE_MIN;
const THREE_DAYS = 3 * ONE_DAY; // ← new buffer
const THROTTLE_MS = 10_000; // ← min gap between real AliExpress calls

/* ---------- helpers ---------- */
function pickExpiry(json: any): Date {
  const nowMs = Date.now();
  const rel = Number(json?.expires_in); // seconds
  const ms = (!isNaN(rel) && rel > 0 ? rel : ONE_DAY / 1000) * 1000;
  return new Date(nowMs + ms); // keep in UTC
}

function fmtMT(date: Date): string {
  return date.toLocaleString("en-US", { timeZone: "America/Denver" });
}

/* ---------- Step 1: Start OAuth (build authorize URL) ----------------------- */
aliexpressRouter.get("/oauth/start", requireAliInitAllowed, (req, res) => {
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

/* ---------- Step 2: OAuth callback, exchange code for tokens (use correct POST body) */
aliexpressRouter.get(
  "/oauth/callback",
  requireAliInitAllowed,
  async (req: Request, res: Response) => {
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

      const timestamp = Date.now().toString();
      const signMethod = "sha256"; // This is the value for the sign_method parameter

      // Parameters that will be sent in the request body (and thus need to be signed, except 'sign' itself)
      // According to new signature docs: "Sort all request parameters (including system and application parameters,
      // but except the “sign” and parameters with byte array type...)"
      // This means client_secret and sign_method, if sent as parameters, should be included.
      const paramsForSignatureAndBody: Record<string, string> = {
        app_key: APP_KEY,
        client_secret: APP_SECRET, // Required parameter for /auth/token/create action
        code: code!,
        redirect_uri: REDIRECT_URI,
        timestamp: timestamp,
        sign_method: signMethod, // This parameter itself is part of the signature base
      };

      const apiPath = "/auth/token/create"; // API path for this action
      const sign = signAliExpressRequest(
        apiPath,
        paramsForSignatureAndBody,
        APP_SECRET
      );

      // All parameters to be sent in the body
      const tokenPairs: [string, string][] = [
        ...Object.entries(paramsForSignatureAndBody),
        ["sign", sign],
      ];

      const body = tokenPairs
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join("&");

      console.log(
        `[AliExpress] Token request to ${TOKEN_ENDPOINT} with body:`,
        body
      );

      const resp = await fetch(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });

      const responseText = await resp.text();
      let responseData: any; // Changed from outerData

      try {
        responseData = JSON.parse(responseText);
      } catch (e) {
        console.error(
          "[AliExpress] Raw token response (not JSON):",
          responseText
        );
        res.status(500).send(`
          <html>
            <head><title>AliExpress OAuth Error</title></head>
            <body>
              <h1>❌ AliExpress OAuth Error</h1>
              <p>Received non-JSON response from token endpoint.</p>
              <pre>${responseText}</pre>
            </body>
          </html>`);
        return;
      }

      // Assuming token endpoints return direct JSON, not GOP-wrapped.
      // Check for errors directly in responseData.
      // Error if responseData.code is present and not "0", OR if access_token is missing.
      if (
        (responseData.code && responseData.code !== "0") ||
        !responseData.access_token
      ) {
        console.error("[AliExpress] Token error payload:", responseData);
        res.status(500).send(`
          <html>
            <head><title>AliExpress Token Error</title></head>
            <body>
              <h1>❌ AliExpress Token Error</h1>
              <pre>${JSON.stringify(responseData, null, 2)}</pre>
              <p>${
                responseData.error_description || // Standard OAuth
                responseData.sub_msg || // AliExpress specific
                responseData.msg || // AliExpress specific
                responseData.message || // Common error field
                "Error in token response or no access_token returned"
              }</p>
            </body>
          </html>
        `);
        return;
      }

      /* ---------- OAuth callback : derive expiresAt ---------- */
      const expiresAt = pickExpiry(responseData);

      // Ensure database is connected before writing tokens
      await connectDB();

      const savedToken = await AliToken.findOneAndUpdate(
        {},
        {
          access_token: responseData.access_token,
          refresh_token: responseData.refresh_token,
          expires_at: expiresAt,
        },
        { upsert: true, new: true }
      );

      if (savedToken && savedToken.expires_at) {
        console.log("[AliExpress] New token saved via OAuth.");
      }

      res.send(`
        <html>
          <head><title>AliExpress Connected</title></head>
          <body>
            <h1>✅ AliExpress Connected</h1>
            <p>Your AliExpress account has been successfully connected.</p>
            <p><b>Access Token:</b> ${responseData.access_token}</p> 
            <p><b>Refresh Token:</b> ${responseData.refresh_token || "N/A"}</p>
            <p><b>User Nick:</b> ${responseData.user_nick || "N/A"}</p>
            <p><b>Expires At (MT):</b> ${fmtMT(expiresAt)}</p>
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
  }
);

/* ──────────────────────────────────────────────────────────────── *
 *  AliExpress Dropshipping – PLACE ORDER & TRACKING HELPERS       *
 * ──────────────────────────────────────────────────────────────── */

const LIVE_BASE_URL = "https://api-sg.aliexpress.com";
const TEST_BASE_URL = "https://api-sg.aliexpress.com"; // ← put sandbox URL if different
const ALI_BASE_URL =
  process.env.ALI_TEST_ENVIRONMENT === "true" ? TEST_BASE_URL : LIVE_BASE_URL;

/* ---------- helper : TOP timestamp (UTC+8) -------------------- */
function topTimestamp(): string {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000); // shift to UTC+8
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(
      d.getUTCDate()
    )} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(
      d.getUTCSeconds()
    )}`
  );
}

/* ---------- fetchRecommendedService : aliexpress.logistics.ds.recommend.list --- */
const svcCache = new Map<string, string>();

async function fetchRecommendedService(
  productId: number,
  skuAttr: string,
  country: string,
  province: string
): Promise<string> {
  const key = `${productId}|${skuAttr}|${country}|${province}`;
  if (svcCache.has(key)) return svcCache.get(key)!;

  const accessToken = await getAliAccessToken();
  const apiPath = "/sync";
  const method = "aliexpress.logistics.ds.recommend.list";
  const params: Record<string, string> = {
    app_key: APP_KEY,
    method,
    access_token: accessToken,
    timestamp: topTimestamp(),
    sign_method: "sha256",
    v: "2.0",
    product_id: String(productId),
    sku_attr: skuAttr,
    country_code: country,
    province,
  };
  const sign = signAliExpressRequest(apiPath, params, APP_SECRET);
  const body = new URLSearchParams({ ...params, sign }).toString();

  const raw = await fetch(`${ALI_BASE_URL}${apiPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  }).then((r) => r.text());

  const json: any = JSON.parse(raw);
  const svc =
    json?.aliexpress_logistics_ds_recommend_list_response?.result
      ?.recommend_solutions?.recommend_solution?.[0]?.logistics_service_name ??
    "";
  if (svc) svcCache.set(key, svc);
  console.log("[AliExpress] recommend service for", key, "→", svc || "—");
  return svc || "CAINIAO_STANDARD";
}

/* ---------- createAliExpressOrder ----------------------------------------- */
export interface AliItem {
  id: string | number;
  quantity: number;
  sku_attr?: string; // optional, default ""
}

export async function createAliExpressOrder(
  items: AliItem[],
  shipping: any,
  outOrderId?: string
): Promise<{
  orderId: string;
  trackingNumber: string | null;
  orderCost: number | null;
}> {
  console.log("[AliExpress] createAliExpressOrder called", {
    items,
    outOrderId,
  });

  if (!items?.length) throw new Error("createAliExpressOrder: empty items[]");

  const accessToken = await getAliAccessToken();

  /* ---------- AliExpress TOP parameters ---------- */
  const sysParams: Record<string, string> = {
    app_key: APP_KEY,
    method: "aliexpress.ds.order.create",
    access_token: accessToken,
    timestamp: topTimestamp(), // ← formatted timestamp
    sign_method: "sha256",
    v: "2.0",
  };

  if (!shipping || typeof shipping !== "object") {
    throw new Error("createAliExpressOrder: shipping address missing/invalid");
  }

  console.log("[AliExpress] shipping received:", shipping);

  /* ---------- ensure logistics_service_name for every item ------------- */
  const filledItems = await Promise.all(
    items.map(async (i) => {
      const svc = await fetchRecommendedService(
        Number(i.id),
        i.sku_attr ?? "",
        shipping.country,
        shipping.province
      );
      return {
        product_id: Number(i.id),
        product_count: i.quantity ?? 1,
        sku_attr: i.sku_attr ?? "",
        logistics_service_name: svc,
      };
    })
  );

  /* ---------- sanitise / flatten shipping ---------- */
  const flatShip = (() => {
    const s = shipping || {};
    return {
      address: s.address ?? "",
      address2: s.address2 ?? "",
      city: s.city ?? "",
      country: s.country ?? "",
      province: s.province ?? "",
      zip: s.zip ?? "",
      contact_person: s.contact_person ?? "",
      phone_country: s.phone_country ?? "1",
      mobile_no: s.mobile_no ?? "",
    };
  })();

  /* ---------- business parameters ---------- */
  const placeOrderDTO = {
    out_order_id: outOrderId ?? `od-${Date.now()}`,
    logistics_address: [flatShip], // ← use cleaned object
    product_items: filledItems,
  };

  const dsExtendRequest = {
    /* Promotion block — promotion_channel_info is *required* */
    promotion: {
      promotion_code: "",
      promotion_channel_info: "DS",
    },
    /* Payment block */
    payment: {
      pay_currency: "USD",
      try_to_pay:
        process.env.ALI_TEST_ENVIRONMENT === "true" ? "false" : "true",
    },
  };

  const apiPath = "/sync";
  const allParamsForSign = {
    ...sysParams,
    ds_extend_request: JSON.stringify(dsExtendRequest),
    param_place_order_request4_open_api_d_t_o: JSON.stringify(placeOrderDTO),
  };

  /* ---------- signature ---------- */
  const sign = signAliExpressRequest(apiPath, allParamsForSign, APP_SECRET);

  /* ---------- POST body ---------- */
  const body = new URLSearchParams({ ...allParamsForSign, sign }).toString();

  console.log("[AliExpress] → POST", `${ALI_BASE_URL}${apiPath}`);

  /* ---------- HTTP call ---------- */
  const url = `${ALI_BASE_URL}${apiPath}`;
  console.log("[AliExpress] → POST", url);

  const rawText = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  }).then((r) => r.text());

  console.log("[AliExpress] ← RAW", rawText.slice(0, 400));

  /* ---------- parse response ---------- */
  let json: any;
  try {
    json = JSON.parse(rawText);
  } catch (e) {
    throw new Error("createAliExpressOrder: non-JSON response");
  }

  const res =
    json?.aliexpress_ds_order_create_response?.result ?? json?.result ?? null;

  if (!res?.is_success) {
    console.error("[AliExpress] Order create failed:", res);
    throw new Error(res?.error_msg || "ORDER_CREATE_FAILED");
  }

  const orderId = String(
    res.order_list?.number?.[0] ?? res.order_list?.[0] ?? "unknown"
  );

  /* ---------- optional: immediately ask for tracking ---------- */
  let trackingNumber: string | null = null;
  try {
    trackingNumber = await getAliOrderTracking(orderId);
  } catch (e) {
    console.warn("[AliExpress] tracking not yet available for", orderId);
  }

  return {
    orderId,
    trackingNumber,
    orderCost: null, // API does not return cost; keep for future
  };
}

/* ---------- getAliOrderTracking ------------------------------------------ */
async function getAliOrderTracking(
  orderId: string,
  lang = "en_US"
): Promise<string | null> {
  const accessToken = await getAliAccessToken();

  const method = "aliexpress.ds.order.tracking.get";
  const apiPath = "/sync";
  const sysParams: Record<string, string> = {
    app_key: APP_KEY,
    method,
    sign_method: "sha256",
    timestamp: topTimestamp(), // ← formatted timestamp
    access_token: accessToken,
    ae_order_id: orderId,
    language: lang,
  };

  const sign = signAliExpressRequest(apiPath, sysParams, APP_SECRET);
  const body = new URLSearchParams({ ...sysParams, sign }).toString();

  const url = `${ALI_BASE_URL}${apiPath}`;
  console.log("[AliExpress] → POST", url, "(tracking)");

  const raw = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  }).then((r) => r.text());

  const json = JSON.parse(raw);
  const data =
    json?.aliexpress_ds_order_tracking_get_response?.result?.data ??
    json?.result?.data ??
    null;

  const track =
    data?.tracking_detail_line_list?.tracking_detail?.[0]?.mail_no ?? null;
  return track;
}

/* ────────────── AliExpress Dropshipping API Helpers ────────────── */

/* ─────────────── precise TOP-HMAC-SHA256 signer ─────────────── */
function signAliExpressRequest(
  apiPath: string,
  rawParams: Record<string, any>,
  appSecret: string
): string {
  // 1) drop sign / null / undefined
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawParams)) {
    if (k === "sign" || v === undefined || v === null) continue;
    params[k] = String(v); // keep empty-string values
  }

  // 2) ASCII sort
  const sortedKeys = Object.keys(params).sort();

  // 3) concat key+value
  let concatenated = "";
  for (const k of sortedKeys) concatenated += k + params[k];

  // 4) prepend API name ONLY for system interfaces (≠ /sync)
  const stringToSign =
    apiPath === "/sync" ? concatenated : apiPath + concatenated;

  // 5) HMAC-SHA256 -> upper hex
  return crypto
    .createHmac("sha256", appSecret)
    .update(stringToSign, "utf8")
    .digest("hex")
    .toUpperCase();
}

/* -------------------- getAliAccessToken -------------------- */
async function getAliAccessToken(
  forceRefresh = false,
  skipDB = false // NEW: don’t reconnect when caller already did
): Promise<string> {
  try {
    if (!skipDB) await connectDB();
    let tokenDoc: any = await AliToken.findOne().exec();
    if (!tokenDoc?.access_token) throw new Error("AliExpress token missing");

    const now = Date.now();
    const expMs = tokenDoc.expires_at?.getTime() ?? 0;
    const lastStr = tokenDoc.last_refresh_at?.toISOString() ?? "n/a";
    const expSoon = !expMs || expMs - now < THREE_DAYS;
    const must =
      forceRefresh ||
      (!tokenDoc.access_token && tokenDoc.refresh_token) ||
      expSoon;

    console.log(
      `[AliExpress] getAliAccessToken | force=${forceRefresh} expSoon=${expSoon} mustRefresh=${must} ` +
        `expires_at=${tokenDoc.expires_at?.toISOString() ?? "n/a"} ` +
        `last_refresh_at=${lastStr}`
    );

    if (!must) return tokenDoc.access_token;
    if (!tokenDoc.refresh_token)
      throw new Error("No refresh_token available to refresh.");

    /* ---------- build body exactly like /oauth/callback ---------- */
    const ts = Date.now().toString(); // OAuth expects epoch-ms

    const base = {
      app_key: APP_KEY,
      client_secret: APP_SECRET,
      refresh_token: tokenDoc.refresh_token,
      timestamp: ts,
      sign_method: "sha256",
    } as Record<string, string>;
    const sign = signAliExpressRequest("/auth/token/refresh", base, APP_SECRET);
    const body = new URLSearchParams({ ...base, sign }).toString();

    console.log("[AliExpress] → POST", REFRESH_TOKEN_ENDPOINT);

    /* ---------- single fetch, no AbortController ---------- */
    const rawRes = await fetch(REFRESH_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    }).then((r) => r.text());

    console.log("[AliExpress] ← RAW", rawRes.slice(0, 400));

    const json = JSON.parse(rawRes);
    if (json.code !== "0" || !json.access_token) {
      console.error("[AliExpress] Refresh error payload:", json);
      throw new Error("REFRESH_REJECTED");
    }

    if (json.refresh_token === json.access_token) {
      console.warn("[AliExpress] refresh_token duplicated, keeping old value");
      delete json.refresh_token;
    }

    /* ---------- persist ---------- */
    const update = {
      expires_at: pickExpiry(json),
      access_token: json.access_token,
      refresh_token: json.refresh_token || tokenDoc.refresh_token,
      last_refresh_at: new Date(),
    };
    tokenDoc = await AliToken.findOneAndUpdate({ _id: tokenDoc._id }, update, {
      new: true,
      upsert: false,
    });
    console.log("[AliExpress] Tokens saved, next expiry:", tokenDoc.expires_at);
    return tokenDoc.access_token;
  } catch (err) {
    console.error("[AliExpress] getAliAccessToken fatal:", err);
    throw err;
  }
}

/* ---------- atomic refresh runner (3-day rule + 10-s lock) ---------- */
async function refreshIfNeeded(): Promise<void> {
  const now = Date.now();
  const lockCutoff = new Date(now - THROTTLE_MS);
  const expiryCut = new Date(now + THREE_DAYS);

  await connectDB(); // single connect

  const docBefore: any = await AliToken.findOne().lean().exec();
  if (!docBefore) {
    console.warn("[AliExpress] No AliToken doc.");
    return;
  }

  console.log(
    `[AliExpress] refresh? exp<=3d=${
      docBefore.expires_at && docBefore.expires_at <= expiryCut
    } | 10sGap=${
      !docBefore.last_refresh_at || docBefore.last_refresh_at <= lockCutoff
    }`
  );

  const doc: any = await AliToken.findOneAndUpdate(
    {
      _id: docBefore._id,
      expires_at: { $lte: expiryCut },
      $or: [
        { last_refresh_at: { $exists: false } },
        { last_refresh_at: { $lte: lockCutoff } },
      ],
    },
    { last_refresh_at: new Date(now) }, // take slot
    { new: true }
  ).exec();

  if (!doc) return; // throttled / not due
  console.log("[AliExpress] Slot reserved, refreshing …");

  try {
    await getAliAccessToken(true, true); // reuse connection
    await AliToken.updateOne({ _id: doc._id }, { last_refresh_at: new Date() });
    console.log("[AliExpress] Refresh success.");
  } catch (e) {
    console.error("[AliExpress] Refresh failed:", e);
    await AliToken.updateOne(
      { _id: doc._id },
      { last_refresh_at: new Date(now - 1000) } // quick retry possible
    );
  }
}

/* ---------- /ali/refresh : run refresh synchronously ---------- */
aliexpressRouter.get("/refresh", async (_req, res) => {
  try {
    await refreshIfNeeded(); // keep lambda alive until done
    res.json({ ok: true });
  } catch (e) {
    console.error("[AliExpress] Refresh endpoint error:", e);
    res.status(500).json({ ok: false });
  }
});

/* ---------- /redeploy (same logic) ---------- */
aliexpressRouter.post("/redeploy", async (_req, res) => {
  try {
    await connectDB();
    await getAliAccessToken(true, true); // reuse connection
    res.status(200).send("Redeploy request processed.");
  } catch (e: any) {
    console.error("[AliExpress] Redeploy refresh failed:", e);
    res.status(500).send("Redeploy refresh failed.");
  }
});

/* ---------- guard middleware ---------- */
function requireAliInitAllowed(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!ALI_INIT_ALLOWED) {
    res
      .status(403)
      .send("AliExpress initialization is disabled on this environment.");
    return;
  }
  next();
}

const ALI_INIT_ALLOWED = process.env.ALLOW_ALI_INITIALIZATION === "true";

/* ---------- fetchSkuAttr : call aliexpress.ds.product.get ------------- */
export async function fetchSkuAttr(
  productId: number,
  shipToCountry = "US"
): Promise<string> {
  const accessToken = await getAliAccessToken();
  const method = "aliexpress.ds.product.get";
  const apiPath = "/sync";

  const sysParams: Record<string, string> = {
    app_key: APP_KEY,
    method,
    access_token: accessToken,
    timestamp: topTimestamp(),
    sign_method: "sha256",
    v: "2.0",
    product_id: String(productId),
    ship_to_country: shipToCountry,
    target_currency: "USD",
    target_language: "en",
    remove_personal_benefit: "false",
  };

  const sign = signAliExpressRequest(apiPath, sysParams, APP_SECRET);
  const body = new URLSearchParams({ ...sysParams, sign }).toString();

  const raw = await fetch(`${ALI_BASE_URL}${apiPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  }).then((r) => r.text());

  const json: any = JSON.parse(raw);
  const list =
    json?.result?.ae_item_sku_info_dtos ??
    json?.aliexpress_ds_product_get_response?.result?.ae_item_sku_info_dtos ??
    [];

  console.log("[AliExpress] SKU list for", productId, "→", list);

  // if only one SKU exists the spec says it can be ""
  return list[0]?.sku_attr ?? "";
}
