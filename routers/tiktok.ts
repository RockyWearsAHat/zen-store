import { Router, Request, Response } from "express";
import { sendTikTokEvent } from "../server/utils/tiktok";

export const tiktokRouter = Router();

tiktokRouter.post("/event", async (req: Request, res: Response) => {
  try {
    const body = req.body;
    if (!body?.event) return res.status(400).json({ error: "Missing event" });

    /* guarantee an event_time for TikTok */
    const payload = { event_time: Date.now().toString(), ...body };
    await sendTikTokEvent(payload as any);

    res.json({ ok: true });
  } catch (e) {
    console.error("[tiktok] proxy error", e);
    res.status(500).json({ error: "proxy error" });
  }
});
