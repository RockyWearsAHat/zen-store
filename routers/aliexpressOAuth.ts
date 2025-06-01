import { Router, Request, Response } from "express";
import { URLSearchParams } from "url";
import "dotenv/config";
import { AliToken } from "../aliexpress"; // ← re-use model
import { connectDB } from "../db";
import crypto from "crypto";

/* env */
const APP_KEY = process.env.ALI_APP_KEY!;
const APP_SECRET = process.env.ALI_APP_SECRET!;

const router = Router();

/* ── new helper: launch OAuth flow ────────────────────────────────── */
router.get("/ali/oauth/start", (_req, res) => {
  const redirect = encodeURIComponent(
    "https://zen-essentials.store/ali/oauth/callback"
  );
  const state = crypto.randomBytes(8).toString("hex"); // optional CSRF token
  const authUrl =
    `https://auth.aliexpress.com/oauth2/authorize` +
    `?client_id=${APP_KEY}` +
    `&redirect_uri=${redirect}` +
    `&response_type=code` +
    `&site=aliexpress` +
    `&state=${state}`;

  res.redirect(authUrl);
});

/* ── 1) OAuth callback (redirect_uri) ─────────────────────────────── */
router.get("/ali/oauth/callback", async (req: Request, res: Response) => {
  const code = req.query.code as string | undefined;
  if (!code) {
    res.status(400).send("Missing ?code parameter");
    return;
  }

  try {
    /* exchange code → tokens */
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      need_refresh_token: "true",
      client_id: APP_KEY, // ← correct param name
      client_secret: APP_SECRET, // ← correct param name
      code,
    });

    const json: any = await fetch(
      "https://api-seller.aliexpress.com/oauth2/token", // ← correct endpoint
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      }
    ).then((r) => r.json());

    if (json?.error_response) {
      const { code: ecode, msg } = json.error_response;
      throw new Error(`AliExpress ${ecode}: ${msg}`);
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

    // simple success page
    res.send(
      `<html><body style="font-family:system-ui,sans-serif;padding:32px">
         <h2>✅ AliExpress connected!</h2>
         <p>You may close this tab.</p>
       </body></html>`
    );
  } catch (err: any) {
    console.error("AliExpress OAuth error:", err);
    res
      .status(500)
      .send(`AliExpress OAuth failed:<br/><pre>${err.message}</pre>`);
  }
});

/* ── 2) Manual refresh endpoint (optional) ────────────────────────── */
router.post("/ali/oauth/refresh", async (_req, res) => {
  try {
    await connectDB();
    const tok = await AliToken.findOne().exec();
    if (!tok) throw new Error("No token stored yet");

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tok.refresh_token,
      client_id: APP_KEY, // ← correct param name
      client_secret: APP_SECRET, // ← correct param name
    });

    const json: any = await fetch(
      "https://api-seller.aliexpress.com/oauth2/token", // ← correct endpoint
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      }
    ).then((r) => r.json());

    if (json?.error_response) {
      const { msg } = json.error_response;
      throw new Error(msg);
    }

    tok.access_token = json.access_token;
    tok.refresh_token = json.refresh_token ?? tok.refresh_token;
    tok.expires_at = new Date(Date.now() + Number(json.expires_in) * 1000);
    await tok.save();

    res.json({ ok: true, expiresAt: tok.expires_at });
  } catch (err: any) {
    console.error("AliExpress refresh error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ─── exports ──────────────────────────────────────────────── */
export { router as aliexpressOAuthRouter };
