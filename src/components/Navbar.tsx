import { Link } from "react-router-dom";
import { useCart } from "../context/CartContext";
import { calculateOrderAmount } from "../lib/pricing";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useEffect, useState } from "react";
import CheckoutForm from "../components/CheckoutForm";
import { stripeAppearance } from "../lib/stripeAppearance";

// helpers for localStorage
/* guard against the literal string "undefined" leaking into Stripe */
const getPaymentIntentId = () => {
  const v = localStorage.getItem("paymentIntentId");
  return v && v !== "undefined" ? v : null;
};

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
      <div className="left-[50%] top-[50%] transform-[translate(-50%,-50%)] flex absolute flex-col items-center justify-center text-center">
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

  return (
    <section className="bg-stone-900 text-stone-100 p-8 max-w-3xl mx-auto">
      <h2 className="text-2xl font-bold mb-4">Your Cart</h2>
      <table className="w-full mb-6 border-stone-700">
        <thead>
          <tr className="text-left text-stone-400">
            <th>Item</th>
            <th>Qty</th>
            <th>Price</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} className="border-t border-stone-700">
              <td className="py-2">{i.title}</td>
              <td>
                <input
                  type="number"
                  value={i.quantity}
                  min={1}
                  onChange={(e) => updateQuantity(i.id, Number(e.target.value))}
                  className="w-16 border border-stone-600 rounded px-2 bg-stone-800 text-stone-100"
                />
              </td>
              <td>${(i.price * i.quantity).toFixed(2)}</td>
              <td>
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

      <div className="space-y-1 mb-8">
        <p>Subtotal: ${subtotal.toFixed(2)}</p>
        <p>Tax (7%): ${tax.toFixed(2)}</p>
        <p>Processing Fee (3% + $0.30): ${fee.toFixed(2)}</p>
        <p className="font-bold text-lg">Total: ${(total / 100).toFixed(2)}</p>
      </div>

      <button
        onClick={() => setShowPaymentForm(true)}
        className="bg-brand text-slate-900 font-bold px-8 py-3 rounded-lg hover:opacity-90"
      >
        Checkout
      </button>

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
              options={{ clientSecret, appearance: stripeAppearance }}
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
