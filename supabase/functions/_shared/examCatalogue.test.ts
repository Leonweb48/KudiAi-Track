// Run: deno test supabase/functions/_shared/examCatalogue.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { findExamProduct, parseCkExamCatalogue, providerExamCode } from "./examCatalogue.ts";

// ClubKonnect's live answers, 2026-09-29
const CK_WAEC = { EXAM_TYPE: [
  { PRODUCT_CODE: "waec-registraion", PRODUCT_DESCRIPTION: "WAEC Registration PIN", PRODUCT_AMOUNT: "37500.00" },
  { PRODUCT_CODE: "waecdirect", PRODUCT_DESCRIPTION: "WAEC Result Checker PIN", PRODUCT_AMOUNT: "5350.00" },
] };
const CK_JAMB_EMPTY = { EXAM_TYPE: [] };

Deno.test("parseCkExamCatalogue: ClubKonnect's list → products with a price", () => {
  assertEquals(parseCkExamCatalogue(CK_WAEC), [
    { code: "waec-registraion", name: "WAEC Registration PIN", amount: 37500 },
    { code: "waecdirect", name: "WAEC Result Checker PIN", amount: 5350 },
  ]);
  assertEquals(parseCkExamCatalogue(CK_JAMB_EMPTY), []);
});

Deno.test("parseCkExamCatalogue: junk never throws; unpriced or code-less products are dropped", () => {
  assertEquals(parseCkExamCatalogue(null), []);
  assertEquals(parseCkExamCatalogue({ status: "INVALID_CREDENTIALS" }), []);
  assertEquals(parseCkExamCatalogue({ EXAM_TYPE: "nope" }), []);
  assertEquals(parseCkExamCatalogue({ EXAM_TYPE: [{ PRODUCT_CODE: "utme-mock", PRODUCT_AMOUNT: "0" }, { PRODUCT_AMOUNT: "7700" }, { PRODUCT_CODE: "utme-no-mock", PRODUCT_AMOUNT: "6200" }] }),
    [{ code: "utme-no-mock", name: "", amount: 6200 }]);
});

Deno.test("findExamProduct: the app's code, or the provider's spelling of it ('waec-registraion'); none = not on sale", () => {
  const list = parseCkExamCatalogue(CK_WAEC);
  assertEquals(findExamProduct(list, "waecdirect")?.amount, 5350);
  assertEquals(findExamProduct(list, "waec-registration"), { code: "waec-registraion", name: "WAEC Registration PIN", amount: 37500 });
  assertEquals(findExamProduct(list, "WAECDIRECT")?.code, "waecdirect");
  assertEquals(findExamProduct(parseCkExamCatalogue(CK_JAMB_EMPTY), "utme-mock"), null);
  assertEquals(findExamProduct(list, "de"), null);
});

Deno.test("providerExamCode: what to send the provider — its catalogue code, else its known spelling, else the app's", () => {
  const list = parseCkExamCatalogue(CK_WAEC);
  assertEquals(providerExamCode(list, "waec-registration"), "waec-registraion");
  assertEquals(providerExamCode([], "waec-registration"), "waec-registraion");   // catalogue unreachable → the provider's known spelling
  assertEquals(providerExamCode(list, "waecdirect"), "waecdirect");
  assertEquals(providerExamCode([], "utme-mock"), "utme-mock");
});
