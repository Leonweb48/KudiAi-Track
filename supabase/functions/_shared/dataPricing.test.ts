// Run: deno test supabase/functions/_shared/dataPricing.test.ts
import { applyDataPrices, normName, parseDiscountPct, parseSellingPrices, type Plan } from "./dataPricing.ts";

function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`ASSERT ${msg}: got ${a}, expected ${e}`);
}

const PLANS: Plan[] = [
  { plan_id: "500", plan_name: "500 MB - Weekly (SME)", plan_amount: 297 },
  { plan_id: "500.00", plan_name: "500 MB - Monthly (SME)", plan_amount: 307 },
  { plan_id: "1000", plan_name: "5 GB - 14 days Night Plan (SME) ", plan_amount: 1000 },   // provider name has a trailing space
  { plan_id: "9999", plan_name: "Brand new plan", plan_amount: 1234.5 },                    // not in the owner's table
];
const RAW = JSON.stringify({ MTN: { "500 MB - Weekly (SME)": 350, "500 MB - Monthly (SME)": 500, "5 GB - 14 days Night Plan (SME)": 2000 }, Glo: { "x": 100 } });

Deno.test("the selling price replaces the provider price; the provider price is kept as cost_amount", () => {
  const r = applyDataPrices(PLANS, "MTN", parseSellingPrices(RAW));
  eq(r[0].plan_amount, 350, "weekly"); eq(r[0].cost_amount, 297, "cost kept"); eq(r[0].priced, true, "priced flag");
  eq(r[1].plan_amount, 500, "monthly");
});

Deno.test("plan names match despite case, repeated spaces and the provider's trailing space", () => {
  const r = applyDataPrices(PLANS, "mtn", parseSellingPrices(RAW));
  eq(r[2].plan_amount, 2000, "trailing-space name still priced");
  eq(normName("  500  MB - Weekly (SME) "), "500 mb - weekly (sme)", "normName");
});

Deno.test("a plan with no selling price keeps the provider price and is flagged unpriced", () => {
  const r = applyDataPrices(PLANS, "MTN", parseSellingPrices(RAW));
  eq(r[3].plan_amount, 1234.5, "fallback amount"); eq(r[3].priced, false, "flag");
});

Deno.test("an unknown network or an empty/garbage config changes nothing", () => {
  eq(applyDataPrices(PLANS, "Airtel", parseSellingPrices(RAW)).map((p) => p.plan_amount), [297, 307, 1000, 1234.5], "unknown network");
  for (const bad of [null, undefined, "", "not json", "[]", "42", 7, { MTN: [] }]) {
    eq(applyDataPrices(PLANS, "MTN", parseSellingPrices(bad)).map((p) => p.plan_amount), [297, 307, 1000, 1234.5], "garbage " + JSON.stringify(bad));
  }
});

Deno.test("zero, negative and non-numeric selling prices are ignored (never sell for free)", () => {
  const s = parseSellingPrices({ MTN: { "500 MB - Weekly (SME)": 0, "500 MB - Monthly (SME)": -5, "5 GB - 14 days Night Plan (SME)": "abc" } });
  eq(applyDataPrices(PLANS, "MTN", s).map((p) => p.plan_amount), [297, 307, 1000, 1234.5], "ignored");
});

Deno.test("Print Data: the percentage comes off the SELLING price, rounded to the naira", () => {
  const s = parseSellingPrices(RAW);
  const r = applyDataPrices(PLANS, "MTN", s, { print: true, printDiscountPct: 2 });
  eq(r[0].plan_amount, 343, "350 -> 343"); eq(r[1].plan_amount, 490, "500 -> 490"); eq(r[2].plan_amount, 1960, "2000 -> 1960");
  eq(applyDataPrices([{ plan_id: "1", plan_name: "x", plan_amount: 1 }], "MTN", parseSellingPrices({ MTN: { x: 1550 } }), { print: true, printDiscountPct: 2 })[0].plan_amount, 1519, "1550 -> 1519");
  eq(r[0].cost_amount, 297, "cost unchanged");
});

Deno.test("Print Data: a plan without a selling price gets NO discount (it would sell below cost)", () => {
  const r = applyDataPrices(PLANS, "MTN", parseSellingPrices(RAW), { print: true, printDiscountPct: 2 });
  eq(r[3].plan_amount, 1234.5, "unpriced stays at provider price");
});

Deno.test("normal data ignores the print discount, and a missing/absurd discount means none", () => {
  const s = parseSellingPrices(RAW);
  eq(applyDataPrices(PLANS, "MTN", s, { print: false, printDiscountPct: 2 })[0].plan_amount, 350, "not print");
  for (const pct of [undefined, 0, -3, 25, 100, "abc", null]) eq(applyDataPrices(PLANS, "MTN", s, { print: true, printDiscountPct: pct as number })[0].plan_amount, 350, "pct " + String(pct));
  eq(parseDiscountPct("2"), 2, "string 2"); eq(parseDiscountPct(20), 20, "20 allowed"); eq(parseDiscountPct(20.1), 0, "over 20 refused");
});
