-- Fix: previous migration matched 0 rows because DB slugs use full words with spaces
-- e.g. slug='enterprise plan' not slug='oga' or slug='enterprise'
-- This migration uses ILIKE to match any variant.

UPDATE public.subscription_plans
SET
  feature_keys = feature_keys || '["invoices"]'::jsonb,
  features     = CASE
                   WHEN NOT (features @> '["Invoice generation & WhatsApp sending"]'::jsonb)
                   THEN features || '["Invoice generation & WhatsApp sending"]'::jsonb
                   ELSE features
                 END
WHERE
  (LOWER(slug) LIKE '%enterprise%' OR LOWER(name) LIKE '%enterprise%'
   OR slug IN ('oga', 'enterprise'))
  AND NOT (feature_keys @> '["invoices"]'::jsonb);
