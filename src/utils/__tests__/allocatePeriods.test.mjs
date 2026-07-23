import assert from "node:assert/strict";
import { allocatePeriods } from "../allocatePeriods.mjs";

// Helpers — past start so no period is "upcoming" and date logic doesn't interfere
const PAST = "2024-01-01";
const mkCycle = (overrides) => ({
  start_date:                   PAST,
  length_periods:               3,
  expected_amount_per_period:   5000,
  status:                       "completed",
  commission_model:             "none",
  frequency:                    "monthly",
  commission_balance:           0,
  ...overrides,
});
const contrib = (amount, type = "contribution", status = "completed") => ({
  id:     String(Math.random()),
  amount,
  type,
  status,
  reverses_contribution_id: null,
  created_at: "2024-01-15T12:00:00",
});

// ── Case 1: ₦15,000 → 3 fully paid periods ────────────────────────────────────
{
  const { periods, paidCount, progressPct } = allocatePeriods(mkCycle(), [contrib(15000)]);

  assert.equal(periods[0].paid,   5000,  "Case 1: period 0 paid");
  assert.equal(periods[1].paid,   5000,  "Case 1: period 1 paid");
  assert.equal(periods[2].paid,   5000,  "Case 1: period 2 paid");
  assert.equal(periods[0].status, "paid","Case 1: period 0 status");
  assert.equal(periods[1].status, "paid","Case 1: period 1 status");
  assert.equal(periods[2].status, "paid","Case 1: period 2 status");
  assert.equal(paidCount,   3,   "Case 1: paidCount");
  assert.equal(progressPct, 100, "Case 1: progressPct");
  console.log("PASS Case 1: ₦15,000 → 3 paid");
}

// ── Case 2: ₦12,000 → 2 paid + 1 partial (₦3,000 outstanding) ────────────────
{
  const { periods, paidCount } = allocatePeriods(mkCycle(), [contrib(12000)]);

  assert.equal(periods[0].paid,   5000,      "Case 2: period 0 paid");
  assert.equal(periods[1].paid,   5000,      "Case 2: period 1 paid");
  assert.equal(periods[2].paid,   2000,      "Case 2: period 2 partial amount");
  assert.equal(periods[0].status, "paid",    "Case 2: period 0 status");
  assert.equal(periods[1].status, "paid",    "Case 2: period 1 status");
  assert.equal(periods[2].status, "partial", "Case 2: period 2 status");
  assert.equal(paidCount, 2, "Case 2: paidCount");
  assert.equal(5000 - periods[2].paid, 3000, "Case 2: ₦3,000 outstanding");
  console.log("PASS Case 2: ₦12,000 → 2 paid + 1 partial (₦3,000 outstanding)");
}

// ── Case 3: two contributions ₦3,000 + ₦5,000 → period 0 paid, period 1 partial
{
  const { periods, paidCount } = allocatePeriods(mkCycle(), [contrib(3000), contrib(5000)]);

  // Net = 8,000: period 0 gets 5,000 (full), period 1 gets 3,000 (partial)
  assert.equal(periods[0].paid,   5000,      "Case 3: period 0 paid");
  assert.equal(periods[1].paid,   3000,      "Case 3: period 1 partial amount");
  assert.equal(periods[2].paid,   0,         "Case 3: period 2 not touched");
  assert.equal(periods[0].status, "paid",    "Case 3: period 0 status");
  assert.equal(periods[1].status, "partial", "Case 3: period 1 status");
  assert.equal(periods[2].status, "missed",  "Case 3: period 2 status");
  assert.equal(paidCount, 1, "Case 3: paidCount");
  console.log("PASS Case 3: ₦3,000 + ₦5,000 → period 0 paid, period 1 partial");
}

// ── Case 4: first_period commission excluded from client allocation ────────────
{
  const cycle = mkCycle({
    length_periods:    2,
    commission_model:  "first_period",
    commission_balance: 5000,
  });
  const contribs = [
    contrib(5000, "contribution", "completed"),  // collector deposit
    contrib(5000, "commission",   "completed"),  // offsetting commission charge
    contrib(5000, "contribution", "completed"),  // client period-1 deposit
  ];
  const { periods, paidCount } = allocatePeriods(cycle, contribs);

  // Net = 5000 - 5000 + 5000 = 5000; clientStart=1 → period 1 only
  assert.equal(periods[0].status, "collector", "Case 4: period 0 is collector");
  assert.equal(periods[1].paid,   5000,        "Case 4: period 1 fully funded");
  assert.equal(periods[1].status, "paid",      "Case 4: period 1 status");
  assert.equal(paidCount, 1, "Case 4: paidCount (collector excluded)");
  console.log("PASS Case 4: first_period fee excluded → collector + 1 paid");
}

console.log("\nAll 4 allocation tests passed.");
