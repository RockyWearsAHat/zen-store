import express, { Router, Request, Response } from "express";
import { sendTikTokEvent, type TikTokEvent } from "../server/utils/tiktok";

const router = Router();

/* ensure JSON body is parsed before hitting our handler */
router.use(express.json());

/* POST /api/tiktok/event  – body must at least include { event: "AddToCart", … } */
router.post("/event", async (req: Request, res: Response) => {
  try {
    const {
      event,
      event_time,
      event_id,
      user = {},
      properties = {},
      page,
      test_event_code,
    } = req.body ?? {};

    if (!event || typeof event !== "string") {
      res.status(400).json({ error: "missing event" });
      return;
    }

    /* ensure downstream helper will add content_id if missing – nothing to block here */

    const ip =
      user.ip ||
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.ip ||
      req.socket?.remoteAddress ||
      null;

    /* build & clean */
    const clean = (obj: any) =>
      Object.fromEntries(
        Object.entries(obj).filter(
          ([, v]) => v !== undefined && v !== null && v !== ""
        )
      );

    /* build clean payload (typed) */
    const payload: TikTokEvent = {
      event,
      event_time:
        event_time?.toString() ?? Math.floor(Date.now() / 1000).toString(),
      event_id,
      test_event_code,
      user: clean({ ...user, ip, user_agent: req.get("User-Agent") }),
      properties: clean(properties),
      page: clean(page ?? {}),
    };

    await sendTikTokEvent(payload); // ← now typed

    res.json({ ok: true });
  } catch (e) {
    console.error("[tiktokProxy] failed", e);
    res.status(500).json({ error: "proxy failure" });
  }
});

export const tiktokRouter = router;
