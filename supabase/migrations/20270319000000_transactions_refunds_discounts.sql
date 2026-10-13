-- Refunds and discounts on sales (2026-10-13, owner: "do all of it").
--   discount_amount — naira taken off a sale at the till; the row's `amount` is already net of it.
--   refund_of       — on a category 'refund' row (type 'out'): the sale it gives money back for. A refund row copies
--                     the sale's cost_price, and `quantity` = units returned to stock (0 = nothing came back).
-- Profit rules R8/R9 in src/shared/profitEngine.js. No backfill: existing rows have neither.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS discount_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS refund_of uuid REFERENCES public.transactions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS transactions_refund_of_idx ON public.transactions (refund_of) WHERE refund_of IS NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_discount_amount_check') THEN
    ALTER TABLE public.transactions ADD CONSTRAINT transactions_discount_amount_check CHECK (discount_amount IS NULL OR discount_amount >= 0);
  END IF;
  RAISE NOTICE 'transactions | discount_amount + refund_of ready';
END $$;
