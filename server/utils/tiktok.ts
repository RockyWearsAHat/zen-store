import crypto from "crypto";

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

/* ---------- helper: ensure content_id at top level ---------- */
function ensureContentId(props: TikTokEvent["properties"] = {}) {
  if (!props.content_id && Array.isArray(props.contents) && props.contents[0]) {
    props.content_id = props.contents[0].content_id;
    if (!props.content_name)
      props.content_name = props.contents[0].content_name;
  }
  return props;
}

/* helper – hash & lower-case */
const sha256 = (v: string) =>
  crypto.createHash("sha256").update(v.trim().toLowerCase()).digest("hex");

/* ---------- helper: hash user identifiers if not already hashed ---------- */
function normaliseUser(u: TikTokEvent["user"] = {}) {
  const maybeHash = (v?: string | null) =>
    v && !/^[a-f0-9]{64}$/i.test(v) ? sha256(v) : v;

  return {
    ...u,
    email: maybeHash(u.email),
    phone: maybeHash(u.phone),
    external_id: maybeHash(u.external_id),
  };
}

/* tiny wrapper – now throws on any failure */
export async function sendTikTokEvent(payload: TikTokEvent): Promise<void> {
  /* ------------------ env sanity checks ------------------ */
  if (!TIKTOK_PIXEL_ID || !TIKTOK_TOKEN) {
    console.warn(
      "[tiktok] env missing – event skipped:",
      payload.event,
      "(define TIKTOK_PIXEL_ID & TIKTOK_ACCESS_TOKEN in Netlify)"
    );
    return;
  }

  /* always send hashed user identifiers */
  if (payload.user) payload.user = normaliseUser(payload.user);

  /* guarantee commerce id -------- */
  payload.properties = ensureContentId(payload.properties);

  /* ---------------- normalise event_time ----------------- */
  const ts = Number(payload.event_time);
  payload.event_time =
    !Number.isNaN(ts) && ts > 1e12 ? Math.floor(ts / 1000) : Math.floor(ts);

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
