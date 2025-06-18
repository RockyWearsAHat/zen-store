import {
  useStripe,
  useElements,
  PaymentElement,
  AddressElement,
} from "@stripe/react-stripe-js";
import { useState, useEffect, FormEvent, useRef, useLayoutEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useCart } from "../context/CartContext";

interface Props {
  clientSecret: string;
  email: string;
  setEmail: (email: string) => void;
  setShipping: (info: any) => void;
  setNewsletter: (on: boolean) => void;
  onRequestClose?: () => void;
}

export default function CheckoutForm({
  clientSecret,
  email,
  setEmail,
  setShipping,
  setNewsletter,
  onRequestClose,
}: Props) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { clearCart } = useCart();
  const [total, setTotal] = useState<number | null>(null);
  const [newsletter, setLocalNewsletter] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const submitButtonRef = useRef<HTMLButtonElement | null>(null);

  // Focus first element when form shows
  useLayoutEffect(() => {
    // Get the modal container and focus the close button (first focusable element)
    const modalContainer =
      formRef.current?.closest('[role="dialog"]') ||
      formRef.current?.parentElement;

    if (modalContainer) {
      const closeButton = modalContainer.querySelector<HTMLElement>(
        '[aria-label="Close checkout form"]'
      );
      closeButton?.focus();
    }
  }, []);

  useEffect(() => {
    const fetchPaymentIntent = async () => {
      const res = await fetch(
        `/api/retrieve-payment-intent?clientSecret=${clientSecret}`
      );
      if (res.ok) {
        const { amount } = await res.json();
        setTotal(amount / 100);
      }
    };
    fetchPaymentIntent();
  }, [clientSecret]);

  // Improved focus trap and keyboard handling
  useEffect(() => {
    if (!onRequestClose) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Handle Escape key
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onRequestClose();
        return;
      }

      // Handle Tab key for focus trapping
      if (e.key === "Tab") {
        // Get the modal container (parent of the form)
        const modalContainer =
          formRef.current?.closest('[role="dialog"]') ||
          formRef.current?.parentElement;

        if (modalContainer) {
          const focusableElements =
            modalContainer.querySelectorAll<HTMLElement>(
              'input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), iframe, a[href]'
            );

          if (focusableElements.length === 0) return;

          const firstElement = focusableElements[0];
          const lastElement = focusableElements[focusableElements.length - 1];

          // If Shift+Tab on first element (close button), close the form
          if (e.shiftKey && document.activeElement === firstElement) {
            e.preventDefault();
            onRequestClose();
            return;
          }
          // If Tab on last element (Terms link), allow tab out and close the form
          else if (!e.shiftKey && document.activeElement === lastElement) {
            e.preventDefault();
            onRequestClose();
            return;
          }
        }
      }
    };

    // Handle clicks outside the form (on backdrop)
    const handleClickOutside = (e: MouseEvent) => {
      if (formRef.current && !formRef.current.contains(e.target as Node)) {
        // Check if the click is on the close button or backdrop
        const target = e.target as HTMLElement;
        if (
          target.closest("[data-backdrop]") ||
          target.closest('[aria-label="Close checkout form"]')
        ) {
          onRequestClose();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onRequestClose]);

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
    <div>
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className="space-y-4 max-h-[80vh] text-stone-100"
        role="form"
        aria-labelledby="checkout-title"
      >
        <h2 id="checkout-title" className="text-xl font-bold mb-4">
          Checkout
        </h2>

        {/* EMAIL */}
        <div className="space-y-2">
          <label htmlFor="email" className="font-semibold">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            className="w-full rounded-md px-3 py-2
                       bg-stone-800 border border-stone-600
                       text-stone-100 placeholder-stone-400
                       focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand
                       transition-colors"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-required="true"
          />

          <div className="flex items-center gap-2 text-sm mt-2">
            <input
              id="newsletter"
              type="checkbox"
              checked={newsletter}
              onChange={(e) => {
                setLocalNewsletter(e.target.checked);
                setNewsletter(e.target.checked);
              }}
              className="focus:ring-2 focus:ring-brand focus:outline-none"
              aria-labelledby="newsletter-label"
            />
            <label id="newsletter-label" htmlFor="newsletter">
              Subscribe to our newsletter
            </label>
          </div>
        </div>

        {/* ADDRESS */}
        <div className="space-y-2">
          <h3 className="font-semibold">Shipping address</h3>
          <div className="stripe-element-wrapper">
            <AddressElement
              options={{
                mode: "shipping",
                fields: { phone: "never" },
              }}
              onChange={(e) => {
                if (e.complete && e.value) {
                  const { name, address } = e.value;
                  setShipping({ name, address });
                }
              }}
            />
          </div>
        </div>

        {/* PAYMENT */}
        <div>
          <h3 className="font-semibold mb-2">Payment details</h3>
          <div className="stripe-element-wrapper">
            <PaymentElement
              options={{
                layout: {
                  type: "accordion",
                  defaultCollapsed: false,
                },
              }}
            />
          </div>
        </div>

        {total !== null && (
          <div className="text-lg font-bold" aria-live="polite">
            Total: ${total.toFixed(2)}
          </div>
        )}

        <button
          ref={submitButtonRef}
          type="submit"
          disabled={loading || !stripe || !email.trim()}
          className="w-full py-3 rounded-lg font-semibold mb-3
                     bg-stone-800 border border-stone-600 text-stone-100
                     hover:bg-stone-700 transition-colors
                     focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand
                     disabled:opacity-50 disabled:cursor-not-allowed"
          aria-live="polite"
        >
          {loading ? "Processing…" : "Pay Now"}
        </button>

        <p className="text-xs text-stone-400 text-center pb-4">
          By placing your order, you agree to Zen&nbsp;Essentials'&nbsp;
          <a
            href="/privacy"
            className="underline focus:ring-2 focus:ring-brand focus:outline-none"
          >
            Privacy&nbsp;Notice
          </a>
          ,&nbsp;
          <a
            href="/returns"
            className="underline focus:ring-2 focus:ring-brand focus:outline-none"
          >
            Returns&nbsp;Policy
          </a>
          &nbsp;and&nbsp;
          <a
            href="/terms-and-conditions"
            className="underline focus:ring-2 focus:ring-brand focus:outline-none"
          >
            Terms&nbsp;&amp;&nbsp;Conditions
          </a>
          .
        </p>
      </form>

      {/* Simple styles for focus visibility */}
      <style>
        {`
          /* Remove all default browser focus styles */
          [role="dialog"] *:focus {
            outline: none !important;
            box-shadow: none !important;
          }
          
          /* Custom focus styles for form elements using brand color */
          [role="dialog"] input:focus {
            border-color: var(--color-brand-400) !important;
            outline: none !important;
            box-shadow: 0 0 0 2px var(--color-brand-400) !important;
          }
          
          [role="dialog"] button:focus {
            outline: none !important;
            box-shadow: 0 0 0 2px var(--color-brand-400) !important;
          }
          
          [role="dialog"] a:focus {
            outline: none !important;
            box-shadow: 0 0 0 2px var(--color-brand-400) !important;
          }
          
          [role="dialog"] input[type="checkbox"]:focus {
            outline: none !important;
            box-shadow: 0 0 0 2px var(--color-brand-400) !important;
          }
          
          .stripe-element-wrapper:focus-within {
            outline: 2px solid var(--color-brand-400);
            border-radius: 4px;
          }
          
          /* Ensure Stripe iframes are properly contained */
          .stripe-element-wrapper iframe {
            max-width: 100%;
          }
          
          /* Prevent focus from escaping the modal */
          [role="dialog"] {
            isolation: isolate;
          }
          
          /* Ensure proper tab order within Stripe elements */
          .stripe-element-wrapper {
            position: relative;
            z-index: 1;
          }
        `}
      </style>
    </div>
  );
}
