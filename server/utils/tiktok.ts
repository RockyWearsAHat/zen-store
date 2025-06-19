import "dotenv/config";

/* ------------------------------------------------------------------ */
/*  Shared helper to hit TikTok Events API                            */
/* ------------------------------------------------------------------ */
const TIKTOK_PIXEL_ID = process.env.TIKTOK_PIXEL_ID;
const TIKTOK_TOKEN = process.env.TIKTOK_ACCESS_TOKEN;

export interface TikTokEvent {
  event: string;
  event_time: number | string; // seconds (number) or ms/seconds string
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

/* helper: deep-clean null / undefined / "" */
function prune(obj: any): any {
  if (obj && typeof obj === "object") {
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (v && typeof v === "object") prune(v);
      if (
        v === undefined ||
        v === null ||
        v === "" ||
        (typeof v === "object" && !Object.keys(v).length)
      )
        delete obj[k];
    }
  }
  return obj;
}

/* tiny wrapper – now throws on any failure */
export async function sendTikTokEvent(payload: TikTokEvent): Promise<void> {
  /* ------------------ env sanity checks ------------------ */
  if (!TIKTOK_PIXEL_ID) throw new Error("TIKTOK_PIXEL_ID env-var is missing");
  if (!TIKTOK_TOKEN) throw new Error("TIKTOK_ACCESS_TOKEN env-var is missing");

  /* ---------------- normalise event_time ----------------- */
  const ts = Number(payload.event_time);
  payload.event_time =
    !Number.isNaN(ts) && ts > 1e12 ? Math.floor(ts / 1000) : ts;

  const body = prune({
    event_source: "web",
    event_source_id: TIKTOK_PIXEL_ID,
    data: [payload],
  });

  const url = new URL(
    "https://business-api.tiktok.com/open_api/v1.3/event/track/"
  );
  if (payload.test_event_code)
    url.searchParams.set("test_event_code", payload.test_event_code);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Access-Token": TIKTOK_TOKEN,
    },
    body: JSON.stringify(body),
  });

  /* -------------- error bubbling (no silent fail) -------- */
  const txt = await res.text();
  if (!res.ok) {
    throw new Error(`[tiktok] HTTP ${res.status} – ${txt.slice(0, 140)}`);
  }
  try {
    const json = JSON.parse(txt);
    if (json.code !== 0) {
      throw new Error(`[tiktok] API code ${json.code} – ${json.message ?? ""}`);
    }
  } catch {
    /* non-JSON ↔ let success stand */
  }

  console.log("[tiktok] ✓ sent", payload.event);
}
