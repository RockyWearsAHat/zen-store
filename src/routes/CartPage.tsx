import { Link } from "react-router-dom";
import { useCart } from "../context/CartContext";
import { calculateOrderAmount } from "../lib/pricing";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useEffect, useState } from "react";
import CheckoutForm from "../components/CheckoutForm";

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

export default function CartPage() {
  const { items, subtotal, removeItem, updateQuantity } = useCart();
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(
    getPaymentIntentId()
  );
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [email, setEmail] = useState("");
  const [shipping, setShipping] = useState<any>(null);
  const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

  // create OR update payment intent
  const syncIntent = async () => {
    const itemsPayload = Array.isArray(items)
      ? items.map(({ id, quantity }) => ({ id, quantity }))
      : [];
    const body: Record<string, any> = {
      items: itemsPayload,
      email, // always send email
      shipping, // may be null
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
            <table className="w-full table-fixed text-sm md:text-base">
              <thead>
                <tr className="text-left text-stone-400">
                  {/* Define precise column widths and smaller mobile padding */}
                  <th className="py-2 px-1 md:px-3 w-14">Item</th>{" "}
                  {/* 3.5rem / 56px */}
                  <th className="py-2 px-1 md:px-3" />{" "}
                  {/* Title column, flexible width */}
                  <th className="py-2 px-1 md:px-3 w-16 text-center">
                    Qty
                  </th>{" "}
                  {/* 4rem / 64px */}
                  <th className="py-2 px-1 md:px-3 w-20 text-right">
                    Price
                  </th>{" "}
                  {/* 5rem / 80px */}
                  <th className="py-2 px-1 md:px-3 w-8 text-center" />{" "}
                  {/* 2rem / 32px */}
                </tr>
              </thead>

              <tbody>
                {items.map((i) => (
                  <tr
                    key={i.id}
                    className="border-t border-stone-700 h-14 align-middle"
                  >
                    {/* image cell with consistent padding */}
                    <td className="py-2 px-1 md:px-3">
                      <img
                        src={getItemImage(i)}
                        alt={i.title}
                        className="w-14 h-14 object-cover rounded mx-auto" // Explicitly 56x56px
                      />
                    </td>

                    {/* title cell with consistent padding */}
                    <td className="py-2 px-1 md:px-3 truncate">{i.title}</td>

                    {/* quantity cell with consistent padding */}
                    <td className="py-2 px-1 md:px-3">
                      <div className="h-8 flex items-center justify-center">
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
                          className="appearance-none w-full max-w-[3.5rem] h-full border border-stone-600 rounded px-2 bg-stone-800 text-stone-100 text-center"
                        />
                      </div>
                    </td>

                    {/* price cell with consistent padding */}
                    <td className="py-2 px-1 md:px-3 text-right whitespace-nowrap">
                      {formatCurrency(i.price * i.quantity)}
                    </td>

                    {/* delete cell with consistent padding */}
                    <td className="py-2 px-1 md:px-3 text-center">
                      <button
                        onClick={() => removeItem(i.id)}
                        className="text-red-500"
                      >
                        ✕
                      </button>
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
            onClick={() => setShowPaymentForm(true)}
            className="w-full bg-brand text-slate-900 font-bold px-8 py-3 rounded-lg hover:opacity-90"
          >
            Checkout
          </button>
        </aside>
      </div>
      {showPaymentForm && clientSecret && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.5)] p-4">
          <div className="relative bg-white w-full max-w-lg rounded-xl overflow-y-auto max-h-full p-4">
            <button
              onClick={() => setShowPaymentForm(false)}
              className="absolute top-3 right-3 text-2xl"
            >
              &times;
            </button>
            <Elements
              stripe={stripePromise}
              options={{
                clientSecret,
                appearance: {
                  theme: "flat",
                  variables: { spacingUnit: "2px", fontSizeBase: "14px" },
                },
              }}
            >
              <CheckoutForm
                clientSecret={clientSecret}
                email={email}
                setEmail={setEmail}
                setShipping={setShipping} // ← new
              />
            </Elements>
          </div>
        </div>
      )}
    </section>
  );
}
