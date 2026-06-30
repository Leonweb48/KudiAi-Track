-- Add 'invoices' feature key to the top-tier plan.
-- The DB may use slug='oga' (canonical) or slug='enterprise' (legacy seed).
-- Also add it to any plan explicitly named "Enterprise" or "Oga" regardless of slug.

UPDATE public.subscription_plans
SET
  feature_keys = feature_keys || '["invoices"]'::jsonb,
  features     = CASE
                   WHEN NOT (features @> '["Invoice generation & WhatsApp sending"]'::jsonb)
                   THEN features || '["Invoice generation & WhatsApp sending"]'::jsonb
                   ELSE features
                 END
WHERE
  (slug IN ('oga', 'enterprise') OR LOWER(name) IN ('oga', 'enterprise'))
  AND NOT (feature_keys @> '["invoices"]'::jsonb);
