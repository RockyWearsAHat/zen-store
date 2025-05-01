export const TAX_RATE = 0.07; // 7 % flat state tax
export const STRIPE_FEE_RATE = 0.03; // 3 % (we’re padding to cover fees)
export const STRIPE_FEE_FLAT = 0.3; // $0.30

// returns cents for Stripe (whole numbers only)
export function calculateOrderAmount(subtotal: number) {
  const tax = subtotal * TAX_RATE;
  const fee = (subtotal + tax) * STRIPE_FEE_RATE + STRIPE_FEE_FLAT;
  const total = Math.round((subtotal + tax + fee) * 100);
  return { tax, fee, total }; // tax & fee are still dollars
}
