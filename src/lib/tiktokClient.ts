/* Thin wrapper used on the client to invoke the /api/tiktok/event proxy */
export async function postTikTokEvent(payload: Record<string, any>) {
  try {
    await fetch("/api/tiktok/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    /* silently ignore – pixel already fired in-browser */
  }
}
