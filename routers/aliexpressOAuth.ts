import { Router, Request, Response } from "express";
import "dotenv/config";
import { AliToken } from "../aliexpress";
import { connectDB } from "../db";
import crypto from "crypto";

/* env */
const APP_KEY = process.env.ALI_APP_KEY!;
const APP_SECRET = process.env.ALI_APP_SECRET!;

const router = Router();

/* Debug endpoint to check environment variables */
router.get("/ali/oauth/debug", (_req, res) => {
  const maskKey = APP_KEY
    ? `${APP_KEY.substring(0, 3)}...${APP_KEY.substring(APP_KEY.length - 3)}`
    : "NOT SET";
  const secretPresent = APP_SECRET ? "SET" : "NOT SET";

  const authUrl = buildAuthUrl();

  res.send(`
    <html>
      <head>
        <title>AliExpress OAuth Debug</title>
        <style>
          body { font-family: system-ui; max-width: 800px; margin: 0 auto; padding: 20px; }
          pre { background: #f5f5f5; padding: 10px; border-radius: 5px; overflow-x: auto; }
          .key { color: #2563eb; }
        </style>
      </head>
      <body>
        <h1>AliExpress OAuth Configuration</h1>
        <p>APP_KEY: <span class="key">${maskKey}</span></p>
        <p>APP_SECRET: <span class="key">${secretPresent}</span></p>
        <h2>Authorization URL</h2>
        <pre>${authUrl}</pre>
        <p><a href="${authUrl}">Start OAuth Flow</a></p>
      </body>
    </html>
  `);
});

/* Build the authorization URL using correct parameters */
function buildAuthUrl() {
  // Per latest docs, use /oauth2/authorize and app_key
  const baseUrl = "https://auth.aliexpress.com/oauth2/authorize";
  const params = new URLSearchParams();
  params.append("app_key", APP_KEY);
  params.append(
    "redirect_uri",
    "https://zen-essentials.store/ali/oauth/callback"
  );
  params.append("response_type", "code");
  params.append("state", crypto.randomBytes(8).toString("hex"));
  params.append("site", "aliexpress");
  return `${baseUrl}?${params.toString()}`;
}

/* ── OAuth flow start ────────────────────────────────────────── */
router.get("/ali/oauth/start", (_req, res) => {
  const authUrl = buildAuthUrl();
  res.redirect(authUrl);
});

/* ── OAuth callback - updated for compatibility ─────────────────── */
router.get("/ali/oauth/callback", async (req: Request, res: Response) => {
  const code = req.query.code as string | undefined;

  if (!code) {
    res.status(400).send("Missing authorization code");
    return;
  }

  try {
    console.log("Received authorization code:", code);

    // Per latest docs, use /auth/token/security/create with signing
    const createTokenUrl =
      "https://api.aliexpress.com/auth/token/security/create";
    const timestamp = Date.now().toString();
    const uuid = crypto.randomUUID();

    // Build params for signing
    const paramsForSign: Record<string, string> = {
      app_key: APP_KEY,
      timestamp,
      sign_method: "sha256",
      code,
      uuid,
    };

    // Build the string to sign
    const sortedKeys = Object.keys(paramsForSign).sort();
    const baseStr =
      APP_SECRET +
      sortedKeys.map((k) => k + paramsForSign[k]).join("") +
      APP_SECRET;
    const sign = crypto
      .createHash("sha256")
      .update(baseStr)
      .digest("hex")
      .toUpperCase();

    // Build POST body
    const tokenRequestParams = new URLSearchParams();
    tokenRequestParams.append("app_key", APP_KEY);
    tokenRequestParams.append("timestamp", timestamp);
    tokenRequestParams.append("sign_method", "sha256");
    tokenRequestParams.append("sign", sign);
    tokenRequestParams.append("code", code);
    tokenRequestParams.append("uuid", uuid);

    console.log("Token request params:", tokenRequestParams.toString());

    const tokenResponse = await fetch(createTokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
      },
      body: tokenRequestParams,
    });

    const tokenData = await tokenResponse.json();
    console.log("Token response:", JSON.stringify(tokenData, null, 2));

    if (tokenData.error_msg) {
      throw new Error(`API Error: ${tokenData.error_msg}`);
    }

    if (!tokenData.access_token) {
      throw new Error(
        `No access token in response: ${JSON.stringify(tokenData)}`
      );
    }

    // Save token to database
    await connectDB();
    await AliToken.findOneAndUpdate(
      {},
      {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: new Date(Date.now() + tokenData.expires_in * 1000),
      },
      { upsert: true, new: true }
    );

    // Success page
    res.send(`
      <html>
        <head>
          <title>AliExpress Connected</title>
          <style>
            body { font-family: system-ui; max-width: 600px; margin: 40px auto; padding: 20px; background: #f8f8f8; }
            .card { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            h1 { color: #ff4747; margin-top: 0; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>✅ AliExpress Connected</h1>
            <p>Your AliExpress account has been successfully connected.</p>
            <p>Access token and refresh token have been saved to the database.</p>
            <p>You can close this window and return to your application.</p>
          </div>
        </body>
      </html>
    `);
  } catch (err: any) {
    console.error("OAuth error:", err);
    res.status(500).send(`
      <html>
        <head>
          <title>AliExpress Connection Failed</title>
          <style>
            body { font-family: system-ui; max-width: 600px; margin: 40px auto; padding: 20px; background: #f8f8f8; }
            .card { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            h1 { color: #e53e3e; margin-top: 0; }
            pre { background: #f0f0f0; padding: 15px; border-radius: 4px; overflow-x: auto; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>❌ Connection Failed</h1>
            <p>There was a problem connecting to AliExpress:</p>
            <pre>${err.message}</pre>
            <p><a href="/ali/oauth/debug">Check Configuration</a></p>
            <p><a href="/ali/oauth/start">Try Again</a></p>
          </div>
        </body>
      </html>
    `);
  }
});

/* Manual token refresh endpoint */
router.post("/ali/oauth/manual-refresh", async (_req, res) => {
  try {
    await connectDB();
    const token = await AliToken.findOne().exec();

    if (!token) {
      res.status(404).json({ error: "No token found in database" });
      return;
    }

    // Per current docs: https://openservice.aliexpress.com/doc/api.htm#/api?cid=3&path=/auth/token/security/refresh
    const refreshTokenUrl =
      "https://api.aliexpress.com/auth/token/security/refresh";

    // Format exactly as shown in the documentation
    const refreshParams = new URLSearchParams();
    refreshParams.append("client_id", APP_KEY);
    refreshParams.append("client_secret", APP_SECRET);
    refreshParams.append("refresh_token", token.refresh_token);
    refreshParams.append("grant_type", "refresh_token");

    const refreshResponse = await fetch(refreshTokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: refreshParams,
    });

    const refreshData = await refreshResponse.json();

    if (refreshData.error_msg) {
      throw new Error(`Refresh error: ${refreshData.error_msg}`);
    }

    // Update token in database
    token.access_token = refreshData.access_token;
    token.refresh_token = refreshData.refresh_token || token.refresh_token;
    token.expires_at = new Date(Date.now() + refreshData.expires_in * 1000);
    await token.save();

    res.json({
      success: true,
      message: "Token refreshed successfully",
      expires_at: token.expires_at,
    });
  } catch (err: any) {
    console.error("Token refresh error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ─── exports ──────────────────────────────────────────────── */
export { router as aliexpressOAuthRouter };
