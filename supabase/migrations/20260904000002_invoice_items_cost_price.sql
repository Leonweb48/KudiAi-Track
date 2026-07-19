ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS cost_price_kobo bigint DEFAULT NULL;
