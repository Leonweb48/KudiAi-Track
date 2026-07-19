-- Invoice items: add product_id so stock is auto-deducted when invoice is sent.
-- ON DELETE SET NULL keeps the invoice line item intact if the product is later deleted.
ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_items_product
  ON public.invoice_items(product_id)
  WHERE product_id IS NOT NULL;
