-- ══════════════════════════════════════════════════════════════════════════════
-- Subscription sync: feature_keys, RLS for client reads, legacy slug migration,
-- upgrade prompts table, and ajo-groups limit trigger.
-- ══════════════════════════════════════════════════════════════════════════════

-- ─── 1. Add feature_keys column ───────────────────────────────────────────────
ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS feature_keys jsonb DEFAULT '[]';

-- ─── 2. Fix RLS: let authenticated users SELECT active plans ──────────────────
-- Drop the old catch-all service-only policy (it was blocking client reads).
-- The service_role key bypasses RLS entirely, so admin portal writes still work.
DROP POLICY IF EXISTS "plans_service_only" ON subscription_plans;

CREATE POLICY "authenticated_view_active_plans" ON subscription_plans
  FOR SELECT TO authenticated USING (is_active = true);

CREATE POLICY "anon_view_active_plans" ON subscription_plans
  FOR SELECT TO anon USING (is_active = true);

-- ─── 3. Seed feature_keys on existing plans ───────────────────────────────────
UPDATE subscription_plans
  SET feature_keys = '[]'::jsonb
  WHERE slug = 'starter';

UPDATE subscription_plans
  SET feature_keys = '["aso","pdfExport","staffManagement","inventory","loyalty"]'::jsonb,
      features     = '["Unlimited transactions","2 organizations","20 members","3 Ajo groups","Ajo savings management","PDF reports & export","Staff management","Inventory management","Loyalty program"]'::jsonb
  WHERE slug = 'basic';

UPDATE subscription_plans
  SET feature_keys = '["aso","pdfExport","staffManagement","inventory","loyalty","aiInsights","branches"]'::jsonb,
      features     = '["Everything in Basic","5 organizations","50 members","10 Ajo groups","AI-powered business insights","Branch management","Advanced analytics"]'::jsonb
  WHERE slug = 'professional';

UPDATE subscription_plans
  SET feature_keys = '["aso","pdfExport","staffManagement","inventory","loyalty","aiInsights","branches","apiAccess"]'::jsonb,
      features     = '["Everything in Professional","20 organizations","200 members","Unlimited Ajo groups","API access","Dedicated support","SLA guarantee","Custom integrations"]'::jsonb
  WHERE slug = 'enterprise';

-- ─── 4. Migrate legacy plan slugs in subscriptions ───────────────────────────
-- Old hardcoded slugs: business → basic, premium → professional
UPDATE subscriptions SET plan = 'basic'        WHERE plan = 'business';
UPDATE subscriptions SET plan = 'professional' WHERE plan = 'premium';

-- ─── 5. Plan upgrade prompts table ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plan_upgrade_prompts (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL,
  plan_slug   text        NOT NULL,
  plan_name   text        NOT NULL DEFAULT '',
  message     text        NOT NULL DEFAULT '',
  seen        boolean     DEFAULT false,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE plan_upgrade_prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_read_own_prompts" ON plan_upgrade_prompts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "user_mark_seen" ON plan_upgrade_prompts
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- ─── 6. Ajo-groups limit trigger (mirrors org + member triggers) ──────────────
CREATE OR REPLACE FUNCTION trg_check_ajo_group_limit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_plan  TEXT;
  v_max   INT;
  v_count INT;
BEGIN
  IF auth.role() = 'service_role' THEN RETURN NEW; END IF;

  SELECT plan INTO v_plan
  FROM subscriptions
  WHERE user_id = NEW.owner_id
    AND status IN ('active', 'trialing')
  ORDER BY created_at DESC
  LIMIT 1;

  v_plan := COALESCE(v_plan, 'starter');
  v_max  := get_plan_limit(v_plan, 'max_ajo_groups');

  SELECT COUNT(*) INTO v_count
  FROM aso_groups
  WHERE owner_id = NEW.owner_id
    AND status != 'inactive';

  IF v_count >= v_max THEN
    RAISE EXCEPTION 'Ajo group limit reached: you have % of % allowed on the % plan. Please upgrade.',
      v_count, v_max, v_plan
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ajo_group_limit ON aso_groups;
CREATE TRIGGER trg_ajo_group_limit
  BEFORE INSERT ON aso_groups
  FOR EACH ROW EXECUTE FUNCTION trg_check_ajo_group_limit();
