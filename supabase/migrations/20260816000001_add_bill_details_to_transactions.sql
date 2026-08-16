ALTER TABLE transactions ADD COLUMN IF NOT EXISTS bill_details JSONB;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  '20260816000001',
  'add_bill_details_to_transactions',
  ARRAY['ALTER TABLE transactions ADD COLUMN IF NOT EXISTS bill_details JSONB']
)
ON CONFLICT (version) DO NOTHING;
