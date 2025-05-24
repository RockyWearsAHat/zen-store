import { Link } from "react-router-dom";
import { useCart } from "../context/CartContext";
import { calculateOrderAmount } from "../lib/pricing";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import CheckoutForm from "../components/CheckoutForm";
import { stripeAppearance } from "../lib/stripeAppearance"; // keep

// helpers for localStorage
/* guard against the literal string "undefined" leaking into Stripe */
const getPaymentIntentId = () => {
  const v = localStorage.getItem("paymentIntentId");
  return v && v !== "undefined" ? v : null;
};

// helper to pretty-print dollars
const formatCurrency = (v: number) =>
  v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

// returns the first valid image url it finds
const getItemImage = (item: any) =>
  item.image || item.imageUrl || item.thumbnail || item.img || "/Main.avif"; // ← updated fallback

export default function CartPage() {
  let { items, subtotal, removeItem, updateQuantity } = useCart();

  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(
    getPaymentIntentId()
  );
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [email, setEmail] = useState("");
  const [shipping, setShipping] = useState<any>(null);
  // buffer for current text in each qty input so price can react while typing
  const [editQty, setEditQty] = useState<Record<string, string>>({});
  const stripePromise = loadStripe(
    import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY!
  );

  // ensure Stripe inputs stay beige when the browser autofills them
  const autofillAwareAppearance = useMemo(
    () => ({
      ...stripeAppearance,
      rules: {
        ...stripeAppearance?.rules,
        ".Input--autofill": {
          backgroundColor: "var(--color-brand-400)",
          boxShadow: "0 0 0 1000px var(--color-brand-400) inset",
          color: "var(--color-stone-900)",
        },
      },
    }),
    []
  );

  /* ---------------- create / update payment-intent ---------------- */
  const syncIntent = async () => {
    const itemsPayload = items.map(({ id, quantity }) => ({ id, quantity }));
    const body: Record<string, any> = { items: itemsPayload, email, shipping };
    if (paymentIntentId) body.paymentIntentId = paymentIntentId;

    const res = await fetch("/api/create-or-update-payment-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error("Failed syncing payment intent", await res.text());
      return;
    }
    const { id, clientSecret } = await res.json();
    localStorage.setItem("paymentIntentId", id);
    setPaymentIntentId(id);
    setClientSecret(clientSecret);
  };
  /* ---------------------------------------------------------------- */

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

  /* -----------------------------------------------------------------
     Commit helper reused by onBlur *and* the global focusout listener
  ------------------------------------------------------------------*/
  const commitQty = useCallback(
    (el: HTMLInputElement, id: string) => {
      if (!el || !document.body.contains(el)) return; // Element must exist and be in DOM

      const currentValueInDom = el.value;
      let v = parseInt(currentValueInDom, 10);

      // Clamp the value
      if (isNaN(v) || v < 1) v = 1;
      if (v > 1000) v = 1000; // Changed max quantity to 1000

      const clampedValueStr = v.toString();

      // Update cart context if clamped value differs from current quantity in context,
      // or if the DOM input value needs to be re-synced to the clamped value.
      const currentItem = items.find((item) => item.id === id);
      if (
        !currentItem ||
        currentItem.quantity !== v ||
        el.value !== clampedValueStr
      ) {
        updateQuantity(id, v);
        el.value = clampedValueStr; // Ensure DOM is synced to the clamped value
      }

      // Always clear the pending edit state for this item, as it's now committed.
      setEditQty((s) => {
        const { [id]: _drop, ...rest } = s;
        return rest;
      });

      // Always ensure input style (width) is correct for the (potentially newly) clamped value.
      el.style.width = `${Math.min(clampedValueStr.length + 1, 5)}ch`; // Adjusted for max 4 digits ("1000") + padding
    },
    [updateQuantity, setEditQty, items] // items is needed for the currentItem check
  );

  // Document-level focusout listener (capture phase)
  useEffect(() => {
    const handler = (e: FocusEvent) => {
      const el = e.target;
      if (
        el instanceof HTMLInputElement &&
        el.classList.contains("qty-input")
      ) {
        const id = el.dataset.id;
        if (id) {
          commitQty(el, id);
        }
      }
    };
    document.addEventListener("focusout", handler, true);
    return () => document.removeEventListener("focusout", handler, true);
  }, [commitQty]);

  // Listener for visualViewport resize (often triggered by virtual keyboard show/hide)
  useEffect(() => {
    const visualViewport = window.visualViewport;

    const handleResize = () => {
      // When the visual viewport resizes, check all inputs that had pending edits
      // (indicated by presence in editQty) and try to commit them.
      document
        .querySelectorAll<HTMLInputElement>(".qty-input")
        .forEach((inputEl) => {
          const id = inputEl.dataset.id;
          if (id && editQty[id] !== undefined) {
            // If an edit was pending for this input
            commitQty(inputEl, id);
          }
        });
    };

    if (visualViewport) {
      visualViewport.addEventListener("resize", handleResize);
      return () => visualViewport.removeEventListener("resize", handleResize);
    } else {
      // Fallback for older browsers: listen to window.resize. Less reliable for keyboard.
      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }
  }, [commitQty, editQty]); // editQty is a dependency here to know which inputs were being edited.

  /* ---------- recompute price column width (grow & shrink) ---------- */
  useEffect(() => {
    const updatePriceWidth = () => {
      let max = 0; // start at 0; no hard minimum
      document.querySelectorAll<HTMLElement>(".price-text").forEach((el) => {
        const prev = el.style.width; // save fixed width
        el.style.width = "auto"; // measure natural width
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
  }, [items, subtotal, editQty]);
  /* -------------------------------------------------------------------- */
  /* -------------------------------------------------------------------- */
  /* ---------- empty-cart early return ---------- */
  if (items.length === 0)
    return (
      <div className="mt-24 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center text-center">
        <p className="text-xl mb-4">Your cart is empty.</p>
        <Link
          to="/"
          className="bg-brand text-slate-900 font-bold px-6 py-3 rounded-lg hover:opacity-90"
        >
          Browse
        </Link>
      </div>
    );
  /* ------------------------------------------------ */

  const { tax, fee, total } = calculateOrderAmount(subtotal);
  const extraCharges = tax + fee;

  /* ---------- MAIN MARK-UP ---------- */
  return (
    <section className="mt-16 bg-stone-900 text-stone-100 py-4 md:pt-4 md:pb-8 px-6 md:px-8 w-full max-w-none md:max-w-5xl mx-auto">
      <div className="grid md:grid-cols-3 gap-8">
        {/* ---------------- CART ITEMS ---------------- */}
        <div className="md:col-span-2 order-first md:order-none w-full max-w-none md:max-w-[650px] mx-auto">
          <h2 className="text-2xl font-bold mb-4">Your Cart</h2>

          <div className="overflow-x-auto rounded-lg border border-stone-700 w-full">
            <table className="w-full table-auto text-sm md:text-base">
              <colgroup>
                <col className="w-14" /> {/* image */}
                <col /> {/* title */}
                <col className="w-[3rem]" /> {/* qty – fixed small width */}
                <col className="price-col" /> {/* price */}
              </colgroup>

              <thead>
                <tr className="text-left text-stone-400">
                  <th
                    colSpan={2}
                    className="py-2 px-2 md:px-3 min-w-0 max-w-0 truncate"
                  >
                    Item
                  </th>
                  <th className="py-2 px-3 w-[3rem]">Qty</th>
                  <th className="py-2 pl-1 pr-[10px] md:pl-2 md:pr-[10px]">
                    <div className="flex justify-end items-center">
                      <span
                        className="price-text whitespace-nowrap"
                        style={{ width: "var(--price-text)" }}
                      >
                        Price
                      </span>
                      <span className="w-3 opacity-0 shrink-0 mx-[10px]">
                        ✕
                      </span>
                    </div>
                  </th>
                </tr>
              </thead>

              <tbody>
                {items.map((i, j) => (
                  <tr
                    key={j}
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

                    {/* title */}
                    <td className="py-2 px-1 md:px-2 truncate min-w-0 max-w-0">
                      {i.title}
                    </td>

                    {/* quantity */}
                    <td className="py-2 px-3 w-[3rem]">
                      <div className="h-8 flex items-center">
                        <input
                          key={i.id}
                          data-id={i.id}
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          min={1}
                          max={1000} // Stays 1000, commitQty enforces this.
                          step={1}
                          defaultValue={i.quantity}
                          onChange={(e) => {
                            // onChange primarily updates editQty for live price display.
                            // The actual updateQuantity to context is handled by commitQty.
                            setEditQty((s) => ({
                              ...s,
                              [i.id]: e.target.value,
                            }));
                          }}
                          onBlur={(e) => commitQty(e.currentTarget, i.id)}
                          onKeyDown={(e) => {
                            const allowed = [
                              "Backspace",
                              "Delete",
                              "ArrowLeft",
                              "ArrowRight",
                              "Home",
                              "End",
                              "Tab",
                              "Enter",
                            ];
                            // Allow more than 4 digits to be typed, actual limit enforced by onInput/max attribute
                            if (
                              !/^\d$/.test(e.key) && // Allow digits
                              !allowed.includes(e.key) &&
                              !e.metaKey &&
                              !e.ctrlKey
                            ) {
                              e.preventDefault();
                              return;
                            }
                            if (e.key === "Enter") {
                              (e.target as HTMLInputElement).blur();
                            }
                          }}
                          onPaste={(e) => {
                            e.preventDefault();
                            const text = e.clipboardData.getData("text");
                            const digits = text.replace(/\D/g, ""); // Get all digits from paste
                            const target = e.currentTarget as HTMLInputElement;

                            const start = target.selectionStart || 0;
                            const end = target.selectionEnd || 0;
                            const currentValue = target.value;
                            // Construct what the value would be if digits were inserted
                            target.value =
                              currentValue.substring(0, start) +
                              digits +
                              currentValue.substring(end);

                            // Move cursor to after inserted digits
                            target.selectionStart = target.selectionEnd =
                              start + digits.length;

                            // Manually dispatch an 'input' event so that onInput handler runs
                            const event = new Event("input", {
                              bubbles: true,
                              cancelable: true,
                            });
                            target.dispatchEvent(event);

                            target.blur(); // Commits the value via commitQty
                          }}
                          onInput={(e) => {
                            const el = e.currentTarget;
                            let value = el.value;

                            // Keep only digits
                            let numericString = value.replace(/\D/g, "");

                            // "0" is allowed during typing, commitQty handles min 1.
                            // Values > 1000 are allowed during typing, commitQty handles clamping.

                            el.value = numericString; // Update the input field

                            setEditQty((s) => ({ ...s, [i.id]: el.value }));

                            el.style.width = `${Math.min(
                              (el.value.length || 1) + 1,
                              5 // Max width for 4 digits + 1ch padding
                            )}ch`;
                          }}
                          className="qty-input inline-block px-1 text-stone-100 text-left appearance-none border-b-2 border-brand focus:outline-none focus:ring-0"
                          style={{
                            width: `${Math.min(
                              i.quantity.toString().length + 1,
                              5 // Initial width based on actual quantity (max 4 digits "1000" + padding)
                            )}ch`,
                          }}
                        />
                      </div>
                    </td>

                    {/* price */}
                    <td className="py-2 pl-1 pr-[10px] md:pl-2 md:pr-[10px]">
                      <div className="flex justify-end items-center">
                        {(() => {
                          // raw text currently in the field (undefined ⇒ no edit in progress)
                          const raw = editQty[i.id];
                          const parsed = parseInt(raw ?? "", 10);

                          // -------- clamp to ≤ 1000 --------
                          const qty =
                            raw === undefined // no edit → current cart qty
                              ? i.quantity
                              : isNaN(parsed) // non-number while typing
                              ? NaN
                              : Math.min(parsed, 1000); // cap at 1000
                          // ---------------------------------

                          const display =
                            raw === "" || isNaN(qty) || qty === 0 // <-- Updated condition
                              ? "$-.--"
                              : formatCurrency(i.price * qty);

                          return (
                            <span
                              className="price-text whitespace-nowrap"
                              style={{ width: "var(--price-text)" }}
                            >
                              {display}
                            </span>
                          );
                        })()}
                        <button
                          className="text-red-500 shrink-0 mx-[10px]"
                          onClick={() => removeItem(i.id)}
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

        {/* ---------------- ORDER SUMMARY ---------------- */}
        <aside className="bg-stone-800 p-6 rounded-lg h-fit order-last md:order-none md:sticky md:top-20 md:self-start">
          <h3 className="text-xl font-semibold mb-4">Order Summary</h3>
          <div className="space-y-1 mb-6 whitespace-nowrap">
            <p>Subtotal: {formatCurrency(subtotal)}</p>
            <p>Taxes &amp; Fees: {formatCurrency(extraCharges)}</p>
            <p className="font-bold text-lg">
              Total: {formatCurrency(total / 100)}
            </p>
          </div>
          <button
            onClick={() => setShowPaymentForm(true)}
            className="w-full bg-brand text-slate-900 font-bold px-8 py-3 rounded-lg hover:opacity-90"
          >
            Checkout
          </button>
        </aside>
      </div>

      {/* ---------------- PAYMENT MODAL ---------------- */}
      {showPaymentForm && clientSecret && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.5)] p-4">
          <div className="relative bg-stone-800 text-stone-100 w-full max-w-lg rounded-xl overflow-y-auto max-h-full p-4 border border-stone-700">
            <button
              onClick={() => setShowPaymentForm(false)}
              className="absolute top-3 right-3 text-2xl"
            >
              &times;
            </button>
            <Elements
              stripe={stripePromise}
              options={{ clientSecret, appearance: autofillAwareAppearance }}
            >
              <CheckoutForm
                clientSecret={clientSecret}
                email={email}
                setEmail={setEmail}
                setShipping={setShipping}
              />
            </Elements>
          </div>
        </div>
      )}
    </section>
  );
}
