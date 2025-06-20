/* Resolve test-event code once (only populated in builds where the var exists) */
const TEST_CODE = import.meta.env.VITE_TIKTOK_TEST_CODE as string | undefined;
/* treat localhost & *.dev as non-prod; extend as you wish */
const IS_TEST_BUILD =
  !!TEST_CODE &&
  (import.meta.env.DEV ||
    /^localhost$|\.local$|\.dev$/.test(window.location.hostname));

/* ---------- crypto helper (browser only) ---------- */
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input.trim().toLowerCase())
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/* ---------- identify helper (hashes PII) ---------- */
export async function identifyTikTokUser(user: {
  email?: string;
  phone_number?: string;
  external_id?: string;
}) {
  if (typeof window === "undefined" || !window.ttq) return;

  const payload: Record<string, string> = {};
  if (user.email) payload.email = await sha256Hex(user.email);
  if (user.phone_number)
    payload.phone_number = await sha256Hex(user.phone_number);
  if (user.external_id) payload.external_id = await sha256Hex(user.external_id);

  if (Object.keys(payload).length) {
    window.ttq.identify?.(payload); // ← safe optional call
  }
}

/* ---------- utilities ---------- */
const ensureContentId = (props: Record<string, any>) => {
  if (!props.content_id && Array.isArray(props.contents) && props.contents[0]) {
    props.content_id = props.contents[0].content_id;
    if (!props.content_name)
      props.content_name = props.contents[0].content_name;
    if (!props.content_type) props.content_type = "product";
  }
  /* fallback – if caller passed only id & title */
  if (!props.content_name && props.content_id)
    props.content_name = props.content_id;
  return props;
};

/* unique id helper (dup of CartContext) */
const genId = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2);

/* ---------- low-level proxy POST (now returns boolean) ---------- */
export async function postTikTokEvent(payload: {
  event: string;
  event_id?: string;
  properties?: Record<string, any>;
  user?: Record<string, any>;
  page?: Record<string, any>;
}): Promise<boolean> {
  const event_id = payload.event_id ?? genId();
  const body = {
    event: payload.event,
    event_id,
    event_time: Math.floor(Date.now() / 1000),
    properties: ensureContentId(payload.properties ?? {}),
    user: payload.user,
    page: { url: window.location.href, ...(payload.page ?? {}) },
    /* include test flag ONLY on test builds */
    ...(IS_TEST_BUILD ? { test_event_code: TEST_CODE } : {}),
  };

  const json = JSON.stringify(body);

  /* prefer Beacon when available (fire-and-forget, survives redirect) */
  if (navigator.sendBeacon) {
    const ok = navigator.sendBeacon(
      "/api/tiktok/event",
      new Blob([json], { type: "application/json" })
    );
    return ok;
  }

  try {
    const res = await fetch("/api/tiktok/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: json,
      keepalive: true,
    });
    if (!res.ok && import.meta.env.DEV) {
      console.error("[TikTok] proxy error", await res.text());
    }
    return res.ok;
  } catch (e) {
    if (import.meta.env.DEV) console.error("[TikTok] network fail", e);
    return false;
  }
}

/* ---------- high-level helper (pixel + proxy) ---------- */
export function trackTikTokEvent(
  event: string,
  properties: Record<string, any> = {},
  extra: { user?: Record<string, any>; page?: Record<string, any> } = {}
) {
  const event_id = genId();
  const props = ensureContentId({ ...properties });

  /* pixel */
  if (typeof window !== "undefined" && window.ttq) {
    if (IS_TEST_BUILD && TEST_CODE && window.ttq.setTestEventCode)
      window.ttq.setTestEventCode(TEST_CODE);
    window.ttq.track(event, props, { event_id });
  }

  /* proxy (fire & forget) */
  postTikTokEvent({ event, event_id, properties: props, ...extra });
}
