import express, { Router, Request, Response } from "express";
import { sendTikTokEvent, type TikTokEvent } from "../server/utils/tiktok";

const router = Router();

/* ensure JSON first, but don’t reject non-JSON yet */
router.use(express.json());

/* POST /api/tiktok/event  – body must at least include { event: "AddToCart", … } */
router.post("/event", async (req: Request, res: Response) => {
  try {
    /* ----------------------------------------------------------
       Beacon POSTs sometimes arrive with an arbitrary/empty
       Content-Type, so `express.json()` leaves `req.body` as a
       raw string.  Parse it manually when that happens.
    ---------------------------------------------------------- */
    if (typeof req.body === "string") {
      try {
        req.body = JSON.parse(req.body);
      } catch (_) {
        /* ignore – will fail the event check below */
      }
    } else if (Buffer.isBuffer(req.body)) {
      try {
        req.body = JSON.parse(req.body.toString("utf8"));
      } catch {
        /* ignore – validation below will fail */
      }
    }

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

    /* downstream helper adds content_id/name automatically – no extra guards */

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

    const ok = await sendTikTokEvent(payload);

    res.json({ ok });
  } catch (e) {
    console.error("[tiktokProxy] failed hard", e);
    res.json({ ok: false }); // never bubble failure to the client
  }
});

export const tiktokRouter = router;
