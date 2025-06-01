import { Router, Request, Response } from "express";
import { URLSearchParams } from "url";
import "dotenv/config";
import { AliToken } from "../aliexpress";
import { connectDB } from "../db";
import crypto from "crypto";

/* env */
const APP_KEY = process.env.ALI_APP_KEY!;
const APP_SECRET = process.env.ALI_APP_SECRET!;

const router = Router();

/* Debug endpoint to verify environment variables are correctly loaded */
router.get("/ali/oauth/check-env", (_req, res) => {
  // Obscure part of the key for security but show enough to verify
  const keyPreview = APP_KEY
    ? `${APP_KEY.substring(0, 2)}...${APP_KEY.substring(APP_KEY.length - 1)}`
    : "NOT SET";

  const secretSet = APP_SECRET ? "SET (hidden)" : "NOT SET";

  res.send(`
    <h1>AliExpress Environment Check</h1>
    <p>APP_KEY: ${keyPreview}</p>
    <p>APP_SECRET: ${secretSet}</p>
    <p><a href="/ali/oauth/start">Click here to start OAuth</a></p>
  `);
});

/* ── OAuth flow start - generate authorization URL ────────────── */
router.get("/ali/oauth/start", (_req, res) => {
  const redirectUri = "https://zen-essentials.store/ali/oauth/callback";
  const state = crypto.randomBytes(8).toString("hex");

  // AliExpress Dropshipping API expects appkey (not client_id)
  const authUrl =
    `https://auth.aliexpress.com/oauth2/authorize` +
    `?app_key=${APP_KEY}` + // CORRECT: app_key (with underscore)
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&state=${state}`;

  console.log("Redirecting to AliExpress auth URL:", authUrl);
  res.redirect(authUrl);
});

/* ── OAuth callback (processes authorization code) ─────────────── */
router.get("/ali/oauth/callback", async (req: Request, res: Response) => {
  const code = req.query.code as string | undefined;
  if (!code) {
    res.status(400).send("Missing ?code parameter");
    return;
  }

  try {
    console.log("Received authorization code:", code);

    /* Exchange code for tokens - CAREFULLY FORMATTED per AliExpress docs */
    const requestBody = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: "https://zen-essentials.store/ali/oauth/callback",
    });

    // Add app_key and secret as QUERY PARAMETERS (not in body)
    const tokenUrl =
      `https://gw.api.alibaba.com/openapi/param2/1/system.oauth2/getToken` +
      `/${APP_KEY}?${requestBody.toString()}`;

    console.log("Token exchange URL:", tokenUrl);

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(
          `${APP_KEY}:${APP_SECRET}`
        ).toString("base64")}`,
      },
    });

    const responseText = await response.text();
    console.log("Token response:", responseText);

    let json: any;
    try {
      json = JSON.parse(responseText);
    } catch (e) {
      throw new Error(`Failed to parse response as JSON: ${responseText}`);
    }

    if (json?.error || !json?.access_token) {
      throw new Error(`AliExpress error: ${JSON.stringify(json, null, 2)}`);
    }

    await connectDB();
    await AliToken.findOneAndUpdate(
      {},
      {
        access_token: json.access_token,
        refresh_token: json.refresh_token,
        expires_at: new Date(Date.now() + Number(json.expires_in) * 1000),
      },
      { upsert: true, new: true }
    );

    res.send(`
      <html>
        <body style="font-family:system-ui,sans-serif;padding:32px;background:#f9f9f9;">
          <div style="max-width:600px;margin:0 auto;background:white;padding:32px;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
            <h2 style="color:#ff6a00;margin-top:0;">✅ AliExpress Connected!</h2>
            <p>Your AliExpress seller account has been successfully connected.</p>
            <p>Access token and refresh token have been saved.</p>
            <p>You may close this window and return to your application.</p>
          </div>
        </body>
      </html>
    `);
  } catch (err: any) {
    console.error("AliExpress OAuth error:", err);
    res.status(500).send(`
      <html>
        <body style="font-family:system-ui,sans-serif;padding:32px;background:#f9f9f9;">
          <div style="max-width:600px;margin:0 auto;background:white;padding:32px;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
            <h2 style="color:#e53e3e;margin-top:0;">❌ AliExpress Connection Failed</h2>
            <p>There was a problem connecting your AliExpress account:</p>
            <pre style="background:#f8f8f8;padding:16px;border-radius:5px;overflow-x:auto;">${err.message}</pre>
            <p><a href="/ali/oauth/start" style="color:#3182ce;">Try Again</a></p>
          </div>
        </body>
      </html>
    `);
  }
});

/* ── exports ──────────────────────────────────────────────── */
export { router as aliexpressOAuthRouter };
