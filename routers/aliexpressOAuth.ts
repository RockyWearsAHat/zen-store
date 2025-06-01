import { Router, Request, Response } from "express";
import { URLSearchParams } from "url";
import "dotenv/config";
import { AliToken } from "../aliexpress"; // ← re-use model
import { connectDB } from "../db";

/* env */
const APP_KEY = process.env.ALI_APP_KEY!;
const APP_SECRET = process.env.ALI_APP_SECRET!;

const router = Router();

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
      app_key: APP_KEY,
      app_secret: APP_SECRET,
      code,
    });

    const json = await fetch("https://api-seller.aliexpress.com", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    }).then((r) => r.json() as Promise<any>);

    if (json.error) throw new Error(json.error_description ?? json.error);

    await connectDB();
    await AliToken.findOneAndUpdate(
      {}, // single-doc collection
      {
        access_token: json.access_token,
        refresh_token: json.refresh_token,
        expires_at: new Date(Date.now() + json.expires_in * 1000),
      },
      { upsert: true, new: true }
    );

    res.send("AliExpress tokens saved. You may close this window.");
  } catch (err: any) {
    console.error("AliExpress OAuth error:", err);
    res.status(500).send("AliExpress OAuth failed: " + err.message);
  }
});

/* ── 2) Manual refresh endpoint (optional) ────────────────────────── */
router.post("/ali/oauth/refresh", async (_req: Request, res: Response) => {
  try {
    await connectDB();
    const tok = await AliToken.findOne().exec();
    if (!tok) throw new Error("No token stored yet");

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tok.refresh_token,
      app_key: APP_KEY,
      app_secret: APP_SECRET,
    });

    const json = await fetch("https://api-seller.aliexpress.com", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    }).then((r) => r.json() as Promise<any>);

    if (json.error) throw new Error(json.error_description ?? json.error);

    tok.access_token = json.access_token;
    tok.refresh_token = json.refresh_token ?? tok.refresh_token;
    tok.expires_at = new Date(Date.now() + json.expires_in * 1000);
    await tok.save();

    res.json({ ok: true, expiresAt: tok.expires_at });
  } catch (err: any) {
    console.error("AliExpress refresh error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ─── exports ──────────────────────────────────────────────── */
export { router as aliexpressOAuthRouter };
