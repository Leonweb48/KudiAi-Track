-- Fix enterprise plan renewal and upgrade rates from 33.3% to 10%
UPDATE public.marketer_commission_config
SET percentage = 0.1000
WHERE id = '0c4590b0-cf96-40f4-ae99-45b903035370';

UPDATE public.marketer_commission_config
SET percentage = 0.1000
WHERE id = '9077b673-a253-40ed-af3a-2a9b7bfa63f0';

-- Register migration
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  '20261103000009',
  'fix_enterprise_commission_rates',
  ARRAY[
    'UPDATE public.marketer_commission_config SET percentage = 0.1000 WHERE id = ''0c4590b0-cf96-40f4-ae99-45b903035370''',
    'UPDATE public.marketer_commission_config SET percentage = 0.1000 WHERE id = ''9077b673-a253-40ed-af3a-2a9b7bfa63f0'''
  ]
)
ON CONFLICT (version) DO NOTHING;
