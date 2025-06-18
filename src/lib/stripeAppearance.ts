/* Shared Stripe appearance matching the site's dark theme */
import type { Appearance } from "@stripe/stripe-js";

/* stone palette taken from index.css – hex equivalents */
const stone100 = "#f5f5f4"; // --color-stone-100
const stone600 = "#52525b"; // --color-stone-600
const stone800 = "#27272a"; // --color-stone-800
const brand400 = "#d2b277"; // --color-brand-400 (accent beige)

export const stripeAppearance: Appearance = {
  theme: "night",
  variables: {
    colorPrimary: brand400,
    colorBackground: stone800,
    colorText: stone100,
    colorTextSecondary: stone100,
    colorDanger: "#f87171",
    borderRadius: "8px",
    fontFamily: "system-ui,Segoe UI,Roboto,sans-serif",
  },
  rules: {
    ".Input, .Select, .Block": {
      backgroundColor: stone800,
      color: stone100,
      borderColor: stone600,
    },
    ".Input:focus, .Select:focus, .Block:focus, .Input--focus, .Select--focus, .Block--focus":
      {
        backgroundColor: stone800,
        borderColor: brand400, // match focus ring of email input
        boxShadow: `0 0 0 2px ${brand400}`,
      },
    ".Tab, .PaymentMethodItem, .BlockButton--primary": {
      backgroundColor: stone800,
      color: stone100,
      borderColor: stone600,
    },
    ".Tab:hover, .PaymentMethodItem:hover, .BlockButton--primary:hover": {
      backgroundColor: "#3f3f46", // stone-700 hover
    },
  },
};

// Add this helper function to configure Stripe Elements with correct types
export const getStripeElementOptions = (type: "payment" | "address") => {
  if (type === "payment") {
    return {
      layout: {
        type: "accordion" as const,
        defaultCollapsed: false,
      },
    };
  }

  if (type === "address") {
    return {
      mode: "shipping" as const,
      fields: { phone: "never" as const },
    };
  }

  return {};
};
//     /* --- generic <select> styling ------------------------------------- */
//     ".Select, .Select:focus, .Select--focus": {
//       backgroundColor: "#d2b277",
//       color: "#1c1917",
//     },

//     /* --- AddressElement dropdown -------------------------------------- */
//     ".AddressAutocompleteMenu, .AutocompleteMenu": {
//       backgroundColor: "#d2b277 !important",
//       border: "1px solid #c4a46d !important",
//     },
//     ".AddressAutocompleteItem, .AutocompleteItem": {
//       backgroundColor: "#d2b277",
//       color: "#1c1917",
//     },
//     ".AddressAutocompleteItem--highlighted, .AutocompleteItem--highlighted": {
//       backgroundColor: "#c4a46d !important",
//       color: "#1c1917 !important",
//     },

//     /* --- Link Authentication Element ---------------------------------- */
//     ".LinkAuthenticationElement .Input": {
//       backgroundColor: "#d2b277",
//       color: "#1c1917",
//     },
//     ".LinkAuthenticationElement .Button": {
//       backgroundColor: "#1c1917",
//       color: "#d2b277",
//     },
//     ".LinkAuthenticationElement .Button:hover": {
//       backgroundColor: "#0f0f0f",
//     },

//     /* --- force Link logo → green -------------------------------------- */
//     ".PaymentMethodItem--link .TabIcon *, \
//      .PaymentMethodItem--link svg *": {
//       fill: "#22c55e",
//       color: "#22c55e",
//     },

//     /* keep the rest of the existing custom overrides */
//     ".Block": { backgroundColor: "#d2b277" },
//     ".Block:hover": { backgroundColor: "#d2b277" },

//     ".Label": { color: "#1c1917" },

//     ".BlockButton--primary": {
//       backgroundColor: "#d2b277",
//       color: "#1c1917",
//     },
//     ".BlockButton--primary:hover": { backgroundColor: "#c4a46d" },

//     /* ── hide default 'Select' placeholder in dropdowns ────── */
//     ".SelectPlaceholder": { color: "transparent !important" },

//     /* ── disabled / summary states (Link logged-in) ─────────────────── */
//     ".Input--disabled, .Input[disabled], .Input[aria-disabled='true'], \
//      .Select--disabled, .Select[disabled], .Select[aria-disabled='true'], \
//      .Block--disabled, .Block[aria-disabled='true']": {
//       backgroundColor: "#d2b277",
//       color: "#1c1917",
//     },

//     /* summary rows shown after Link authentication */
//     ".Summary, .SummaryItem, .SummaryItem:hover": {
//       backgroundColor: "#d2b277",
//       color: "#1c1917",
//     },

//     /* ── card / wallet picker inside Link & Payment Element ───────────── */
//     ".PaymentMethodItem, \
//      .PaymentMethodItem:hover, \
//      .PaymentMethodItem--selected, \
//      .PaymentMethodItem--selected:hover": {
//       backgroundColor: "#d2b277",
//       color: "#1c1917",
//     },

//     /* ── one-line address summary shown after Link login ──────────────── */
//     ".AddressLineSummary, \
//      .AddressLineSummary:hover, \
//      .AddressLineSummary--selected": {
//       backgroundColor: "#d2b277",
//       color: "#1c1917",
//     },

//     ".MenuIcon": {
//       fill: "#1fff31", // green
//     },

//     ".p-Menu-linkLogo": {
//       fill: "#1fff31 !important", // green
//       color: "#1fff31 !important", // green
//     },
//   },
// };
