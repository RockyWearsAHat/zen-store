import React, {
  createContext,
  useContext,
  useState,
  useMemo,
  useEffect,
} from "react";
import { catalogue, Sku } from "../lib/catalogue";
import { trackTikTokEvent } from "../lib/tiktokClient"; // add

/* ---------- TikTok helper (fires only in browser) ---------- */
declare global {
  interface Window {
    ttq?: {
      track: (
        event: string,
        data?: Record<string, any>,
        opts?: Record<string, any>
      ) => void;
      setTestEventCode?: (code: string) => void; // ← add
      identify?: (payload: Record<string, any>) => void; // ← NEW
    };
  }
}

/* ---------- fireAddToCart (sanitised) ---------- */
const fireAddToCart = (item: CartItem) => {
  if (typeof window === "undefined" || !window.ttq) return;

  const qty = Math.max(Number(item.quantity ?? 1), 1);
  const unit = item.price ?? catalogue[item.id as Sku]?.price ?? 0; // fallback
  const value = unit * qty;

  window.ttq.track("AddToCart", {
    /* top-level params required by TikTok */
    content_id: item.id,
    content_name: item.title,
    content_type: "product",
    currency: "USD",
    value,
    /* optional ‘contents’ array for VSA */
    contents: [
      { content_id: item.id, content_name: item.title, quantity: qty },
    ],
  });

  trackTikTokEvent("AddToCart", {
    content_id: item.id,
    content_name: item.title,
    content_type: "product",
    currency: "USD",
    value,
    contents: [
      { content_id: item.id, content_name: item.title, quantity: qty },
    ],
  });
};
// -------------------------------------------------------------

export interface CartItem {
  id: string;
  title: string;
  price: number; // dollars
  quantity: number;
  image?: string; // ← new (optional)
}

interface CartCtx {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, qty: number) => void;
  clearCart: () => void;
  subtotal: number;
}

const CartContext = createContext<CartCtx | null>(null);

export const CartProvider: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
  const [items, setItems] = useState<CartItem[]>(() => {
    /* safe on first render (SSR or client) */
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem("cart");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  // persist to localStorage
  useEffect(() => {
    localStorage.setItem("cart", JSON.stringify(items));
  }, [items]);

  const addItem = (raw: CartItem) => {
    /* ensure sane quantity before anything else */
    const qty = Math.max(Number(raw.quantity ?? 1), 1);
    const item = { ...raw, quantity: qty };

    /* 🔔 always fire the TikTok pixel */
    fireAddToCart(item);

    setItems((prev) => {
      const idx = prev.findIndex((i) => i.id === item.id);
      if (idx !== -1) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + qty };
        return copy;
      }
      return [...prev, { ...item, quantity: qty }];
    });
  };

  const removeItem = (id: string) =>
    setItems((prev) => prev.filter((i) => i.id !== id));

  const updateQuantity = (id: string, qty: number) =>
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, quantity: Math.max(qty, 1) } : i))
    );

  const clearCart = () => {
    setItems([]);
    localStorage.removeItem("cart");
    localStorage.removeItem("paymentIntentId"); // keep key names consistent
  };

  const subtotal = useMemo(
    () =>
      items.reduce((sum, i) => {
        const unit = catalogue[i.id as Sku]?.price ?? i.price ?? 0;
        return sum + unit * i.quantity;
      }, 0),
    [items]
  );

  const value = {
    items,
    addItem,
    removeItem,
    updateQuantity,
    clearCart,
    subtotal,
  };
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
};

export const useCart = () => {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be inside CartProvider");
  return ctx;
};
