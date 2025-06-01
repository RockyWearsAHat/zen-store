/* Shared Stripe appearance matching the site’s dark theme */
import type { Appearance } from "@stripe/stripe-js";

export const stripeAppearance: Appearance = {
  // 1️⃣ base dark theme
  theme: "night",
  // 2️⃣ optional floating labels (nice with dark inputs)
  labels: "floating",

  // 3️⃣ design-tokens → Stripe “variables”
  variables: {
    /* palette */
    colorPrimary: "#d2b277",
    colorBackground: "#18181b",
    /* text now dark for proper contrast on beige backgrounds */
    colorText: "#1c1917",
    colorTextSecondary: "#1c1917",
    colorDanger: "#f87171",
    /* UX tweaks */
    fontSizeBase: "16px", // match site body size
    colorTextPlaceholder: "transparent", // hide “Select” in dropdowns

    iconColor: "#1fff31", // green

    /* typography / spacing */
    fontFamily: "system-ui,Segoe UI,Roboto,sans-serif",
    spacingUnit: "2px",
    borderRadius: "8px",

    /* --- input background tweaks ------------------------------------ */
    colorInputBackground: "#d2b277", // ‹ default tan
    colorInputAutofillBackground: "#d2b277",
    colorInputDisabledBackground: "#d2b277",
  } as any, // ‹ cast so TS stops complaining about the extra keys

  // 4️⃣ fine-tuning
  rules: {
    /* --- generic inputs ------------------------------------------------ */
    ".Input": {
      backgroundColor: "#d2b277",
      color: "#1c1917",
      borderColor: "transparent",
      outline: "none",
    },
    ".Input:focus, .Input--focus": {
      backgroundColor: "#d2b277",
      borderColor: "transparent",
      outline: "none",
    },

    /* --- payment-method / card selector Tabs --------------------------- */
    ".Tab": {
      /* unselected state */ backgroundColor: "#d2b277",
      color: "#1c1917",
    },
    ".Tab:hover": { backgroundColor: "#c4a46d" },
    ".Tab--selected": {
      color: "#1c1917",
      backgroundColor: "#d2b277",
    },

    /* --- generic <select> styling ------------------------------------- */
    ".Select, .Select:focus, .Select--focus": {
      backgroundColor: "#d2b277",
      color: "#1c1917",
    },

    /* --- AddressElement dropdown -------------------------------------- */
    ".AddressAutocompleteMenu, .AutocompleteMenu": {
      backgroundColor: "#d2b277 !important",
      border: "1px solid #c4a46d !important",
    },
    ".AddressAutocompleteItem, .AutocompleteItem": {
      backgroundColor: "#d2b277",
      color: "#1c1917",
    },
    ".AddressAutocompleteItem--highlighted, .AutocompleteItem--highlighted": {
      backgroundColor: "#c4a46d !important",
      color: "#1c1917 !important",
    },

    /* --- Link Authentication Element ---------------------------------- */
    ".LinkAuthenticationElement .Input": {
      backgroundColor: "#d2b277",
      color: "#1c1917",
    },
    ".LinkAuthenticationElement .Button": {
      backgroundColor: "#1c1917",
      color: "#d2b277",
    },
    ".LinkAuthenticationElement .Button:hover": {
      backgroundColor: "#0f0f0f",
    },

    /* --- force Link logo → green -------------------------------------- */
    ".PaymentMethodItem--link .TabIcon *, \
     .PaymentMethodItem--link svg *": {
      fill: "#22c55e",
      color: "#22c55e",
    },

    /* keep the rest of the existing custom overrides */
    ".Block": { backgroundColor: "#d2b277" },
    ".Block:hover": { backgroundColor: "#d2b277" },

    ".Label": { color: "#1c1917" },

    ".BlockButton--primary": {
      backgroundColor: "#d2b277",
      color: "#1c1917",
    },
    ".BlockButton--primary:hover": { backgroundColor: "#c4a46d" },

    /* ── hide default 'Select' placeholder in dropdowns ────── */
    ".SelectPlaceholder": { color: "transparent !important" },

    /* ── disabled / summary states (Link logged-in) ─────────────────── */
    ".Input--disabled, .Input[disabled], .Input[aria-disabled='true'], \
     .Select--disabled, .Select[disabled], .Select[aria-disabled='true'], \
     .Block--disabled, .Block[aria-disabled='true']": {
      backgroundColor: "#d2b277",
      color: "#1c1917",
    },

    /* summary rows shown after Link authentication */
    ".Summary, .SummaryItem, .SummaryItem:hover": {
      backgroundColor: "#d2b277",
      color: "#1c1917",
    },

    /* ── card / wallet picker inside Link & Payment Element ───────────── */
    ".PaymentMethodItem, \
     .PaymentMethodItem:hover, \
     .PaymentMethodItem--selected, \
     .PaymentMethodItem--selected:hover": {
      backgroundColor: "#d2b277",
      color: "#1c1917",
    },

    /* ── one-line address summary shown after Link login ──────────────── */
    ".AddressLineSummary, \
     .AddressLineSummary:hover, \
     .AddressLineSummary--selected": {
      backgroundColor: "#d2b277",
      color: "#1c1917",
    },

    ".MenuIcon": {
      fill: "#1fff31", // green
    },

    ".p-Menu-linkLogo": {
      fill: "#1fff31 !important", // green
      color: "#1fff31 !important", // green
    },
  },
};
