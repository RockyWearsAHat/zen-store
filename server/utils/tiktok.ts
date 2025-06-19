import "dotenv/config";

/* ------------------------------------------------------------------ */
/*  Shared helper to hit TikTok Events API                            */
/* ------------------------------------------------------------------ */
const TIKTOK_PIXEL_ID = process.env.TIKTOK_PIXEL_ID;
const TIKTOK_TOKEN = process.env.TIKTOK_ACCESS_TOKEN;

interface TikTokEvent {
  event: string;
  event_time: string; // ms-epoch string
  event_id?: string | null;
  user?: {
    email?: string | null;
    phone?: string | null;
    external_id?: string | null; // ← add
    ip?: string | null;
    user_agent?: string | null;
    ttclid?: string | null;
    ttp?: string | null;
  };
  properties?: {
    contents?: { content_id?: any; content_name?: any; quantity?: any }[];
    content_id?: any; // ← new
    content_name?: any; // ← new
    content_type?: string | null;
    currency?: string | null;
    value?: number | null;
  };
  page?: { url?: string | null };
  test_event_code?: string; // ← NEW
}

/* tiny wrapper – never throws, logs instead */
export async function sendTikTokEvent(payload: TikTokEvent): Promise<void> {
  try {
    if (!TIKTOK_TOKEN) throw new Error("TIKTOK_ACCESS_TOKEN not set");

    /* ----- normalise event_time to seconds ----- */
    const ms = Number(payload.event_time);
    if (!Number.isNaN(ms) && ms > 1e12) {
      payload.event_time = Math.floor(ms / 1000).toString();
    }

    const body = {
      event_source: "web",
      event_source_id: TIKTOK_PIXEL_ID,
      data: [payload],
    };

    /* ---------- build endpoint (attach test flag only if provided) ---------- */
    const url = new URL("https://business-api.tiktok.com/open_api/v1.3/event/track/");
    if (payload.test_event_code) url.searchParams.set("test_event_code", payload.test_event_code);

    const res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Access-Token": TIKTOK_TOKEN,
      },
      body: JSON.stringify(body),
    });

    const txt = await res.text();
    if (!res.ok) {
      console.error("[tiktok] API error", res.status, txt);
    } else {
      console.log("[tiktok] sent", payload.event, "→", txt.slice(0, 120));
    }
  } catch (e) {
    console.error("[tiktok] fatal", e);
  }
}
  } catch (e) {
    console.error("[tiktok] fatal", e);
  }
}
