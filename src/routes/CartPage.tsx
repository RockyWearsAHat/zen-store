import { Link } from "react-router-dom";
import { useCart } from "../context/CartContext";
import { calculateOrderAmount } from "../lib/pricing";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useEffect, useState } from "react";
import CheckoutForm from "../components/CheckoutForm";

// helpers for localStorage
const getPaymentIntentId = () => localStorage.getItem("paymentIntentId");

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
    const res = await fetch("/api/create-or-update-payment-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: itemsPayload,
        paymentIntentId,
        email, // always send email
        shipping, // ← pass shipping
      }),
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

  // keep payment intent in sync whenever cart value changes
  useEffect(() => {
    if (items.length) {
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
    if (paymentIntentId && email.trim()) {
      syncIntent(); // pushes receipt_email to Stripe
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  if (items.length === 0)
    return (
      <div className="p-8 text-center">
        <p>Your cart is empty.</p>
        <Link className="text-brand underline" to="/product">
          Shop now
        </Link>
      </div>
    );

  const { tax, fee, total } = calculateOrderAmount(subtotal);

  return (
    <section className="p-8 max-w-3xl mx-auto">
      <h2 className="text-2xl font-bold mb-4">Your Cart</h2>
      <table className="w-full mb-6">
        <thead>
          <tr className="text-left">
            <th>Item</th>
            <th>Qty</th>
            <th>Price</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} className="border-t">
              <td className="py-2">{i.title}</td>
              <td>
                <input
                  type="number"
                  value={i.quantity}
                  min={1}
                  onChange={(e) => updateQuantity(i.id, Number(e.target.value))}
                  className="w-16 border rounded px-2"
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
        className="bg-brand text-gray-900 px-8 py-3 rounded-lg hover:opacity-90"
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
