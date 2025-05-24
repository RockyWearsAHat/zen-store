/* Shared Stripe appearance matching the site’s dark theme */
import type { Appearance } from "@stripe/stripe-js";

export const stripeAppearance: Appearance = {
  // 1️⃣ base dark theme
  theme: "night",
  // 2️⃣ optional floating labels (nice with dark inputs)
  labels: "floating",

  // 3️⃣ design-tokens → Stripe “variables”
  variables: {
    /* palette – only keys allowed by Stripe’s typings */
    colorPrimary: "#d2b277",
    /* make every input’s *native* bg beige so autofill inherits it */
    colorBackground: "#ad9d7b",
    /* beige text on the dark slate */
    colorText: "#d2b277", // ≈ var(--color-brand-400)
    colorDanger: "#f87171",
    /* UX tweaks */
    fontSizeBase: "16px", // match site body size
    colorTextPlaceholder: "transparent", // hide “Select” in dropdowns

    /* typography / spacing */
    fontFamily: "system-ui,Segoe UI,Roboto,sans-serif",
    spacingUnit: "2px",
    borderRadius: "8px",

    /* --- input background tweaks --------------------------------------- */
    colorInputBackground: "#ad9d7b",
    colorInputAutofillBackground: "#ad9d7b",
  } as any, // ‹ cast so TS stops complaining about the extra keys

  // 4️⃣ fine-tuning
  rules: {
    /* lightweight overrides – variables above do most of the work */
    ".Input": {
      backgroundColor: "#ad9d7b",
      color: "#1c1917",
      borderColor: "#ffffff",
      outline: "none",
    },
    ".Input:focus, .Input--focus": {
      backgroundColor: "#c4a46d",
      borderColor: "transparent",
      outline: "none",
    },
    ".Block": { backgroundColor: "#ad9d7b" },
    ".Block:hover": { backgroundColor: "#c4a46d" },

    ".Label": { color: "#1c1917" },

    ".BlockButton--primary": {
      backgroundColor: "#d2b277",
      color: "#1c1917",
    },
    ".BlockButton--primary:hover": { backgroundColor: "#c4a46d" },
    "p-ReturnAutofillPrompt-emailText": { color: "#d2b277" },

    ".Tab--selected": {
      color: "#1c1917",
      backgroundColor: "#d2b277",
    },

    /* ── AddressElement suggestions ───────────────────────── */
    /* Stripe may emit either AddressAutocomplete* or generic Autocomplete* */
    ".AddressAutocompleteMenu, .AutocompleteMenu": {
      backgroundColor: "#18181b !important" /* force override */,
    },
    ".AddressAutocompleteItem, .AutocompleteItem": {
      color: "#d2b277 !important",
    },
    ".AddressAutocompleteItem--highlighted, .AutocompleteItem--highlighted": {
      backgroundColor: "#18181b !important",
      color: "#d2b277 !important",
    },

    /* ── mobile / desktop autofill inside Stripe iframe ───── */
    ".Input--autofill, .Input--autofilled, .Input--webkitAutofill, \
     .Input--autoFill, .Input:-webkit-autofill, .Input:-webkit-autofill:hover, \
     .Input:-webkit-autofill:focus, .Input:-webkit-autofill:active": {
      /* beige background + mask to hide white autofill flash */
      backgroundColor: "#ad9d7b",
      WebkitBoxShadow: "0 0 0 30px #ad9d7b inset !important",
    },
    /* ── Link (fast-checkout) logo & controls ──────────────── */
    ".LinkLogo, .LinkLogo svg, .LinkIcon": {
      filter: "none !important",
      color: "#00A37F !important" /* Link’s brand green */,
      fill: "#00A37F !important",
    },
    ".LinkAuthenticationElement .IconButton, \
     .LinkAuthenticationElement .OverflowMenuButton": {
      backgroundColor: "#18181b !important" /* match slate */,
      color: "#d2b277 !important",
    },

    /* ── hide default 'Select' placeholder in dropdowns ────── */
    ".SelectPlaceholder": { color: "transparent !important" },
  },
};
