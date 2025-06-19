import { Router, Request, Response } from "express";
import { sendTikTokEvent } from "../server/utils/tiktok";

const router = Router();

/* POST /api/tiktok/event  – body must at least include { event: "AddToCart", … } */
router.post("/event", async (req: Request, res: Response) => {
  try {
    const { event, user, properties, page } = req.body ?? {};
    if (typeof event !== "string" || !event.trim()) {
      res.status(400).json({ error: "missing event" });
      return;
    }

    /* server-side enrichment: stamp time & fall back to IP / UA */
    await sendTikTokEvent({
      event,
      event_time: Date.now().toString(),
      user: {
        ...(user ?? {}),
        ip: user?.ip ?? (req.ip || null),
        user_agent: user?.user_agent ?? req.get("User-Agent") ?? null,
      },
      properties,
      page,
    });

    res.json({ ok: true });
  } catch (e) {
    console.error("[tiktokProxy] failed", e);
    res.status(500).json({ error: "proxy failure" });
  }
});

export const tiktokRouter = router;
