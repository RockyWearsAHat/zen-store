import { useEffect } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useCart } from "../context/CartContext";

export default function SuccessPage() {
  const [params] = useSearchParams();
  const { clearCart } = useCart();

  useEffect(() => {
    // clear local cart once we know Stripe succeeded
    clearCart();
    localStorage.removeItem("paymentIntentId");
  }, []);

  return (
    <section className="bg-stone-900 text-stone-100 p-8 text-center">
      <h2 className="text-3xl font-bold text-brand mb-4">
        Payment Successful 🎉
      </h2>
      <p className="mb-2">Your session ID: {params.get("session_id")}</p>
      <Link className="underline text-brand" to="/">
        Back to Home
      </Link>
    </section>
  );
}
