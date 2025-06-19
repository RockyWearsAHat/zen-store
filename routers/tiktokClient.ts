import { Router, Request, Response } from "express";
import { sendTikTokEvent } from "../server/utils/tiktok";

const router = Router();

/* POST /api/tiktok/event  – body must at least include { event: "AddToCart", … } */
router.post("/event", async (req: Request, res: Response) => {
  try {
    const {
      event,
      user = {},
      properties,
      page,
      test_event_code,
    } = req.body ?? {};

    if (!event || typeof event !== "string") {
      res.status(400).json({ error: "missing event" });
      return;
    }

    /* Pull best-guess client IP (honours proxies) */
    const ip =
      user.ip ||
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.ip ||
      req.socket?.remoteAddress ||
      null;

    await sendTikTokEvent({
      event,
      event_time: Math.floor(Date.now() / 1000).toString(), // ← seconds
      test_event_code, // ← pass through as-is
      user: {
        ...user,
        ip,
        user_agent: user.user_agent ?? req.get("User-Agent") ?? null,
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
