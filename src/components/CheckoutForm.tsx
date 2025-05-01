import {
  useStripe,
  useElements,
  PaymentElement,
  AddressElement,
} from "@stripe/react-stripe-js";
import { FormEvent, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useCart } from "../context/CartContext";

interface Props {
  clientSecret: string;
  email: string;
  setEmail: (email: string) => void;
  setShipping: (info: any) => void; // ← new
}

export default function CheckoutForm({
  clientSecret,
  email,
  setEmail,
  setShipping,
}: Props) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { clearCart } = useCart();
  const [total, setTotal] = useState<number | null>(null);

  useEffect(() => {
    const fetchPaymentIntent = async () => {
      const res = await fetch(
        `/retrieve-payment-intent?clientSecret=${clientSecret}`
      );
      if (res.ok) {
        const { amount } = await res.json();
        setTotal(amount / 100); // convert cents to dollars
      }
    };
    fetchPaymentIntent();
  }, [clientSecret]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setLoading(true);

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });

    setLoading(false);
    if (error) {
      alert(error.message);
      return;
    }
    if (paymentIntent && paymentIntent.status === "succeeded") {
      // Fetch brand & last4
      try {
        const resp = await fetch(
          `/retrieve-payment-intent?clientSecret=${clientSecret}&expandCards=1`
        );
        if (resp.ok) {
          const { brand, last4 } = await resp.json();
          if (brand && last4) {
            alert(
              `Payment complete. Card used: ${brand.toUpperCase()} ****${last4}`
            );
          }
        }
      } catch (err) {
        console.error("Unable to retrieve card info", err);
      }
      clearCart();
      localStorage.removeItem("paymentIntent");
      navigate("/success");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-h-[80vh]">
      <div className="space-y-2">
        <label htmlFor="email" className="font-semibold">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          className="w-full border border-gray-300 rounded px-3 py-2"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="address" className="font-semibold">
          Address
        </label>
        <AddressElement
          options={{ mode: "shipping" }}
          onChange={(e) => {
            if (e.complete && e.value) {
              const { name, address } = e.value;
              // update parent with shipping
              setShipping({ name, address });
            }
          }}
        />
      </div>
      <PaymentElement
        id="payment-element"
        options={{
          layout: {
            type: "accordion",
            defaultCollapsed: false,
          },
        }}
      />
      {total !== null && (
        <div className="text-lg font-bold">Total: ${total.toFixed(2)}</div>
      )}
      <button
        disabled={loading || !stripe}
        className="hover:cursor-pointer bg-brand text-gray-900 w-full py-3 rounded-lg font-semibold disabled:opacity-50"
      >
        {loading ? "Processing…" : "Pay Now"}
      </button>
    </form>
  );
}
