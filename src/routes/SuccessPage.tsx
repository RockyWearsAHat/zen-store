import { useEffect } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useCart } from "../context/CartContext";
import { FaCheckCircle, FaHome, FaEnvelope } from "react-icons/fa";

export default function SuccessPage() {
  const [params] = useSearchParams();
  const { clearCart } = useCart();

  useEffect(() => {
    // clear local cart on page load
    clearCart();
  }, []);

  /*  ─── UI ───────────────────────────────────────────────────── */
  return (
    /* full-height hero background */
    <div
      className="min-h-dvh w-full bg-gradient-to-b from-stone-900 via-stone-900 to-stone-950
                    flex items-center justify-center px-4 pt-24 pb-16" /* ↑ add extra top padding */
    >
      {/* glass card */}
      <div
        className="w-full max-w-2xl bg-stone-800/80 backdrop-blur
                   rounded-2xl shadow-xl ring-1 ring-stone-700/50 p-10
                   text-center space-y-10"
      >
        {/* icon + title */}
        <div className="space-y-4">
          <div className="relative inline-flex">
            <div className="w-24 h-24 bg-brand rounded-full flex items-center justify-center">
              <FaCheckCircle className="text-stone-900 text-5xl" />
            </div>
            <div className="absolute inset-0 w-24 h-24 bg-brand rounded-full animate-ping opacity-20" />
          </div>

          <h1 className="text-4xl md:text-5xl font-extrabold text-brand">
            Thank&nbsp;You!
          </h1>
          <p className="text-lg md:text-xl text-stone-300">
            Your order has been confirmed
          </p>
        </div>

        {/* details card */}
        <div className="bg-stone-900/70 rounded-xl p-6 space-y-4 ring-1 ring-stone-700/60">
          <div className="flex items-center justify-center gap-2 text-brand">
            <FaEnvelope className="text-xl shrink-0" />
            <span className="font-medium">
              Your receipt will arrive in your inbox shortly
            </span>
          </div>
          <p className="text-sm text-stone-400 leading-relaxed">
            We’ve sent a confirmation email with your order details. You’ll
            receive tracking information once your order ships.
          </p>

          {/* reference */}
          {params.get("session_id") && (
            <p className="pt-4 border-t border-stone-700 text-xs text-stone-500">
              Order&nbsp;Reference:&nbsp;
              <span className="font-mono text-stone-300">
                {params.get("session_id")}
              </span>
            </p>
          )}
        </div>

        {/* next steps */}
        <div>
          <h3 className="text-base font-semibold mb-4 text-stone-200">
            What’s&nbsp;Next?
          </h3>
          <div className="grid sm:grid-cols-2 gap-4 text-sm text-stone-300">
            <div className="bg-stone-800/60 rounded-lg p-4 space-y-1">
              <p className="font-medium text-brand">1.&nbsp;Processing</p>
              <p>Your order is being prepared for shipment.</p>
            </div>
            <div className="bg-stone-800/60 rounded-lg p-4 space-y-1">
              <p className="font-medium text-brand">2.&nbsp;Tracking</p>
              <p>You’ll receive tracking details via email.</p>
            </div>
          </div>
        </div>

        {/* actions */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            to="/"
            className="inline-flex items-center justify-center gap-2 bg-brand
                       text-stone-900 px-6 py-3 rounded-lg font-semibold
                       hover:bg-brand/90 transition"
          >
            <FaHome /> Continue&nbsp;Shopping
          </Link>
          <a
            href="mailto:alexwaldmann2004@gmail.com"
            className="inline-flex items-center justify-center gap-2
                       border border-stone-600 text-stone-300 px-6 py-3
                       rounded-lg font-semibold hover:bg-stone-800 transition"
          >
            <FaEnvelope /> Contact&nbsp;Support
          </a>
        </div>

        {/* footer */}
        <p className="text-xs text-stone-500">
          Thank you for choosing Zen&nbsp;Essentials. We appreciate your
          business!
        </p>
      </div>
    </div>
  );
}
