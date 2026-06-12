-- ══════════════════════════════════════════════════════════════════════════════
-- Subscription plan limits enforcement
-- Triggered BEFORE INSERT on organizations and org_members
-- Service-role operations (admin portal) bypass all limits.
-- ══════════════════════════════════════════════════════════════════════════════

-- ─── Helper: look up plan limit column by slug ────────────────────────────────
CREATE OR REPLACE FUNCTION get_plan_limit(p_slug TEXT, p_column TEXT)
RETURNS INT LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE v_limit INT;
BEGIN
  EXECUTE format('SELECT %I FROM subscription_plans WHERE slug = $1', p_column)
    INTO v_limit USING p_slug;
  RETURN COALESCE(v_limit, 999999);
END;
$$;

-- ─── Trigger: organizations — enforce max_organizations ───────────────────────
CREATE OR REPLACE FUNCTION trg_check_org_limit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_plan  TEXT;
  v_max   INT;
  v_count INT;
BEGIN
  -- Admin / backend operations bypass limits
  IF auth.role() = 'service_role' THEN RETURN NEW; END IF;

  -- Get user's active subscription plan
  SELECT plan INTO v_plan
  FROM subscriptions
  WHERE user_id = NEW.owner_id
    AND status IN ('active', 'trialing')
  ORDER BY created_at DESC
  LIMIT 1;

  v_plan := COALESCE(v_plan, 'starter');

  v_max := get_plan_limit(v_plan, 'max_organizations');

  SELECT COUNT(*) INTO v_count
  FROM organizations
  WHERE owner_id = NEW.owner_id
    AND status != 'inactive';

  IF v_count >= v_max THEN
    RAISE EXCEPTION 'Organization limit reached: you have % of % allowed on the % plan. Please upgrade to create more organizations.',
      v_count, v_max, v_plan
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_org_limit ON organizations;
CREATE TRIGGER trg_org_limit
  BEFORE INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION trg_check_org_limit();

-- ─── Trigger: org_members — enforce max_org_members ──────────────────────────
CREATE OR REPLACE FUNCTION trg_check_org_member_limit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_owner UUID;
  v_plan  TEXT;
  v_max   INT;
  v_count INT;
BEGIN
  IF auth.role() = 'service_role' THEN RETURN NEW; END IF;

  -- Get the org owner
  SELECT owner_id INTO v_owner FROM organizations WHERE id = NEW.org_id;
  IF v_owner IS NULL THEN RETURN NEW; END IF;

  SELECT plan INTO v_plan
  FROM subscriptions
  WHERE user_id = v_owner
    AND status IN ('active', 'trialing')
  ORDER BY created_at DESC
  LIMIT 1;

  v_plan := COALESCE(v_plan, 'starter');

  v_max := get_plan_limit(v_plan, 'max_org_members');

  -- Count all active members across all orgs owned by this user
  SELECT COUNT(*) INTO v_count
  FROM org_members om
  JOIN organizations o ON om.org_id = o.id
  WHERE o.owner_id = v_owner
    AND om.status = 'active';

  IF v_count >= v_max THEN
    RAISE EXCEPTION 'Member limit reached: you have % of % allowed on the % plan. Please upgrade to add more members.',
      v_count, v_max, v_plan
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_org_member_limit ON org_members;
CREATE TRIGGER trg_org_member_limit
  BEFORE INSERT ON org_members
  FOR EACH ROW EXECUTE FUNCTION trg_check_org_member_limit();

-- ─── Helper RPC for app-side limit checking (returns remaining slots) ─────────
CREATE OR REPLACE FUNCTION get_user_plan_usage(p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_plan      TEXT;
  v_org_cnt   INT;
  v_mem_cnt   INT;
  v_max_orgs  INT;
  v_max_mems  INT;
BEGIN
  SELECT plan INTO v_plan
  FROM subscriptions
  WHERE user_id = p_user_id
    AND status IN ('active', 'trialing')
  ORDER BY created_at DESC
  LIMIT 1;

  v_plan := COALESCE(v_plan, 'starter');

  SELECT COUNT(*) INTO v_org_cnt FROM organizations
  WHERE owner_id = p_user_id AND status != 'inactive';

  SELECT COUNT(*) INTO v_mem_cnt
  FROM org_members om JOIN organizations o ON om.org_id = o.id
  WHERE o.owner_id = p_user_id AND om.status = 'active';

  v_max_orgs := get_plan_limit(v_plan, 'max_organizations');
  v_max_mems := get_plan_limit(v_plan, 'max_org_members');

  RETURN jsonb_build_object(
    'plan',               v_plan,
    'organizations',      jsonb_build_object('used', v_org_cnt, 'max', v_max_orgs, 'remaining', GREATEST(0, v_max_orgs - v_org_cnt)),
    'org_members',        jsonb_build_object('used', v_mem_cnt, 'max', v_max_mems, 'remaining', GREATEST(0, v_max_mems - v_mem_cnt))
  );
END;
$$;
