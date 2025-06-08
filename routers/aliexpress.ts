import { Request, Response, Router } from "express";
import { connectDB } from "../server/db"; // Ensure connectDB is imported
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
  "https://api-sg.aliexpress.com/oauth/authorize";
const TOKEN_ENDPOINT = // Updated to include /rest
  process.env.ALI_TOKEN_ENDPOINT?.trim() ||
  "https://api-sg.aliexpress.com/rest/auth/token/create";
const REFRESH_TOKEN_ENDPOINT = // Added for refresh token
  process.env.ALI_REFRESH_TOKEN_ENDPOINT?.trim() ||
  "https://api-sg.aliexpress.com/rest/auth/token/refresh";

// Global variable to store the token refresh timeout
let tokenRefreshTimeoutId: NodeJS.Timeout | null = null;

/* ────── constants for timing ────── */
const ONE_MIN = 60_000;
const HALF_HOUR = 30 * ONE_MIN;
const ONE_DAY = 24 * 60 * ONE_MIN;
const MAX_TIMEOUT_MS = 2_147_000_000; // < 2^31-1, ~24.8 days

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

/* ---------- scheduleTokenRefresh ---------- */
function scheduleTokenRefresh(expiresAt: Date) {
  if (tokenRefreshTimeoutId) clearTimeout(tokenRefreshTimeoutId);

  const now = Date.now();
  // How long until we want to refresh (30 min before real expiry)
  let totalUntilRefresh = expiresAt.getTime() - now - HALF_HOUR;

  // If already past that point, refresh shortly.
  if (totalUntilRefresh <= 0) totalUntilRefresh = 10_000;

  // First chunk (max 24.8 d).  Remaining time is handled recursively.
  const delay = Math.min(totalUntilRefresh, MAX_TIMEOUT_MS);
  const finalRun = delay === totalUntilRefresh; // will reach target in one go

  console.log(
    `[AliExpress] Scheduling refresh in ${Math.round(delay / ONE_MIN)} min ` +
      `(finalRun=${finalRun}) – target ${expiresAt.toISOString()}`
  );

  tokenRefreshTimeoutId = setTimeout(async () => {
    try {
      if (finalRun) {
        console.log("[AliExpress] 🔄 30-min-early refresh trigger");
        await getAliAccessToken(true); // force refresh
      } else {
        // Waited the big chunk – schedule the remaining tail.
        scheduleTokenRefresh(expiresAt);
      }
    } catch (err) {
      console.error("[AliExpress] Error during scheduled refresh:", err);
    }
  }, delay);
}

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
      console.log(
        "[AliExpress] New token saved via OAuth, scheduling refresh."
      );
      scheduleTokenRefresh(savedToken.expires_at);
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
});

/* ────────────── AliExpress Dropshipping API Helpers ────────────── */

// Helper: sign AliExpress API request (HMAC_SHA256, per new docs)
function signAliExpressRequest(
  apiPath: string, // e.g., /auth/token/create
  params: Record<string, string>, // All request params except 'sign'
  appSecret: string
): string {
  const sortedKeys = Object.keys(params).sort();

  let queryString = "";
  for (const key of sortedKeys) {
    // Ensure that only non-empty values are part of the query string,
    // as per the Java example's `areNotEmpty(key, value)` check,
    // though the primary rule is "all request parameters".
    // For simplicity and to match the "concatenate sorted parameters and their values" rule,
    // we'll include all provided params. If a param has an empty string value, it would be `key` followed by nothing.
    // The example `bar=2, foo=1, foo_bar=3, foobar=` implies `foobar` had an empty value.
    // Let's assume params will not have undefined/null values here.
    queryString += key + params[key];
  }

  // Prepend the API path for System Interfaces
  const stringToSign = apiPath + queryString;

  // console.log("[AliExpress Signature] String to sign:", stringToSign); // For debugging

  const hmac = crypto.createHmac("sha256", appSecret);
  hmac.update(stringToSign, "utf8");
  return hmac.digest("hex").toUpperCase();
}

// // Helper: sign AliExpress API request parameters (for /sync endpoint, general interface)
// function signAliParams(
//   params: Record<string, string>, // All request params except 'sign'
//   appSecret: string
// ): string {
//   const sortedKeys = Object.keys(params).sort();

//   let stringToSign = "";
//   for (const key of sortedKeys) {
//     // Concatenate key and its value.
//     // Assumes params[key] is always a string and defined.
//     stringToSign += key + params[key];
//   }

//   // console.log("[AliExpress Signature - General] String to sign:", stringToSign); // For debugging

//   const hmac = crypto.createHmac("sha256", appSecret); // Using sha256 as per sign_method
//   hmac.update(stringToSign, "utf8");
//   return hmac.digest("hex").toUpperCase();
// }

// function toQueryString(params: Record<string, string>): string {
//   return Object.entries(params)
//     .map(([k, v]) => `${k}=${v}`)
//     .join("&");
// }

// ---------------- getAliAccessToken ----------------
async function getAliAccessToken(forceRefresh = false): Promise<string> {
  try {
    await connectDB();
    let tokenDoc = await AliToken.findOne().exec();
    if (!tokenDoc?.access_token) throw new Error("AliExpress token missing");

    const hasAccess = !!tokenDoc.access_token;
    const hasRefresh = !!tokenDoc.refresh_token;
    const expMs = tokenDoc.expires_at?.getTime() ?? 0;
    const expSoon = !expMs || expMs - Date.now() < HALF_HOUR;
    const mustRefresh = forceRefresh || (!hasAccess && hasRefresh) || expSoon;

    /* ---------- no refresh needed: ensure timer is armed ---------- */
    if (!mustRefresh && hasAccess) {
      scheduleTokenRefresh(tokenDoc.expires_at!); // <─ NEW
      return tokenDoc.access_token!;
    }

    if (!hasRefresh) throw new Error("No refresh_token available to refresh.");

    console.log("[AliExpress] Performing token refresh …");

    /* ---------- call /auth/token/refresh ---------- */
    const ts = Date.now().toString();
    const base: Record<string, string> = {
      app_key: APP_KEY,
      client_secret: APP_SECRET, // ← required by refresh action
      refresh_token: tokenDoc!.refresh_token!,
      timestamp: ts,
      sign_method: "sha256",
    };
    const sign = signAliExpressRequest("/auth/token/refresh", base, APP_SECRET);
    const body = new URLSearchParams({ ...base, sign }).toString();

    const rawRes = await fetch(REFRESH_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    }).then((r) => r.text());

    let json: any;
    try {
      json = JSON.parse(rawRes);
    } catch {
      throw new Error("Bad JSON from refresh");
    }
    console.log("[AliExpress] Refresh response:", json); // debug
    if (json.code !== "0") throw new Error(`Refresh failed: ${rawRes}`);

    /* ---------- persist ---------- */
    const newExp = pickExpiry(json);
    const update: Record<string, any> = {
      expires_at: newExp,
      // access_token | refresh_token might be null in test mode – keep old ones if so
      access_token: json.access_token || tokenDoc!.access_token,
      refresh_token: json.refresh_token || tokenDoc!.refresh_token,
    };

    tokenDoc = await AliToken.findOneAndUpdate({}, update, {
      new: true,
      upsert: true,
    });
    console.log(
      "[AliExpress] Tokens updated, next expiry:",
      tokenDoc.expires_at
    );

    scheduleTokenRefresh(tokenDoc.expires_at!);
    return tokenDoc.access_token!;
  } catch (err) {
    console.error("[AliExpress] getAliAccessToken fatal:", err);
    throw err;
  }
} // <- proper function end

aliexpressRouter.post("/redeploy", async (_, res) => {
  // Implementation for redeploying an AliExpress product
  console.log(
    "[AliExpress] Redeploy request received, refreshing access token."
  );
  await getAliAccessToken(true);
  res.status(200).send("Redeploy request processed.");
  return;
});

export { getAliAccessToken };
