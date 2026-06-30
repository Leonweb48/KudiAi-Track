-- Add 'invoices' feature key to enterprise plan
UPDATE public.subscription_plans
SET feature_keys = feature_keys || '["invoices"]'::jsonb
WHERE slug = 'enterprise'
  AND NOT (feature_keys @> '["invoices"]'::jsonb);

UPDATE public.subscription_plans
SET features = features || '["Invoice generation & WhatsApp sending"]'::jsonb
WHERE slug = 'enterprise'
  AND NOT (features @> '["Invoice generation & WhatsApp sending"]'::jsonb);
