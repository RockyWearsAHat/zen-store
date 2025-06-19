/* Resolve test-event code once (only populated in builds where the var exists) */
const TEST_CODE = import.meta.env.VITE_TIKTOK_TEST_CODE as string | undefined;

/* unique id helper (dup of CartContext) */
const genId = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2);

/* Thin wrapper used on the client to invoke the /api/tiktok/event proxy */
export async function postTikTokEvent(payload: {
  event: string;
  properties?: Record<string, any>;
  user?: Record<string, any>;
  page?: Record<string, any>;
}) {
  try {
    const body = {
      ...payload,
      /* TikTok wants seconds */
      event_time: Math.floor(Date.now() / 1000).toString(),
      event_id: genId(),
      /* attach test code only when caller passes it */
      ...((payload as any).test_event_code
        ? { test_event_code: (payload as any).test_event_code }
        : {}),
    };

    /* Set test-code for the in-browser pixel once per load */
    if (
      TEST_CODE &&
      typeof window !== "undefined" &&
      window.ttq?.setTestEventCode
    ) {
      window.ttq.setTestEventCode(TEST_CODE);
    }

    await fetch("/api/tiktok/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    /* no-op – errors are non-blocking */
  }
}
