/**
 * Pure bill payment calculation functions.
 * Extracted from BillPayments.jsx so they can be unit-tested independently.
 * These are the authoritative implementations — BillPayments imports from here.
 */

// Points: up to 50% of charge, minimum 50 pts balance to redeem
export function calcPointsDiscount({ chargeAmount, pointsBalance, usePoints, pointsEnabled }) {
  if (!pointsEnabled || !usePoints || pointsBalance < 50) return 0;
  return Math.min(pointsBalance, Math.floor(chargeAmount * 0.5));
}

// Cashback: apply full balance up to (charge - pointsDiscount - 1).
// The -1 ensures cashback ALONE never reduces the amount to ₦0 — a coupon
// is required for a fully free transaction, protecting Paystack from a ₦0 charge.
export function calcCashbackDiscount({ chargeAmount, cashbackBalance, useCashback, pointsDiscount }) {
  if (!useCashback || cashbackBalance <= 0) return 0;
  return Math.min(cashbackBalance, Math.max(0, chargeAmount - pointsDiscount - 1));
}

// Coupon: percentage or fixed, gated by min_amount and applies_to scope.
// Percentage is applied to the ORIGINAL chargeAmount; fixed is capped at afterDiscounts.
export function calcCouponDiscount({ chargeAmount, coupon, afterDiscounts }) {
  if (!coupon || afterDiscounts <= 0) return 0;
  const scope = coupon.applies_to || [];
  if (scope.length > 0 && !scope.includes("bills")) return 0;
  if (chargeAmount < (coupon.min_amount || 0)) return 0;
  if (coupon.type === "percentage") {
    return Math.round(chargeAmount * coupon.value / 100 * 100) / 100;
  }
  return Math.min(coupon.value, afterDiscounts);
}

// Compose all three discount layers and return the final payment amount.
export function calcBillAmounts({
  chargeAmount,
  pointsBalance, usePoints, pointsEnabled,
  cashbackBalance, useCashback,
  coupon,
}) {
  const pointsDiscount   = calcPointsDiscount({ chargeAmount, pointsBalance, usePoints, pointsEnabled });
  const cashbackDiscount = calcCashbackDiscount({ chargeAmount, cashbackBalance, useCashback, pointsDiscount });
  const afterDiscounts   = chargeAmount - pointsDiscount - cashbackDiscount;
  const couponDiscount   = calcCouponDiscount({ chargeAmount, coupon, afterDiscounts });
  const finalAmount      = Math.max(0, afterDiscounts - couponDiscount);
  return { pointsDiscount, cashbackDiscount, couponDiscount, afterDiscounts, finalAmount, isFree: finalAmount === 0 };
}
