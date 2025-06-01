import "dotenv/config";

/* ---------- basic Dropshipper helpers (stub) ---------- */
// axios removed – use fetch (Node 18+)

// ---------------- types ----------------
export interface AliOrderResult {
  orderId: string;
  trackingNumber: string;
  orderCost: number;          // ← new
}

/* Places the order AND pays for it.
   Requires ALI_* env-vars that hold your AliExpress credentials / wallet. */
export async function createAliExpressOrder(
  items: { id: string; quantity: number }[],
  shipping: any
): Promise<AliOrderResult> {
  const orderLines = items.map((i) => ({
    product_id: i.id,
    quantity: i.quantity,
  }));

  // 1️⃣  create order ----------------------------------------------------------
  const createResp = await fetch(
    "https://api-sg.aliexpress.com/order/create",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ae-app-key": process.env.ALI_APP_KEY!,
        authorization: `Bearer ${process.env.ALI_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        order_lines: orderLines,
        logistics_address: shipping?.address,
        logistics_contact: shipping?.name,
      }),
    }
  ).then((r) => r.json());

  const orderId = createResp.order_id as string;

  // 2️⃣  pay for order ---------------------------------------------------------
  const payResp = await fetch(
    "https://api-sg.aliexpress.com/order/pay",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ae-app-key": process.env.ALI_APP_KEY!,
        authorization: `Bearer ${process.env.ALI_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({ order_id: orderId }),
    }
  ).then((r) => r.json());

  // cost the supplier charged your wallet, e.g. in USD
  const orderCost = Number(payResp.order_amount || 0);

  // 3️⃣  query tracking number -------------------------------------------------
  const trackResp = await fetch(
    `https://api-sg.aliexpress.com/order/${orderId}/tracking`
  ).then((r) => r.json());

  return {
    orderId,
    trackingNumber: trackResp.tracking_no ?? "PENDING",
    orderCost,
  };
}
