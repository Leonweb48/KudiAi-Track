-- ═══════════════════════════════════════════════════════════════
--  Plan feature fixes:
--  1. Add "invoices" key to naira + oga plans so Invoices screen
--     is accessible instead of permanently locked.
--  2. Add "organisation" key to naira plan (organisations are
--     accessible on standard tier per FALLBACK_PLANS definition).
--  3. Ensure oga has all expected keys including "invoices".
-- ═══════════════════════════════════════════════════════════════

-- Naira: add invoices + organisation if not already present
UPDATE public.subscription_plans
SET feature_keys = (
  SELECT jsonb_agg(DISTINCT elem ORDER BY elem)
  FROM jsonb_array_elements_text(
    feature_keys || '["invoices","organisation"]'::jsonb
  ) AS elem
)
WHERE slug = 'naira'
  AND NOT (feature_keys @> '["invoices"]'::jsonb AND feature_keys @> '["organisation"]'::jsonb);

-- Oga: add invoices if not already present
UPDATE public.subscription_plans
SET feature_keys = (
  SELECT jsonb_agg(DISTINCT elem ORDER BY elem)
  FROM jsonb_array_elements_text(
    feature_keys || '["invoices"]'::jsonb
  ) AS elem
)
WHERE slug = 'oga'
  AND NOT (feature_keys @> '["invoices"]'::jsonb);
