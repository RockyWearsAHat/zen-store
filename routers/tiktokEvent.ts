import { Router } from "express";
import { sendTikTokEvent } from "../server/utils/tiktok";

const router = Router();

router.post("/", async (req, res) => {
  try {
    await sendTikTokEvent(req.body); // body already in correct shape
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});

export const tiktokEventRouter = router;
