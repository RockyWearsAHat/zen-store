import { Link } from "react-router-dom";
import { useCart } from "../context/CartContext";
import { calculateOrderAmount } from "../lib/pricing";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useEffect, useLayoutEffect, useState, useRef } from "react";
import CheckoutForm from "../components/CheckoutForm";
import { stripeAppearance } from "../lib/stripeAppearance";
import { catalogue, Sku } from "../lib/catalogue";
import { trackTikTokEvent } from "../lib/tiktokClient"; // ← add

// helpers for localStorage
/* guard against the literal string "undefined" leaking into Stripe */
const getPaymentIntentId = () => {
  const v = localStorage.getItem("paymentIntentId");
  return v && v !== "undefined" ? v : null;
};

// helper to pretty-print dollars
const formatCurrency = (v: number) => `$${v.toFixed(2)}`;

// returns the first valid image url it finds
const getItemImage = (item: any) =>
  item.image || item.imageUrl || item.thumbnail || item.img || "/Main.avif"; // ← updated fallback

/* ---------- TikTok helpers ---------- */
const trackPixel = trackTikTokEvent; // alias for brevity
// -------------------------------------

export default function CartPage() {
  const { items, subtotal, removeItem, updateQuantity } = useCart();
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(
    getPaymentIntentId()
  );
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [email, setEmail] = useState("");
  const [shipping, setShipping] = useState<any>(null);
  const [newsletter, setNewsletter] = useState<boolean>(false);
  const checkoutButtonRef = useRef<HTMLButtonElement>(null);
  const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

  // create OR update payment intent
  const syncIntent = async () => {
    const itemsPayload = Array.isArray(items)
      ? items.map(({ id, quantity }) => ({ id, quantity }))
      : [];
    const body: Record<string, any> = {
      items: itemsPayload,
      email,
      shipping,
      newsletter,
    };
    if (paymentIntentId) body.paymentIntentId = paymentIntentId; // only when valid

    const res = await fetch("/api/create-or-update-payment-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), // stringify back
    });
    if (!res.ok) {
      console.error("Failed syncing payment intent", await res.text());
      return;
    }
    const { id, clientSecret } = await res.json();
    if (id) {
      localStorage.setItem("paymentIntentId", id);
      setPaymentIntentId(id);
    }
    setClientSecret(clientSecret);
  };

  // keep payment intent in sync whenever cart value changes
  useEffect(() => {
    if (items.length > 0) {
      syncIntent(); // subtotal changed
    } else {
      localStorage.removeItem("paymentIntentId");
      setPaymentIntentId(null);
      setClientSecret(null);
      setShowPaymentForm(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtotal]);

  // update payment intent whenever the email changes
  useEffect(() => {
    if (paymentIntentId && email.trim() && items.length > 0) {
      syncIntent(); // pushes receipt_email to Stripe
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  const pricePrevRef = useRef(0); // track last applied width

  /* ---------- recompute price column width (grow & shrink) ---------- */
  useLayoutEffect(() => {
    const updatePriceWidth = () => {
      let max = 0; // start at 0 – no hard minimum
      document.querySelectorAll<HTMLElement>(".price-text").forEach((el) => {
        const prev = el.style.width; // save fixed width
        el.style.width = "auto"; // measure natural
        max = Math.max(max, el.scrollWidth); // widest content
        el.style.width = prev; // restore
      });

      if (max === pricePrevRef.current) return; // nothing changed
      pricePrevRef.current = max;

      document.documentElement.style.setProperty("--price-text", `${max}px`);
      // update column itself to force immediate table re-layout
      document
        .querySelectorAll<HTMLTableColElement>("col.price-col")
        .forEach((c) => (c.style.width = `${max + 32}px`)); // 12 icon + 20 gap
    };

    updatePriceWidth();
    window.addEventListener("resize", updatePriceWidth);
    return () => window.removeEventListener("resize", updatePriceWidth);
  }, [items, subtotal]);
  /* -------------------------------------------------------------------- */

  /* ---------- focus management for modal when page navigation occurs ---------- */
  useEffect(() => {
    if (!showPaymentForm) return;

    const handleVisibilityChange = () => {
      // When page becomes visible again, focus the modal
      if (!document.hidden) {
        setTimeout(() => {
          const modal = document.querySelector('[role="dialog"]');
          if (modal) {
            (modal as HTMLElement).focus();
          }
        }, 100);
      }
    };

    const handleFocus = () => {
      // When window regains focus, ensure modal is focused
      setTimeout(() => {
        const modal = document.querySelector('[role="dialog"]');
        if (modal && showPaymentForm) {
          (modal as HTMLElement).focus();
        }
      }, 100);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [showPaymentForm]);

  // Handle modal close with focus management
  const handleModalClose = (
    reason?: "shift-tab" | "escape" | "tab-out" | "click"
  ) => {
    setShowPaymentForm(false);

    // Focus the checkout button when closed via shift+tab
    if (reason === "shift-tab" && checkoutButtonRef.current) {
      // Small delay to ensure modal is fully closed before focusing
      setTimeout(() => {
        checkoutButtonRef.current?.focus();
      }, 100);
    }
  };

  /* ---------- 1️⃣  cart page view ---------- */
  useEffect(() => {
    if (items.length === 0) return;
    const contents = items.map((i) => ({
      content_id: i.id,
      content_name: i.title,
      quantity: i.quantity,
    }));
    const common = {
      content_type: "product",
      contents,
      content_id: contents[0]?.content_id,
      content_name: contents[0]?.content_name,
      currency: "USD",
      value: subtotal,
    };
    trackPixel("ViewCart", common); // single event
    // fire only once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- helper to open checkout & fire event ---------- */
  const openCheckout = () => {
    const contents = items.map((i) => ({
      content_id: i.id,
      content_name: i.title,
      quantity: i.quantity,
    }));
    const value = total / 100;
    trackPixel("InitiateCheckout", {
      content_type: "product",
      contents,
      content_id: contents[0]?.content_id,
      content_name: contents[0]?.content_name,
      currency: "USD",
      value,
    });
    setShowPaymentForm(true);
  };

  if (items.length === 0)
    return (
      <div className="mt-24 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex absolute flex-col items-center justify-center text-center">
        <p className="text-xl mb-4 relative">Your cart is empty.</p>
        <Link
          className="relative w-full bg-brand text-slate-900 font-bold px-6 py-3 rounded-lg hover:opacity-90"
          to="/"
        >
          Browse
        </Link>
      </div>
    );

  const { tax, fee, total } = calculateOrderAmount(subtotal);
  const extraCharges = tax + fee; // merged taxes & fees

  return (
    <section className="mt-24 bg-stone-900 text-stone-100 py-4 px-6 md:py-8 md:px-8 max-w-5xl mx-auto">
      <div className="grid md:grid-cols-3 gap-8">
        {/* ---------- cart items ---------- */}
        <div className="md:col-span-2 order-last md:order-none w-full max-w-[650px] mx-auto">
          <h2 className="text-2xl font-bold mb-4">Your Cart</h2>

          <div className="overflow-x-auto rounded-lg border border-stone-700 w-full">
            {/* Use table-fixed and w-full for the table itself */}
            <table className="w-full table-fixed text-left">
              <colgroup>
                <col className="w-24" />
                <col />
                <col className="w-24" />
              </colgroup>

              <thead>
                <tr className="text-left text-stone-400">
                  <th className="py-2 px-2 md:px-3 w-14">Item</th>
                  <th className="py-2 px-2 md:px-3 w-auto" />
                  {/* ↓ unify padding with body cell (px-1 on mobile) */}
                  <th className="py-2 px-1 md:px-3 w-16">Qty</th>
                  <th className="py-2 pl-1 pr-8 md:pl-2 md:pr-8">
                    <div className="flex justify-end items-center gap-[20px]">
                      {/* right-aligned like numbers */}
                      <span
                        className="price-text text-left truncate"
                        style={{ width: "var(--price-text)" }} // ← was minWidth
                      >
                        Price
                      </span>
                      <span className="w-3 opacity-0 shrink-0">✕</span>
                    </div>
                  </th>
                </tr>
              </thead>

              <tbody>
                {items.map((i) => (
                  <tr
                    key={i.id}
                    className="border-t border-stone-700 h-14 align-middle"
                  >
                    {/* image */}
                    <td className="py-2 px-2 md:px-3">
                      <img
                        src={getItemImage(i)}
                        alt={i.title}
                        className="w-14 aspect-square object-cover rounded mx-auto"
                      />
                    </td>
                    <td className="py-2 px-1 md:px-2 truncate">{i.title}</td>
                    {/* quantity – left-aligned, no jump */}
                    <td className="py-2 px-1 md:px-2">
                      <div className="h-8 flex items-center">
                        {" "}
                        {/* fixes vertical jump */}
                        <input
                          type="number"
                          min={1}
                          step={1}
                          defaultValue={i.quantity}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v !== "" && Number(v) >= 1)
                              updateQuantity(i.id, Number(v));
                          }}
                          onBlur={(e) => {
                            const v = parseInt(e.target.value, 10);
                            updateQuantity(i.id, isNaN(v) || v < 1 ? 1 : v);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter")
                              (e.target as HTMLInputElement).blur();
                          }}
                          aria-label={`${i.title} quantity`}
                          className="appearance-none w-full max-w-[3.5rem] h-full border border-stone-600 rounded px-2 bg-stone-800 text-stone-100 text-center"
                        />
                      </div>
                    </td>

                    {/* ---------- price cell ---------- */}
                    <td className="py-2 pl-1 pr-8 md:pl-2 md:pr-8">
                      <div className="flex justify-end items-center gap-[20px]">
                        {/* fixed width, grows left, no overflow into gap */}
                        <span
                          className="price-text text-right whitespace-nowrap"
                          style={{ width: "var(--price-text)" }} // ← was minWidth
                        >
                          {formatCurrency(
                            (catalogue[i.id as Sku]?.price ?? i.price ?? 0) *
                              i.quantity
                          )}
                        </span>
                        <button
                          className="text-red-500 w-3 shrink-0"
                          onClick={() => removeItem(i.id)}
                          aria-label={`Remove ${i.title} from cart`}
                        >
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ---------- order summary ---------- */}
        <aside className="bg-stone-800 p-6 rounded-lg h-fit order-first md:order-none md:sticky md:top-24 md:self-start">
          <h3 className="text-xl font-semibold mb-4">Order Summary</h3>
          <div className="space-y-1 mb-6">
            <p>Subtotal: {formatCurrency(subtotal)}</p>
            <p>Taxes &amp; Fees: {formatCurrency(extraCharges)}</p>
            <p className="font-bold text-lg">
              Total: {formatCurrency(total / 100)}
            </p>
          </div>
          <button
            ref={checkoutButtonRef}
            onClick={openCheckout}
            className="w-full bg-brand text-slate-900 font-bold px-8 py-3 rounded-lg hover:opacity-90"
          >
            Checkout
          </button>
        </aside>
      </div>
      {showPaymentForm && clientSecret && (
        <div
          className="fixed inset-0 z-50 bg-[rgba(0,0,0,0.5)] flex items-start justify-center p-3 sm:p-4"
          onClick={() => handleModalClose("click")}
          data-backdrop="true"
        >
          <div
            className="w-full max-w-lg my-6 sm:my-8 max-h-[calc(100vh-3rem)] sm:max-h-[calc(100vh-4rem)] overflow-y-auto checkout-modal-container bg-stone-900 border-stone-700"
            style={{
              scrollbarWidth: "none", // Firefox
              msOverflowStyle: "none", // IE/Edge
            }}
          >
            <style>
              {`
                /* Hide scrollbar for WebKit browsers */
                .checkout-modal-container::-webkit-scrollbar {
                  display: none;
                  width: 0;
                  height: 0;
                }
                
                /* Additional scrollbar hiding for Chrome/Safari */
                .checkout-modal-container::-webkit-scrollbar-track {
                  display: none;
                }
                
                .checkout-modal-container::-webkit-scrollbar-thumb {
                  display: none;
                }
                
                /* Hide scrollbar in Firefox */
                .checkout-modal-container {
                  scrollbar-width: none;
                  -ms-overflow-style: none;
                }
              `}
            </style>
            <div
              className="relative text-stone-100 rounded-xl p-5 sm:p-6 border"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="checkout-title"
              style={{ outline: "none" }}
            >
              <Elements
                stripe={stripePromise}
                options={{ clientSecret, appearance: stripeAppearance }}
              >
                <CheckoutForm
                  clientSecret={clientSecret}
                  email={email}
                  setEmail={setEmail}
                  setShipping={setShipping}
                  setNewsletter={setNewsletter}
                  onRequestClose={handleModalClose}
                />
              </Elements>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
