import { Router, Request, Response } from "express";
import { URLSearchParams } from "url";
import "dotenv/config";
import { AliToken } from "../aliexpress";
import { connectDB } from "../db";
import crypto from "crypto";
import * as AE from "ae-api";

/* env */
const APP_KEY = process.env.ALI_APP_KEY!;
const APP_SECRET = process.env.ALI_APP_SECRET!;

const router = Router();

/* Debug endpoint to check what values are actually being used */
router.get("/ali/oauth/debug", (_req, res) => {
  const client = new AE.AeClient(
    "prod",
    process.env.ALI_APP_KEY ?? "",
    process.env.ALI_APP_SECRET ?? ""
  );

  console.log(
    client.getAuthorizeUrl("https://zen-essentials.store/ali/oauth/callback")
  );

  res.send(`
    <h1>AliExpress OAuth Debug</h1>
    <p>APP_KEY: ${APP_KEY}</p>
    <p>APP_SECRET: ${APP_SECRET ? "[SET]" : "[NOT SET]"}</p>
    <p><a href="/ali/oauth/start">Start OAuth Flow</a></p>
  `);
});

/* ── OAuth flow start ────────────────────────────────────────── */
router.get("/ali/oauth/start", (_req, res) => {
  // Newest version of the AliExpress OAuth authorize URL
  const authUrl = new URL("https://auth.aliexpress.com/oauth2/authorize");

  authUrl.searchParams.append("app_key", APP_KEY);
  authUrl.searchParams.append(
    "redirect_uri",
    "https://zen-essentials.store/ali/oauth/callback"
  );
  authUrl.searchParams.append("response_type", "code");
  authUrl.searchParams.append("state", crypto.randomBytes(8).toString("hex"));
  authUrl.searchParams.append("site", "aliexpress");

  console.log("Auth URL:", authUrl.toString());
  res.redirect(authUrl.toString());
});

/* ── OAuth callback ─────────────────────────────────────────── */
router.get("/ali/oauth/callback", async (req: Request, res: Response) => {
  const code = req.query.code as string | undefined;

  if (!code) {
    res.status(400).send("Missing authorization code");
    return;
  }

  try {
    console.log("Received code:", code);

    // Use the latest AliExpress token endpoint format
    const tokenUrl = "https://api.aliexpress.com/oauth/token";

    const params = new URLSearchParams();
    params.append("grant_type", "authorization_code");
    params.append("code", code);
    params.append("app_key", APP_KEY);
    params.append("app_secret", APP_SECRET);
    params.append(
      "redirect_uri",
      "https://zen-essentials.store/ali/oauth/callback"
    );

    console.log("Token request params:", params.toString());

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });

    const responseText = await response.text();
    console.log("Token response:", responseText);

    let json;
    try {
      json = JSON.parse(responseText);
    } catch (e) {
      throw new Error(`Invalid JSON response: ${responseText}`);
    }

    if (json.error_response) {
      throw new Error(`API Error: ${JSON.stringify(json.error_response)}`);
    }

    if (!json.access_token) {
      throw new Error(`No access token in response: ${JSON.stringify(json)}`);
    }

    // Save token to database
    await connectDB();
    await AliToken.findOneAndUpdate(
      {},
      {
        access_token: json.access_token,
        refresh_token: json.refresh_token || "",
        expires_at: new Date(Date.now() + json.expires_in * 1000),
      },
      { upsert: true, new: true }
    );

    // Success page
    res.send(`
      <html>
        <head><title>AliExpress Connected</title></head>
        <body style="font-family:system-ui;max-width:600px;margin:2rem auto;padding:2rem;background:#f7f7f7;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
          <h1 style="color:#ff4747">✅ AliExpress Connected</h1>
          <p>Your AliExpress account has been successfully connected.</p>
          <p>You can close this window and return to your application.</p>
        </body>
      </html>
    `);
  } catch (err: any) {
    console.error("OAuth error:", err);
    res.status(500).send(`
      <html>
        <head><title>AliExpress Connection Failed</title></head>
        <body style="font-family:system-ui;max-width:600px;margin:2rem auto;padding:2rem;background:#f7f7f7;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
          <h1 style="color:#e53e3e">❌ Connection Failed</h1>
          <p>There was a problem connecting to AliExpress:</p>
          <pre style="background:#f0f0f0;padding:1rem;border-radius:4px;overflow-x:auto;">${err.message}</pre>
          <p><a href="/ali/oauth/debug">Check Configuration</a></p>
          <p><a href="/ali/oauth/start">Try Again</a></p>
        </body>
      </html>
    `);
  }
});

/* ─── exports ──────────────────────────────────────────────── */
export { router as aliexpressOAuthRouter };
