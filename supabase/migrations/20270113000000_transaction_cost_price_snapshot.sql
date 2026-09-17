-- ═════════════════════════════════════════════════════════════════════════════
-- Profit for a sale must be computed from the cost price AT THE TIME OF SALE,
-- never from whatever the linked product's cost price happens to be right
-- now. profitEngine.js has always done a live lookup instead
-- (productById/productByName -> prod.cost_price), so editing a product's
-- cost price retroactively changes the computed profit for every past sale
-- of that product — exactly the bug reported: a stock item sold once, then
-- edited (cost + selling price both changed), and every already-completed
-- sale's profit silently changed with it.
--
-- Line-item (cart) sales already snapshot the cost price into
-- line_items[].costPrice at sale time (AddTxnModal.jsx addLineItem) — that
-- data exists in the DB today, profitEngine.js just never reads it. Single-
-- item sales (the common POS case, and what was actually reported) are
-- worse: buildPayload() sends line_items: undefined whenever there's only
-- one item, so the snapshot captured in the UI never even reaches the
-- database — there was nothing to fall back to but the live product.
--
-- This migration adds the missing column; the accompanying frontend change
-- (AddTxnModal.jsx / useStore.js) populates it for single-item sales, and
-- profitEngine.js now prefers li.costPrice / transaction.cost_price over the
-- live product lookup wherever a snapshot is present. Historical rows with
-- no snapshot keep falling back to the live lookup (the original cost price
-- at their sale time was never recorded anywhere and can't be recovered) —
-- only sales made from this point forward are immune to the bug.
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS cost_price NUMERIC(12,2) DEFAULT NULL;

COMMENT ON COLUMN public.transactions.cost_price IS
  'Snapshot of the linked product''s cost price at the moment of this sale (single-item transactions only — multi-item sales carry it per line in line_items[].costPrice). Never re-derive profit from the product''s CURRENT cost price for a past sale; always prefer this stored value when present.';
