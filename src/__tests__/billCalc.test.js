import {
  calcPointsDiscount,
  calcCashbackDiscount,
  calcCouponDiscount,
  calcBillAmounts,
} from "../utils/billCalc";

// ── calcPointsDiscount ──────────────────────────────────────────────────────
describe("calcPointsDiscount", () => {
  it("returns 0 when pointsEnabled is false", () => {
    expect(calcPointsDiscount({ chargeAmount: 1000, pointsBalance: 500, usePoints: true, pointsEnabled: false })).toBe(0);
  });
  it("returns 0 when usePoints is unchecked", () => {
    expect(calcPointsDiscount({ chargeAmount: 1000, pointsBalance: 500, usePoints: false, pointsEnabled: true })).toBe(0);
  });
  it("returns 0 when balance is below 50 pt minimum", () => {
    expect(calcPointsDiscount({ chargeAmount: 1000, pointsBalance: 49, usePoints: true, pointsEnabled: true })).toBe(0);
  });
  it("caps at exactly 50% of charge when balance is large", () => {
    expect(calcPointsDiscount({ chargeAmount: 1000, pointsBalance: 800, usePoints: true, pointsEnabled: true })).toBe(500);
  });
  it("uses floor() so fractions never round up", () => {
    // 50% of 999 = 499.5 → floor → 499
    expect(calcPointsDiscount({ chargeAmount: 999, pointsBalance: 999, usePoints: true, pointsEnabled: true })).toBe(499);
  });
  it("caps at points balance when balance is less than 50% of charge", () => {
    expect(calcPointsDiscount({ chargeAmount: 2000, pointsBalance: 300, usePoints: true, pointsEnabled: true })).toBe(300);
  });
});

// ── calcCashbackDiscount ────────────────────────────────────────────────────
describe("calcCashbackDiscount", () => {
  it("returns 0 when useCashback is false", () => {
    expect(calcCashbackDiscount({ chargeAmount: 1000, cashbackBalance: 500, useCashback: false, pointsDiscount: 0 })).toBe(0);
  });
  it("returns 0 when cashback balance is 0", () => {
    expect(calcCashbackDiscount({ chargeAmount: 1000, cashbackBalance: 0, useCashback: true, pointsDiscount: 0 })).toBe(0);
  });
  it("never reduces amount to exactly ₦0 on its own — always leaves ₦1 for Paystack", () => {
    const discount = calcCashbackDiscount({ chargeAmount: 1000, cashbackBalance: 10000, useCashback: true, pointsDiscount: 0 });
    expect(discount).toBe(999);
    // chargeAmount - discount should be 1, not 0
    expect(1000 - discount).toBe(1);
  });
  it("is capped at cashback balance when balance is smaller than max allowable", () => {
    expect(calcCashbackDiscount({ chargeAmount: 5000, cashbackBalance: 200, useCashback: true, pointsDiscount: 0 })).toBe(200);
  });
  it("accounts for points already deducted when computing its own ceiling", () => {
    // charge=1000, pointsDiscount=300 → cashback ceiling = 1000-300-1 = 699
    expect(calcCashbackDiscount({ chargeAmount: 1000, cashbackBalance: 1000, useCashback: true, pointsDiscount: 300 })).toBe(699);
  });
});

// ── calcCouponDiscount ──────────────────────────────────────────────────────
describe("calcCouponDiscount", () => {
  it("returns 0 with no coupon", () => {
    expect(calcCouponDiscount({ chargeAmount: 1000, coupon: null, afterDiscounts: 1000 })).toBe(0);
  });
  it("returns 0 when afterDiscounts is already 0", () => {
    const coupon = { type: "percentage", value: 100, applies_to: ["bills"] };
    expect(calcCouponDiscount({ chargeAmount: 1000, coupon, afterDiscounts: 0 })).toBe(0);
  });
  it("percentage coupon applies to ORIGINAL chargeAmount, not afterDiscounts", () => {
    // This is intentional: a 10% coupon on ₦1000 is always ₦100, regardless of other discounts
    const coupon = { type: "percentage", value: 10, applies_to: ["bills"] };
    expect(calcCouponDiscount({ chargeAmount: 1000, coupon, afterDiscounts: 800 })).toBe(100);
  });
  it("percentage coupon: 100% makes it fully free", () => {
    const coupon = { type: "percentage", value: 100, applies_to: ["bills"] };
    expect(calcCouponDiscount({ chargeAmount: 1000, coupon, afterDiscounts: 1000 })).toBe(1000);
  });
  it("fixed coupon deducts flat amount", () => {
    const coupon = { type: "fixed", value: 250, applies_to: ["bills"] };
    expect(calcCouponDiscount({ chargeAmount: 1000, coupon, afterDiscounts: 1000 })).toBe(250);
  });
  it("fixed coupon is capped at afterDiscounts (cannot create negative balance)", () => {
    const coupon = { type: "fixed", value: 5000, applies_to: ["bills"] };
    expect(calcCouponDiscount({ chargeAmount: 1000, coupon, afterDiscounts: 400 })).toBe(400);
  });
  it("skips coupon when charge is below min_amount", () => {
    const coupon = { type: "fixed", value: 200, min_amount: 2000, applies_to: ["bills"] };
    expect(calcCouponDiscount({ chargeAmount: 1000, coupon, afterDiscounts: 1000 })).toBe(0);
  });
  it("applies coupon when charge equals min_amount", () => {
    const coupon = { type: "fixed", value: 200, min_amount: 1000, applies_to: ["bills"] };
    expect(calcCouponDiscount({ chargeAmount: 1000, coupon, afterDiscounts: 1000 })).toBe(200);
  });
  it("skips coupon scoped to a plan, not bills", () => {
    const coupon = { type: "percentage", value: 20, applies_to: ["naira"] };
    expect(calcCouponDiscount({ chargeAmount: 1000, coupon, afterDiscounts: 1000 })).toBe(0);
  });
  it("applies coupon with empty applies_to (universal coupon)", () => {
    const coupon = { type: "percentage", value: 50, applies_to: [] };
    expect(calcCouponDiscount({ chargeAmount: 1000, coupon, afterDiscounts: 1000 })).toBe(500);
  });
  it("applies coupon with undefined applies_to (universal coupon)", () => {
    const coupon = { type: "fixed", value: 100 };
    expect(calcCouponDiscount({ chargeAmount: 1000, coupon, afterDiscounts: 1000 })).toBe(100);
  });
});

// ── calcBillAmounts — full composition ─────────────────────────────────────
describe("calcBillAmounts", () => {
  const base = {
    chargeAmount: 1000,
    pointsBalance: 0, usePoints: false, pointsEnabled: true,
    cashbackBalance: 0, useCashback: false,
    coupon: null,
  };

  it("no discounts: finalAmount equals chargeAmount", () => {
    const { finalAmount, isFree } = calcBillAmounts(base);
    expect(finalAmount).toBe(1000);
    expect(isFree).toBe(false);
  });

  it("100% coupon: finalAmount is 0 and isFree is true", () => {
    const coupon = { type: "percentage", value: 100, applies_to: ["bills"] };
    const { finalAmount, isFree } = calcBillAmounts({ ...base, coupon });
    expect(finalAmount).toBe(0);
    expect(isFree).toBe(true);
  });

  it("cashback alone NEVER makes isFree true — ₦1 always remains", () => {
    const { finalAmount, isFree } = calcBillAmounts({ ...base, cashbackBalance: 10000, useCashback: true });
    expect(finalAmount).toBe(1);
    expect(isFree).toBe(false);
  });

  it("fixed coupon + cashback can make it fully free when coupon covers the ₦1 remainder", () => {
    // cashback brings to ₦1, then a fixed ₦1 coupon brings to ₦0
    const coupon = { type: "fixed", value: 1, applies_to: ["bills"] };
    const { finalAmount, isFree } = calcBillAmounts({ ...base, cashbackBalance: 10000, useCashback: true, coupon });
    expect(finalAmount).toBe(0);
    expect(isFree).toBe(true);
  });

  it("stacked discounts: points + cashback + fixed coupon all applied correctly", () => {
    // chargeAmount=1000
    // pointsDiscount = min(200, floor(1000*0.5)) = 200
    // cashbackDiscount = min(700, max(0, 1000-200-1)) = min(700,799) = 700
    // afterDiscounts = 1000-200-700 = 100
    // couponDiscount = min(50, 100) = 50 (fixed)
    // finalAmount = 100-50 = 50
    const coupon = { type: "fixed", value: 50, applies_to: ["bills"] };
    const result = calcBillAmounts({
      ...base,
      pointsBalance: 200, usePoints: true,
      cashbackBalance: 700, useCashback: true,
      coupon,
    });
    expect(result.pointsDiscount).toBe(200);
    expect(result.cashbackDiscount).toBe(700);
    expect(result.couponDiscount).toBe(50);
    expect(result.finalAmount).toBe(50);
    expect(result.isFree).toBe(false);
  });

  it("points only: respects 50% cap", () => {
    const { pointsDiscount, finalAmount } = calcBillAmounts({
      ...base, pointsBalance: 800, usePoints: true,
    });
    expect(pointsDiscount).toBe(500);
    expect(finalAmount).toBe(500);
  });
});
