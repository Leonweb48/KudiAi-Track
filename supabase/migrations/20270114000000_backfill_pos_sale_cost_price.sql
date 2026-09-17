-- ═════════════════════════════════════════════════════════════════════════════
-- One-time, precisely-scoped backfill for the two specific "POS" sales
-- affected by the cost-price-snapshot bug fixed in 20270113000000, reported
-- and confirmed by the owner (solomonleonjohnson01@gmail.com):
--
--   e8f14854-b1e1-419b-91fa-004bd4a35f58 — ₦115,500 sale, made while the
--     product's cost price was ₦114,200 (true profit ₦1,300) — was being
--     computed against the product's current, since-edited cost price
--     (₦61,850), wildly inflating this sale's reported profit.
--   a6a6fd23-1a43-40a3-8dce-2e8ef2534eef — ₦63,850 sale, made after the
--     product was edited to cost ₦61,850 (true profit ₦2,000) — already
--     happened to look correct today only because no further edit has
--     moved the product's cost price away from that value since; it was
--     still exposed to the same bug and would have gone wrong on the next
--     price edit.
--
-- Matched by exact id — a manual backfill scoped to these two known rows
-- only, not a pattern-matched bulk update, since the correct historical
-- cost price cannot be derived from anything already in the database (no
-- price-history audit trail exists) — it was supplied directly by the
-- owner after being asked.
-- ═════════════════════════════════════════════════════════════════════════════

UPDATE public.transactions
SET cost_price = 114200.00
WHERE id = 'e8f14854-b1e1-419b-91fa-004bd4a35f58'
  AND cost_price IS NULL
  AND amount = 115500.00;

UPDATE public.transactions
SET cost_price = 61850.00
WHERE id = 'a6a6fd23-1a43-40a3-8dce-2e8ef2534eef'
  AND cost_price IS NULL
  AND amount = 63850.00;
