-- Add parent_item_id and pricing_mode to invoice_items.
-- Idempotent (IF NOT EXISTS) — safe to run on databases where the columns
-- already exist (added by the earlier 20260705200000 migration) and on
-- databases where they are missing (e.g. created fresh by 20260730000001).

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS parent_item_id uuid REFERENCES public.invoice_items(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS pricing_mode   text NOT NULL DEFAULT 'manual';

CREATE INDEX IF NOT EXISTS idx_invoice_items_parent ON public.invoice_items(parent_item_id);
