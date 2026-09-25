// Run: deno test supabase/functions/_shared/ckAmount.test.ts
import { parseCkAmount } from "./ckAmount.ts";

function eq(actual: unknown, expected: unknown, msg: string) {
  if (actual !== expected) throw new Error(`ASSERT ${msg}: got ${String(actual)}, expected ${String(expected)}`);
}

Deno.test("comma-formatted balance is read whole (the admin route's parseFloat('3,169.36') gave 3 -> '₦3.00')", () => {
  eq(parseCkAmount("3,169.36"), 3169.36, "thousands separator");
  eq(parseCkAmount("1,234,567.89"), 1234567.89, "millions");
});

Deno.test("negative balances keep their sign", () => {
  eq(parseCkAmount("-343.85"), -343.85, "leading minus");
  eq(parseCkAmount("−343.85"), -343.85, "typographic minus");
  eq(parseCkAmount("₦-1,343.85"), -1343.85, "currency + minus + comma");
  eq(parseCkAmount("(50.00)"), -50, "accounting parentheses");
  eq(parseCkAmount(-12.5), -12.5, "numbers pass through");
});

Deno.test("currency symbols and spaces are ignored", () => {
  eq(parseCkAmount("₦26.00"), 26, "naira sign");
  eq(parseCkAmount("N 1,200"), 1200, "N prefix");
  eq(parseCkAmount("  5000  "), 5000, "padding");
  eq(parseCkAmount(0), 0, "zero number");
  eq(parseCkAmount("0.00"), 0, "zero string");
});

Deno.test("non-numeric / empty input is null, never 0 (a missing balance must not trigger a fake alert)", () => {
  eq(parseCkAmount(null), null, "null");
  eq(parseCkAmount(undefined), null, "undefined");
  eq(parseCkAmount(""), null, "empty");
  eq(parseCkAmount("   "), null, "blank");
  eq(parseCkAmount("N/A"), null, "text");
  eq(parseCkAmount("-"), null, "lone minus");
  eq(parseCkAmount(NaN), null, "NaN");
});

Deno.test("negative zero is normalised to 0", () => {
  eq(Object.is(parseCkAmount("-0.00"), 0), true, "-0.00 is 0, not -0");
});
