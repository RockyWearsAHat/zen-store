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
        `/api/retrieve-payment-intent?clientSecret=${clientSecret}`
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
          `/api/retrieve-payment-intent?clientSecret=${clientSecret}&expandCards=1`
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
      localStorage.removeItem("paymentIntentId");
      navigate("/success");
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 max-h-[80vh] text-stone-100 bg-stone-900 p-4 rounded-lg"
    >
      {/* ------------ EMAIL ------------ */}
      <div className="space-y-2">
        <label htmlFor="email" className="font-semibold">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          /* unify with Stripe beige */
          className="w-full rounded px-3 py-2 bg-[#d2b277] text-[#1c1917]
                     placeholder-[#1c1917]/70 focus:outline-none focus:ring-0"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      {/* ----------- ADDRESS ------------ */}
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

      {/* PaymentElement already picks up colours from appearance */}
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
        /* same beige as inputs for perfect match */
        className="hover:cursor-pointer bg-[#d2b277] text-[#1c1917] w-full py-3
                   rounded-lg font-semibold disabled:opacity-50 mb-3"
      >
        {loading ? "Processing…" : "Pay Now"}
      </button>

      {/* ─── terms & policies notice ─── */}
      <p className="text-xs text-stone-400 text-center">
        By placing your order, you agree to Zen&nbsp;Essentials’&nbsp;
        <a href="/privacy" className="underline">
          Privacy&nbsp;Notice
        </a>
        ,&nbsp;
        <a href="/returns" className="underline">
          Returns&nbsp;Policy
        </a>
        &nbsp;and&nbsp;
        <a href="/terms-and-conditions" className="underline">
          Terms&nbsp;&amp;&nbsp;Conditions
        </a>
        .
      </p>
    </form>
  );
}
