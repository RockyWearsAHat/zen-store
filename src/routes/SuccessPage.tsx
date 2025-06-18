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

  return (
    <div className="min-h-screen bg-stone-900 text-stone-100 flex items-center justify-center px-4 pt-20 pb-8">
      <div className="max-w-2xl w-full text-center space-y-8">
        {/* Success Icon */}
        <div className="flex justify-center">
          <div className="relative">
            <div className="w-20 h-20 bg-brand rounded-full flex items-center justify-center">
              <FaCheckCircle className="text-stone-900 text-4xl" />
            </div>
            <div className="absolute inset-0 w-20 h-20 bg-brand rounded-full animate-ping opacity-20"></div>
          </div>
        </div>

        {/* Main Message */}
        <div className="space-y-4">
          <h1 className="text-4xl md:text-5xl font-bold text-brand">
            Thank You!
          </h1>
          <h2 className="text-xl md:text-2xl text-stone-300">
            Your Order Has Been Confirmed
          </h2>
        </div>

        {/* Success Details */}
        <div className="bg-stone-800 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-center gap-2 text-brand">
            <FaEnvelope className="text-lg" />
            <span className="font-medium">
              Your Receipt Email Will Arrive in Your Inbox Shortly
            </span>
          </div>

          <p className="text-stone-300 leading-relaxed">
            We've sent a confirmation email with your order details. You'll
            receive tracking information once your order ships.
          </p>

          {params.get("session_id") && (
            <div className="pt-4 border-t border-stone-700">
              <p className="text-sm text-stone-400">
                Order Reference:{" "}
                <span className="font-mono text-stone-300">
                  {params.get("session_id")}
                </span>
              </p>
            </div>
          )}
        </div>

        {/* What's Next */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-stone-200">What's Next?</h3>
          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <div className="bg-stone-800/50 rounded-lg p-4">
              <div className="font-medium text-brand mb-2">1. Processing</div>
              <p className="text-stone-400">
                Your order is being prepared for shipment
              </p>
            </div>
            <div className="bg-stone-800/50 rounded-lg p-4">
              <div className="font-medium text-brand mb-2">2. Tracking</div>
              <p className="text-stone-400">
                You'll receive tracking details via email
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
          <Link
            to="/"
            className="inline-flex items-center gap-2 bg-brand text-stone-900 px-6 py-3 rounded-lg font-medium hover:bg-brand/90 transition-colors"
          >
            <FaHome />
            Continue Shopping
          </Link>

          <a
            href="mailto:alexwaldmann2004@gmail.com"
            className="inline-flex items-center gap-2 border border-stone-600 text-stone-300 px-6 py-3 rounded-lg font-medium hover:bg-stone-800 transition-colors"
          >
            <FaEnvelope />
            Contact Support
          </a>
        </div>

        {/* Footer Message */}
        <div className="pt-8">
          <p className="text-stone-400 text-sm">
            Thank you for choosing Zen Essentials. We appreciate your business!
          </p>
        </div>
      </div>
    </div>
  );
}
