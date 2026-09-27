// Run: deno test --config '{"nodeModulesDir":"none"}' supabase/functions/_shared/billCost.test.ts
import { airtimeCost, dataCost, findPlanPrice, networkName, parseDiscounts, printAirtimeCost, reportedChargeKobo } from "./billCost.ts";

function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`ASSERT ${msg}: got ${a}, expected ${e}`);
}

const D = parseDiscounts({ airtime: { MTN: 0.03, Glo: 0.08 }, epin: { MTN: 0.01 } });

Deno.test("airtime cost = face value less the network's wholesale discount, flagged as an estimate", () => {
  eq(airtimeCost("1000", "MTN", D), { costKobo: 97000, faceKobo: 100000, basis: "wholesale_discount", estimated: true }, "MTN ₦1,000 at 3 %");
  eq(airtimeCost(500, "Glo", D), { costKobo: 46000, faceKobo: 50000, basis: "wholesale_discount", estimated: true }, "Glo ₦500 at 8 %");
  eq(airtimeCost("99.5", "MTN", D)?.costKobo, 9652, "kobo rounding: 9,950 × 0.97 = 9,651.5 → 9,652");
});

Deno.test("airtime with no amount, a bad amount or an unknown network books nothing", () => {
  for (const a of [undefined, null, "", "abc", 0, -50, NaN]) eq(airtimeCost(a, "MTN", D), null, "amount " + String(a));
  eq(airtimeCost("100", null, D), null, "no network");
  eq(airtimeCost("100", "Vodafone", { airtime: {}, epin: {} }), null, "network with no discount at all");
});

Deno.test("the discount table falls back to the last known spread and ignores nonsense", () => {
  eq(parseDiscounts(undefined), { airtime: { MTN: 0.03, Airtel: 0.03, "9mobile": 0.07, Glo: 0.08 }, epin: { MTN: 0.01, Airtel: 0.02, "9mobile": 0.05, Glo: 0.02 } }, "no config");
  for (const bad of ["not json", "[]", "42", null, 7]) eq(parseDiscounts(bad).airtime.MTN, 0.03, "garbage " + JSON.stringify(bad));
  const d = parseDiscounts(JSON.stringify({ airtime: { MTN: 0.05, Glo: -1, Airtel: 0.9, "9mobile": "x" }, epin: { MTN: 0.5 } }));
  eq([d.airtime.MTN, d.airtime.Glo, d.airtime.Airtel, d.airtime["9mobile"], d.epin.MTN], [0.05, 0.08, 0.03, 0.07, 0.01], "only sane live values override; a discount of 50 % or more is refused");
});

Deno.test("print airtime: value × quantity less the e-pin discount", () => {
  eq(printAirtimeCost("500", "10", "MTN", D), { costKobo: 495000, faceKobo: 500000, basis: "wholesale_discount", estimated: true }, "10 × ₦500 at 1 %");
  eq(printAirtimeCost(100, 1, "MTN", D)?.costKobo, 9900, "single pin");
  for (const [v, q] of [[500, 0], [500, 101], [0, 5], [500, "x"], [500, -1]] as [number, unknown][]) eq(printAirtimeCost(v, q, "MTN", D), null, `value ${v} qty ${q}`);
});

Deno.test("data: the provider's list price × quantity; an unknown price books nothing", () => {
  eq(dataCost(297.5, 1), { costKobo: 29750, faceKobo: 29750, basis: "provider_plan_price", estimated: true }, "one plan");
  eq(dataCost(297.5, "3")?.costKobo, 89250, "print data × 3");
  eq(dataCost(297.5, undefined)?.costKobo, 29750, "no quantity means one");
  for (const p of [null, 0, -1, NaN]) eq(dataCost(p as number, 1), null, "price " + String(p));
  eq(dataCost(297.5, 0), null, "zero quantity"); eq(dataCost(297.5, 101), null, "over the 100 limit");
  eq(dataCost(null, 1, { amountcharged: "290" }), { costKobo: 29000, faceKobo: 29000, basis: "provider_reported", estimated: false }, "no list price but the provider states its charge");
  eq(dataCost(null, 1, { amount: "290" }), null, "no list price and no stated charge");
});

Deno.test("a provider-reported charge wins and is not an estimate — but only if it is plausible", () => {
  eq(airtimeCost("1000", "MTN", D, { amountcharged: "970.00" }), { costKobo: 97000, faceKobo: 100000, basis: "provider_reported", estimated: false }, "reported");
  eq(airtimeCost("1000", "MTN", D, { amountcharged: "₦1,000.00" })?.costKobo, 100000, "currency symbol and separators are parsed");
  eq(airtimeCost("1000", "MTN", D, { AmountCharged: 960 })?.basis, "provider_reported", "other spellings");
  for (const junk of ["0", "-5", "abc", "", null, "2000", "100"]) eq(airtimeCost("1000", "MTN", D, { amountcharged: junk })?.basis, "wholesale_discount", "implausible figure ignored: " + JSON.stringify(junk));
  eq(airtimeCost("1000", "MTN", D, { amount: "970" })?.basis, "wholesale_discount", "a plain 'amount' is the face value, not a charge");
  eq(dataCost(297, 1, { amountcharged: "290" }), { costKobo: 29000, faceKobo: 29700, basis: "provider_reported", estimated: false }, "data reported");
  eq(printAirtimeCost(500, 10, "MTN", D, { amountcharged: "4,950" })?.costKobo, 495000, "print reported");
  eq(reportedChargeKobo({ amountcharged: "50" }, 0), 5000, "no face value: any positive figure under the ceiling");
  eq(reportedChargeKobo({ amountcharged: "9999999999" }, 0), null, "…but not an absurd one");
  eq(reportedChargeKobo(null), null, "no response"); eq(reportedChargeKobo({}), null, "no field");
});

const PLANS = {
  MOBILE_NETWORK: {
    MTN: [{ ID: "01", PRODUCT: [{ PRODUCT_ID: "500.00", PRODUCT_AMOUNT: "297.00" }, { PRODUCT_ID: "1000.00", PRODUCT_AMOUNT: "1,050.00" }] }],
    m_9mobile: [{ ID: "03", PRODUCT: [{ PRODUCT_ID: "2000.00", PRODUCT_AMOUNT: "1400" }, { PRODUCT_ID: "dup", PRODUCT_AMOUNT: "10" }, { PRODUCT_ID: "dup", PRODUCT_AMOUNT: "20" }, { PRODUCT_ID: "same", PRODUCT_AMOUNT: "10" }, { PRODUCT_ID: "same", PRODUCT_AMOUNT: "10.00" }] }],
  },
};

Deno.test("plan price lookup: by network (case, punctuation, 9mobile aliases) and plan id", () => {
  eq(findPlanPrice(PLANS, "MTN", "500.00"), 297, "MTN plan");
  eq(findPlanPrice(PLANS, "mtn", "1000.00"), 1050, "case-insensitive network, separators in the price");
  eq(findPlanPrice(PLANS, "9mobile", "2000.00"), 1400, "9mobile is found under m_9mobile");
  eq(findPlanPrice(PLANS, "Airtel", "500.00"), null, "network the response does not list");
  eq(findPlanPrice(PLANS, "MTN", "999"), null, "unknown plan"); eq(findPlanPrice(PLANS, "MTN", ""), null, "empty plan id");
  for (const bad of [null, undefined, {}, "x", { MOBILE_NETWORK: [] }, { MOBILE_NETWORK: { MTN: "no" } }]) eq(findPlanPrice(bad, "MTN", "500.00"), null, "garbage response " + JSON.stringify(bad));
});

Deno.test("the same plan id listed twice at different prices is a guess — nothing is booked; the same price twice is fine", () => {
  eq(findPlanPrice(PLANS, "9mobile", "dup"), null, "conflicting prices");
  eq(findPlanPrice(PLANS, "9mobile", "same"), 10, "identical duplicates");
});

Deno.test("network names: by name (incl. the old t2mobile) or by ClubKonnect id", () => {
  eq([networkName("MTN"), networkName("glo"), networkName("t2mobile"), networkName("9MOBILE"), networkName("Airtel")], ["MTN", "Glo", "9mobile", "9mobile", "Airtel"], "names");
  eq([networkName(undefined, "01"), networkName("", "04"), networkName("x", "03"), networkName(undefined, "99"), networkName(undefined)], ["MTN", "Airtel", "9mobile", null, null], "ids");
});
