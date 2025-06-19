import {
  useStripe,
  useElements,
  PaymentElement,
  AddressElement,
} from "@stripe/react-stripe-js";
import { useState, useEffect, FormEvent, useRef, useLayoutEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useCart } from "../context/CartContext";
import { IoClose } from "react-icons/io5";

interface Props {
  clientSecret: string;
  email: string;
  setEmail: (email: string) => void;
  setShipping: (info: any) => void;
  setNewsletter: (on: boolean) => void;
  onRequestClose: (
    reason?: "shift-tab" | "escape" | "tab-out" | "click"
  ) => void;
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
  const [addressComplete, setAddressComplete] = useState(false);
  const [paymentComplete, setPaymentComplete] = useState(false);
  const [isFirstTab, setIsFirstTab] = useState(true);
  const formRef = useRef<HTMLFormElement | null>(null);
  const submitButtonRef = useRef<HTMLButtonElement | null>(null);

  // Check if form is complete
  const isFormComplete =
    !!stripe && email.trim() !== "" && addressComplete && paymentComplete; // force boolean

  // Remove focus from page elements when modal opens, but don't auto-focus anything
  useLayoutEffect(() => {
    // Blur any currently focused element on the page
    if (document.activeElement && document.activeElement !== document.body) {
      (document.activeElement as HTMLElement).blur();
    }

    // Don't auto-focus anything - let the user tab to start navigation
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
  }, [clientSecret]); // Simplified focus handling
  useEffect(() => {
    if (!onRequestClose) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Handle Escape key
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onRequestClose("escape");
        return;
      }

      // Handle first tab press from anywhere
      if (e.key === "Tab" && isFirstTab) {
        e.preventDefault();
        setIsFirstTab(false);

        const modalContainer =
          formRef.current?.closest('[role="dialog"]') ||
          formRef.current?.parentElement;

        if (modalContainer) {
          const closeButton = modalContainer.querySelector<HTMLElement>(
            '[aria-label="Close checkout form"]'
          );
          closeButton?.focus();
        }
        return;
      }
    };

    // Use non-capturing listener to avoid interfering with normal tab flow
    document.addEventListener("keydown", handleKeyDown, false);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, false);
    };
  }, [onRequestClose, isFirstTab]);

  // Separate effect for handling focus boundaries on the close button specifically
  useEffect(() => {
    if (!onRequestClose) return;

    const handleCloseButtonKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Tab" && e.shiftKey) {
        // Shift+Tab from close button - close modal
        e.preventDefault();
        e.stopPropagation();
        onRequestClose("shift-tab");
      }
    };

    const modalContainer =
      formRef.current?.closest('[role="dialog"]') ||
      formRef.current?.parentElement;

    if (modalContainer) {
      const closeButton = modalContainer.querySelector<HTMLElement>(
        '[aria-label="Close checkout form"]'
      );

      if (closeButton) {
        closeButton.addEventListener("keydown", handleCloseButtonKeyDown);

        return () => {
          closeButton.removeEventListener("keydown", handleCloseButtonKeyDown);
        };
      }
    }
  }, [onRequestClose]);

  // Handle tab from last element to close modal
  useEffect(() => {
    if (!onRequestClose) return;

    const handleLastElementTab = (e: KeyboardEvent) => {
      if (e.key === "Tab" && !e.shiftKey) {
        // Tab from last element - close modal
        e.preventDefault();
        e.stopPropagation();
        onRequestClose("tab-out");
      }
    };

    // Add listener to all the Terms links
    const termsLinks = formRef.current?.querySelectorAll(
      'a[href^="/terms"], a[href^="/privacy"], a[href^="/returns"]'
    );

    if (termsLinks) {
      const lastLink = termsLinks[termsLinks.length - 1] as HTMLElement;
      if (lastLink) {
        lastLink.addEventListener("keydown", handleLastElementTab);

        return () => {
          lastLink.removeEventListener("keydown", handleLastElementTab);
        };
      }
    }
  }, [onRequestClose]);

  // Handle clicks outside the form (on backdrop)
  useEffect(() => {
    if (!onRequestClose) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (!formRef.current) return;
      // close only when the direct backdrop itself is clicked
      if (
        e.target instanceof HTMLElement &&
        e.target.hasAttribute("data-backdrop")
      ) {
        onRequestClose("click");
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
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
    <div
      data-backdrop
      className="fixed inset-0 z-40 flex items-center justify-center p-4
                 bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && onRequestClose)
          onRequestClose("click");
      }}
    >
      <div className="checkout-card relative">
        <button
          onClick={() => onRequestClose("click")}
          className="relative top-3 right-3 text-2xl bg-[transparent_!important] border-[transparent_!important] shadow-[inset_0px_0px_0px_transparent_!important] hover:text-stone-300"
          aria-label="Close checkout form"
          tabIndex={0}
        >
          <IoClose />
        </button>
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
              /* 👇 add utility */
              className="aligned-field w-full rounded-lg px-3 h-11
                          text-stone-100 placeholder-stone-400
                          focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand
                          transition-colors"
              style={{
                backgroundColor: "rgb(39, 39, 42)", // Match Stripe --colorBackground
                border: "1px solid rgb(60, 60, 64)", // Match Stripe border
                boxShadow:
                  "0px 2px 4px rgba(0, 0, 0, 0.5), 0px 1px 6px rgba(0, 0, 0, 0.25)", // Match Stripe shadow
              }}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-required="true"
            />

            <div className="flex items-center gap-2 text-sm mt-2">
              <div className="relative custom-checkbox">
                <input
                  id="newsletter"
                  type="checkbox"
                  checked={newsletter}
                  onChange={(e) => {
                    setLocalNewsletter(e.target.checked);
                    setNewsletter(e.target.checked);
                  }}
                  className="sr-only"
                  tabIndex={-1}
                  aria-labelledby="newsletter-label"
                />
                <div
                  className={`w-5 h-5 rounded border transition-all duration-150 ease-in-out cursor-pointer ${
                    newsletter ? "border-brand" : "border-gray-500"
                  }`}
                  style={{
                    backgroundColor: newsletter
                      ? "var(--color-brand-400)"
                      : "rgb(39, 39, 42)",
                    borderColor: newsletter
                      ? "var(--color-brand-400)"
                      : "rgb(60, 60, 64)",
                    boxShadow:
                      "0px 2px 4px rgba(0, 0, 0, 0.5), 0px 1px 6px rgba(0, 0, 0, 0.25)",
                  }}
                  tabIndex={0}
                  role="checkbox"
                  aria-checked={newsletter}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setLocalNewsletter(!newsletter);
                      setNewsletter(!newsletter);
                    }
                  }}
                  onClick={() => {
                    setLocalNewsletter(!newsletter);
                    setNewsletter(!newsletter);
                  }}
                >
                  {newsletter && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <svg
                        className="w-3 h-3 text-stone-900"
                        viewBox="0 0 11 11"
                        fill="none"
                      >
                        <path
                          d="M2 5.5L4.5 8L9 3.5"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                  )}
                </div>
              </div>
              <label
                id="newsletter-label"
                htmlFor="newsletter"
                className="cursor-pointer"
              >
                Subscribe to our newsletter
              </label>
            </div>
          </div>

          {/* ADDRESS */}
          <div className="space-y-2">
            <h3 className="font-semibold">Shipping address</h3>
            <div className="stripe-element-wrapper aligned-field">
              <AddressElement
                options={{
                  mode: "shipping",
                  fields: { phone: "never" },
                }}
                onChange={(e) => {
                  setAddressComplete(e.complete);
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
            <div className="stripe-element-wrapper aligned-field">
              <PaymentElement
                options={{
                  layout: {
                    type: "accordion",
                    defaultCollapsed: false,
                  },
                }}
                onChange={(e) => {
                  setPaymentComplete(e.complete);
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
            /* 👇 add utility */
            className="aligned-field w-full py-3 rounded-lg font-semibold mb-3
                       text-stone-100
                       hover:opacity-90 transition-all duration-150
                       focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand
                       disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              backgroundColor:
                loading || !isFormComplete
                  ? "rgb(30, 30, 31)"
                  : "rgb(39, 39, 42)",
              border: "1px solid rgb(60, 60, 64)",
              boxShadow:
                "0px 2px 4px rgba(0, 0, 0, 0.5), 0px 1px 6px rgba(0, 0, 0, 0.25)",
            }}
            disabled={loading || !isFormComplete}
            aria-disabled={loading || !isFormComplete}
            aria-live="polite"
          >
            {loading ? "Processing…" : "Pay Now"}
          </button>

          {/* Disclaimer */}
          <p className="aligned-field text-xs text-stone-400 text-center pb-4">
            By placing your order, you agree to Zen&nbsp;Essentials'{" "}
            <a
              href="/privacy"
              className="underline focus:ring-2 focus:ring-brand focus:outline-none"
            >
              Privacy&nbsp;Notice
            </a>
            ,{" "}
            <a
              href="/returns"
              className="underline focus:ring-2 focus:ring-brand focus:outline-none"
            >
              Returns&nbsp;Policy
            </a>{" "}
            and{" "}
            <a
              href="/terms-and-conditions"
              className="underline focus:ring-2 focus:ring-brand focus:outline-none"
            >
              Terms&nbsp;&amp;&nbsp;Conditions
            </a>
            .
          </p>
        </form>
        {/* Simple styles for focus visibility + layout fixes */}
        <style>
          {`
            /* ---------- CARD ---------- */
            .checkout-card{
              background: linear-gradient(140deg,#262628 0%,#1f1f21 100%);
              border: 1px solid rgba(255,255,255,0.06);
              border-radius: 0.75rem;
              padding: 2rem 1.75rem;          /*   32 × 28 */
              max-width: 440px;               /* a bit narrower */
              width: 100%;
              max-height: calc(100vh - 6rem);
              overflow-y: auto;
              /* Hide scrollbar (cross-browser) */
              -ms-overflow-style: none;   /* IE & Edge */
              scrollbar-width: none;      /* Firefox */
            }
            /* Chrome, Safari & Opera */
            .checkout-card::-webkit-scrollbar{ display:none; }

            /* ---------- WIDTH / ALIGNMENT ---------- */
            /* Keep the 4 px left offset but shrink the row 8 px to match Stripe width */
            .checkout-card .aligned-field:not(.stripe-element-wrapper){
              margin-left:4px !important;             /* left edges already match */
              width:calc(100% - 8px) !important;      /* pull right edge in by 4 px */
            }

            /* keep inner elements full-width inside their own box */
            .checkout-card .aligned-field input,
            .checkout-card .aligned-field button,
            .checkout-card .aligned-field p{
              width:100%!important;
              box-sizing:border-box;
            }

            /* ---------- EMAIL SHADOW RESTORE ---------- */
            #email{
              box-shadow:0px 2px 4px rgba(0,0,0,0.5),
                         0px 1px 6px rgba(0,0,0,0.25)!important;
            }

            /* ---------- EMAIL BACKGROUND CONSISTENCY ---------- */
            #email,
            #email:hover,
            #email:focus,
            #email:active{
              background-color:rgb(39,39,42)!important;
            }
            /* Autofill (Chrome/Safari) */
            #email:-webkit-autofill,
            #email:-webkit-autofill:hover,
            #email:-webkit-autofill:focus,
            #email:-webkit-autofill:active{
              -webkit-box-shadow:0 0 0 1000px rgb(39,39,42) inset!important;
              -webkit-text-fill-color:rgb(245,245,244)!important;
              caret-color:rgb(245,245,244)!important;
            }
            /* Autofill (Firefox) */
            #email:-moz-autofill{
              background-color:rgb(39,39,42)!important;
              color:rgb(245,245,244)!important;
            }

            /* ---------- ORIGINAL RULES (unchanged) ---------- */
            .checkout-card [aria-label="Close checkout form"]{
              position:absolute;
              top:0.75rem;              
              right:0.75rem;            
              width:2rem; height:2rem;
-              line-height:2rem;           /* ⬅ remove so flex can truly center */
+              line-height:1;              /* neutral value – flex handles centering */
              border-radius:9999px;
              background:transparent;
              color:#f5f5f4;
              font-size:1.125rem;     
              text-align:center;
              border:none;
              box-shadow:none;               
              cursor:pointer;


              display:flex;               
              flex-direction:column;
              align-items:center;
              justify-content:center;
              padding:0;                  
              font-size:1.25rem;          
            }
            .checkout-card [aria-label="Close checkout form"]:hover{
              background:#4b4b51;
            }
            .checkout-card [aria-label="Close checkout form"]:focus{
              outline:none;
              box-shadow:0 0 0 2px var(--color-brand-400);
            }

            /* ---------- STRIPE IFRAME NORMALISATION ---------- */
            .stripe-element-wrapper iframe{
              width:100%!important;
              margin:0!important;
              display:block;
            }

            /* ---------- KEEP NEIGHBOURING CONTROLS ALIGNED ---------- */
            .stripe-element-wrapper,
            .stripe-element-wrapper input,
            .stripe-element-wrapper button,
            .stripe-element-wrapper p{
              width:100%!important;
              box-sizing:border-box;
            }

            /* OVERFLOW FIX FOR ADDRESS / PAYMENT INNER SHADOWS */
            .stripe-element-wrapper{
              overflow:hidden;
            }

            /* ---------- EXISTING FOCUS / AUTOFILL RULES ---------- */
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
            
            /* Custom checkbox focus */
            [role="dialog"] .custom-checkbox:focus-within {
              outline: 2px solid var(--color-brand-400) !important;
              outline-offset: 2px !important;
              border-radius: 2px !important;
            }
            
            /* Fix autofill styling */
            [role="dialog"] input:-webkit-autofill,
            [role="dialog"] input:-webkit-autofill:hover,
            [role="dialog"] input:-webkit-autofill:active {
              -webkit-box-shadow: 0 0 0 30px rgb(39, 39, 42) inset !important;
              -webkit-text-fill-color: rgb(245, 245, 244) !important;
              caret-color: rgb(245, 245, 244) !important;
              border: 1px solid rgb(60, 60, 64) !important;
            }
            
            /* Autofill focus state - ensure focus outline works */
            [role="dialog"] input:-webkit-autofill:focus {
              -webkit-box-shadow: 0 0 0 30px rgb(39, 39, 42) inset, 0 0 0 2px var(--color-brand-400) !important;
              -webkit-text-fill-color: rgb(245, 245, 244) !important;
              caret-color: rgb(245, 245, 244) !important;
              border-color: var(--color-brand-400) !important;
            }
            
            /* Firefox autofill */
            [role="dialog"] input:-moz-autofill {
              background-color: rgb(39, 39, 42) !important;
              color: rgb(245, 245, 244) !important;
              border: 1px solid rgb(60, 60, 64) !important;
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

            /* ---------- FORCE IDENTICAL ROW WIDTH ---------- */
            :root{ --stripe-row-max:432px; }
            .aligned-field,
            .stripe-element-wrapper{
              display:block;
              width:100%;
              max-width:var(--stripe-row-max);
              margin-inline:auto;
            }
            /* ensure inner custom controls obey the wrapper width */
            .aligned-field input,
            .aligned-field button{
              width:100%!important;
              box-sizing:border-box;
            }
          `}
        </style>
      </div>
    </div>
  );
}
