-- ═══════════════════════════════════════════════════════════════
--  Add feature_limits JSONB column and expand feature_keys
--  for the kobo / naira / oga subscription plans.
-- ═══════════════════════════════════════════════════════════════

-- 1. New column: per-feature numeric caps (999999 = unlimited)
ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS feature_limits jsonb DEFAULT '{}';

-- 2. Update kobo — add credit (basic functionality stays free)
UPDATE public.subscription_plans
SET
  feature_keys  = '["credit"]',
  feature_limits = '{"staffManagement": 3, "inventory": 50, "loyalty": 100}'
WHERE slug = 'kobo';

-- 3. Update naira — add credit + aiChatbot, set countable limits
UPDATE public.subscription_plans
SET
  feature_keys  = '["aso","pdfExport","staffManagement","inventory","loyalty","aiInsights","aiChatbot","branches","credit"]',
  feature_limits = '{"aso": 10, "staffManagement": 10, "branches": 3, "inventory": 500, "loyalty": 1000}'
WHERE slug = 'naira';

-- 4. Update oga — everything unlimited
UPDATE public.subscription_plans
SET
  feature_keys  = '["aso","pdfExport","staffManagement","inventory","loyalty","aiInsights","aiChatbot","branches","apiAccess","loanAccess","printWholesale","credit","organisation"]',
  feature_limits = '{"aso": 999999, "staffManagement": 999999, "branches": 999999, "organisation": 999999, "inventory": 999999, "loyalty": 999999}'
WHERE slug = 'oga';
