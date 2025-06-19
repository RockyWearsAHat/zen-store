import { Router, Request, Response } from "express";
import { sendTikTokEvent } from "../server/utils/tiktok";

export const tiktokRouter = Router();

tiktokRouter.post("/event", async (req: Request, res: Response) => {
  try {
    const body = req.body;
    if (!body?.event) {
      res.status(400).json({ error: "Missing event" });
      return;
    }

    /* guarantee an event_time for TikTok */
    const payload = {
      event_time: Math.floor(Date.now() / 1000).toString(), // ← seconds
      ...body,
    };
    await sendTikTokEvent(payload as any);

    res.json({ ok: true });
    return;
  } catch (e) {
    console.error("[tiktok] proxy error", e);
    res.status(500).json({ error: "proxy error" });
  }
});
