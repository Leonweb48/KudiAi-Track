-- Feature: sell catalogue products on credit.
-- When creating a credit sale, the owner can link inventory products so that
-- stock is deducted at the point of credit creation and cost price is captured
-- for profit measurement.  The items column stores the selected line items as
-- JSONB: [{ product_id, product_name, quantity, unit_price, cost_price }].
-- Repayment records are unaffected — they continue to credit the cash-in balance.

ALTER TABLE credits
  ADD COLUMN IF NOT EXISTS items JSONB DEFAULT NULL;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  '20261104000001',
  'credits_items_column',
  ARRAY['ALTER TABLE credits ADD COLUMN IF NOT EXISTS items JSONB DEFAULT NULL']
)
ON CONFLICT (version) DO NOTHING;
