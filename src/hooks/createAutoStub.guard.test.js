/**
 * Guard-logic tests for createAutoStub's collision check.
 *
 * The hook cannot be called in isolation (requires Supabase, React context),
 * so we extract the pure collision predicate and verify it independently.
 * This is the exact algorithm on useInventory.js line 112-113.
 */

function wouldSkipStub(products, inputName) {
  const normName = inputName.trim();
  const normLow  = normName.toLowerCase();
  return products.some(p => p.product_name.toLowerCase().trim() === normLow);
}

const PRODUCTS = [
  { product_name: "Oraimo" },
  { product_name: "Samsung TV" },
  { product_name: "  Fanta  " },   // stored with surrounding spaces (edge case)
];

// ── Case variants must all collide ────────────────────────────────────────────
test("'oraimo' (all lowercase) collides with existing 'Oraimo'", () => {
  expect(wouldSkipStub(PRODUCTS, "oraimo")).toBe(true);
});

test("'ORAIMO' (all uppercase) collides with existing 'Oraimo'", () => {
  expect(wouldSkipStub(PRODUCTS, "ORAIMO")).toBe(true);
});

test("'Oraimo' (exact match) collides", () => {
  expect(wouldSkipStub(PRODUCTS, "Oraimo")).toBe(true);
});

// ── Whitespace variants must all collide ──────────────────────────────────────
test("' Oraimo ' (surrounding spaces) collides with 'Oraimo'", () => {
  expect(wouldSkipStub(PRODUCTS, " Oraimo ")).toBe(true);
});

test("stored product '  Fanta  ' (stored with spaces) collides with 'fanta' input", () => {
  expect(wouldSkipStub(PRODUCTS, "fanta")).toBe(true);
});

// ── Novel names must NOT collide ──────────────────────────────────────────────
test("'Tecno' (new product) does not collide — stub should be created", () => {
  expect(wouldSkipStub(PRODUCTS, "Tecno")).toBe(false);
});

test("empty / whitespace-only name is blocked by the earlier guard, not collision", () => {
  // The hook returns early on !name?.trim() before reaching this check
  // but defensively: trim("   ") = "" → normLow = "" → no product name is ""
  expect(wouldSkipStub(PRODUCTS, "   ")).toBe(false);
});
