ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS other_charges_kobo bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_charges_label text NOT NULL DEFAULT '';
