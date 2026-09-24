// deno test --no-lock --node-modules-dir=none supabase/functions/_shared/registrationFee.test.ts
import { cleanRegFee, MAX_REG_FEE } from "./registrationFee.ts";

function assert(cond: unknown, msg: string) { if (!cond) throw new Error("assertion failed: " + msg); }

Deno.test("a normal amount passes through, numeric strings included", () => {
  assert(cleanRegFee(2000) === 2000, "number");
  assert(cleanRegFee("1500.5") === 1500.5, "string");
  assert(cleanRegFee("2000.00") === 2000, "numeric column comes back as a string");
});

Deno.test("blank, missing, negative and junk all mean no fee", () => {
  for (const v of [null, undefined, "", "abc", -5, NaN, Infinity, 0, {}, []]) assert(cleanRegFee(v) === 0, `${String(v)} → 0`);
});

Deno.test("rounds to kobo and caps an absurd value", () => {
  assert(cleanRegFee(10.005) === 10.01, "rounds");
  assert(cleanRegFee(99_999_999) === MAX_REG_FEE, "capped");
});
