import { Link } from "react-router-dom";
import { FaShoppingCart } from "react-icons/fa";
import { useCart } from "../context/CartContext";

export default function Header() {
  const { items } = useCart();
  const count = items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <header
      className="bg-stone-900 text-stone-100 p-4 flex justify-between
                 fixed top-0 left-0 w-full z-50 border-b border-stone-800"
    >
      {/* ---- skip link ---- */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 bg-brand text-slate-900 px-3 py-2 rounded"
      >
        Skip to main content
      </a>
      <Link to="/" className="font-bold text-xl">
        Zen Essentials
      </Link>
      <nav className="flex items-center gap-6">
        <Link
          to="/cart"
          aria-label="View cart"
          className="relative text-stone-100"
        >
          <FaShoppingCart size={22} aria-hidden="true" className="text-white" />
          {count > 0 && (
            <span
              aria-live="polite"
              aria-atomic="true"
              className="absolute -top-2 -right-2 bg-brand text-stone-900
                   rounded-full w-5 h-5 text-xs flex items-center justify-center"
            >
              {count}
            </span>
          )}
        </Link>
      </nav>
    </header>
  );
}
