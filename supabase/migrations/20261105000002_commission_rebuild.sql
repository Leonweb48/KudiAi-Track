-- Commission system rebuild
-- Fixes: attribution (claimant > referrer), adds upgrade + renewal + milestone events,
--        audit trail columns on every commission row, plan-specific config rates.

-- ═══════════════════════════════════════════════════════════
-- PART A  Audit trail columns on marketer_commissions
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.marketer_commissions
  ADD COLUMN IF NOT EXISTS event_type          TEXT,
  ADD COLUMN IF NOT EXISTS plan_id             TEXT,
  ADD COLUMN IF NOT EXISTS plan_price_at_time  DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS rate_at_time        DECIMAL(10,6),
  ADD COLUMN IF NOT EXISTS calculated_amount   DECIMAL(12,2);

-- Backfill calculated_amount for existing rows so the column is never null
UPDATE public.marketer_commissions
SET calculated_amount = amount
WHERE calculated_amount IS NULL;

-- ═══════════════════════════════════════════════════════════
-- PART B  event_type column on marketer_commission_config
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.marketer_commission_config
  ADD COLUMN IF NOT EXISTS event_type  TEXT,
  ADD COLUMN IF NOT EXISTS updated_by  TEXT;

-- Map existing type values
UPDATE public.marketer_commission_config
SET event_type = 'new_subscription'
WHERE type = 'subscription' AND event_type IS NULL;

UPDATE public.marketer_commission_config
SET event_type = 'renewal'
WHERE type = 'renewal' AND event_type IS NULL;

-- Deactivate the old ambiguous NULL-plan subscription rows
-- (replaced below by deterministic plan-specific rows)
UPDATE public.marketer_commission_config
SET is_active = false
WHERE event_type = 'new_subscription' AND plan IS NULL;

-- ═══════════════════════════════════════════════════════════
-- PART C  Plan-specific config rows (deterministic rates)
-- ═══════════════════════════════════════════════════════════

INSERT INTO public.marketer_commission_config
  (name, type, event_type, plan, percentage, is_percentage, is_active)
VALUES
  ('New Subscription — Naira', 'subscription', 'new_subscription', 'naira', 0.10, true, true),
  ('New Subscription — Oga',   'subscription', 'new_subscription', 'oga',   0.10, true, true),
  ('Upgrade — Naira',          'subscription', 'upgrade',          'naira', 0.10, true, true),
  ('Upgrade — Oga',            'subscription', 'upgrade',          'oga',   0.10, true, true),
  ('Renewal — Naira',          'renewal',      'renewal',          'naira', 0.05, true, true),
  ('Renewal — Oga',            'renewal',      'renewal',          'oga',   0.05, true, true)
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════
-- PART D  marketer_milestone_config
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.marketer_milestone_config (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT        NOT NULL,
  threshold_type   TEXT        NOT NULL
    CHECK (threshold_type IN ('business_count', 'total_commission')),
  threshold_value  DECIMAL(12,2) NOT NULL,
  bonus_amount     DECIMAL(12,2) NOT NULL,
  one_time         BOOLEAN     NOT NULL DEFAULT true,
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.marketer_milestone_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketer_milestone_config FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.marketer_milestone_config TO service_role;

-- Seed default milestones
INSERT INTO public.marketer_milestone_config
  (name, threshold_type, threshold_value, bonus_amount, one_time)
VALUES
  ('First 5 Businesses',           'business_count',   5,       5000,  true),
  ('First 10 Businesses',          'business_count',   10,     10000,  true),
  ('First 25 Businesses',          'business_count',   25,     25000,  true),
  ('₦50k Commission Earned',       'total_commission', 50000,   5000,  true),
  ('₦200k Commission Earned',      'total_commission', 200000, 20000,  true)
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════
-- PART E  marketer_milestone_awards
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.marketer_milestone_awards (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  marketer_id         UUID        NOT NULL REFERENCES brm_marketers(id) ON DELETE CASCADE,
  milestone_id        UUID        NOT NULL REFERENCES marketer_milestone_config(id) ON DELETE CASCADE,
  commission_id       UUID        REFERENCES marketer_commissions(id) ON DELETE SET NULL,
  threshold_snapshot  DECIMAL(12,2),
  awarded_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- No UNIQUE constraint: repeatable milestones (one_time=false) may be awarded multiple times.
  -- The function checks one_time before inserting.
);

ALTER TABLE public.marketer_milestone_awards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketer_milestone_awards FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.marketer_milestone_awards TO service_role;

-- ═══════════════════════════════════════════════════════════
-- PART F  Helper: resolve the correct marketer for a business
--         Priority: approved claim > referred_by_marketer_id
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.resolve_commission_marketer(p_business_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mid UUID;
BEGIN
  -- Priority 1: marketer who has an approved claim on this business
  SELECT bc.marketer_id INTO v_mid
  FROM business_claims bc
  JOIN brm_marketers m ON m.id = bc.marketer_id
  WHERE bc.business_id = p_business_id
    AND bc.status      = 'approved'
    AND m.status       = 'active'
  LIMIT 1;

  IF v_mid IS NOT NULL THEN RETURN v_mid; END IF;

  -- Priority 2: marketer who referred this business
  SELECT m.id INTO v_mid
  FROM brm_marketers m
  JOIN profiles p ON p.referred_by_marketer_id = m.id
  WHERE p.id    = p_business_id
    AND m.status = 'active'
  LIMIT 1;

  RETURN v_mid;  -- NULL if no marketer found
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_commission_marketer(UUID)
  FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════
-- PART G  Helper: check and award milestones after any commission
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.check_milestone_commissions(p_marketer_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business_count   INTEGER;
  v_total_commission DECIMAL(12,2);
  v_milestone        RECORD;
  v_commission_id    UUID;
  v_threshold_met    BOOLEAN;
BEGIN
  -- Count approved claims (businesses this marketer is responsible for)
  SELECT COUNT(*) INTO v_business_count
  FROM business_claims
  WHERE marketer_id = p_marketer_id
    AND status      = 'approved';

  -- Sum of all non-milestone commission amounts that have been approved or paid
  SELECT COALESCE(SUM(COALESCE(calculated_amount, amount)), 0) INTO v_total_commission
  FROM marketer_commissions
  WHERE marketer_id = p_marketer_id
    AND status IN ('approved', 'paid')
    AND (event_type IS NULL OR event_type != 'milestone');

  FOR v_milestone IN
    SELECT * FROM marketer_milestone_config
    WHERE is_active = true
    ORDER BY threshold_value ASC
  LOOP
    -- Skip one_time milestones already awarded
    IF v_milestone.one_time THEN
      IF EXISTS (
        SELECT 1 FROM marketer_milestone_awards
        WHERE marketer_id = p_marketer_id AND milestone_id = v_milestone.id
      ) THEN CONTINUE; END IF;
    END IF;

    -- Evaluate threshold
    v_threshold_met := CASE v_milestone.threshold_type
      WHEN 'business_count'   THEN v_business_count   >= v_milestone.threshold_value
      WHEN 'total_commission' THEN v_total_commission  >= v_milestone.threshold_value
      ELSE false
    END;

    IF NOT v_threshold_met THEN CONTINUE; END IF;

    -- Award the milestone
    INSERT INTO marketer_commissions
      (marketer_id, type, event_type, amount, calculated_amount,
       status, reference, notes, rate_at_time, plan_price_at_time)
    VALUES (
      p_marketer_id, 'bonus', 'milestone',
      v_milestone.bonus_amount, v_milestone.bonus_amount,
      'pending',
      'MILESTONE-' || v_milestone.id::TEXT,
      'Milestone bonus: ' || v_milestone.name,
      1.0, v_milestone.bonus_amount
    )
    RETURNING id INTO v_commission_id;

    INSERT INTO marketer_milestone_awards
      (marketer_id, milestone_id, commission_id,
       threshold_snapshot)
    VALUES (
      p_marketer_id, v_milestone.id, v_commission_id,
      CASE v_milestone.threshold_type
        WHEN 'business_count'   THEN v_business_count
        WHEN 'total_commission' THEN v_total_commission
      END
    );

    INSERT INTO marketer_notifications
      (marketer_id, type, title, message, link)
    VALUES (
      p_marketer_id, 'bonus', 'Milestone Reached!',
      v_milestone.name || ' — ₦' || v_milestone.bonus_amount::TEXT || ' bonus added',
      '/commissions'
    );
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_milestone_commissions(UUID)
  FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════
-- PART H  Rewrite auto_create_commission (INSERT trigger)
--         Handles: new_subscription and renewal
--         Attribution: claimant first, referrer fallback
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.auto_create_commission()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mid          UUID;
  v_cfg          RECORD;
  v_amt          DECIMAL(12,2);
  v_plan_price   DECIMAL(12,2);
  v_prior_count  INTEGER;
  v_event_type   TEXT;
BEGIN
  -- 1. Resolve marketer: claimant > referrer
  v_mid := public.resolve_commission_marketer(NEW.user_id);
  IF v_mid IS NULL THEN RETURN NEW; END IF;

  -- 2. Plan price (hardcoded; update if plan catalogue changes)
  v_plan_price := CASE NEW.plan
    WHEN 'naira' THEN 7000
    WHEN 'oga'   THEN 15000
    ELSE 0
  END;
  IF v_plan_price = 0 THEN RETURN NEW; END IF;

  -- 3. New subscription or renewal?
  SELECT COUNT(*) INTO v_prior_count
  FROM subscriptions
  WHERE user_id = NEW.user_id
    AND id != NEW.id;

  v_event_type := CASE WHEN v_prior_count > 0 THEN 'renewal' ELSE 'new_subscription' END;

  -- 4. Look up rate — plan-specific row first, NULL-plan fallback
  SELECT * INTO v_cfg
  FROM marketer_commission_config
  WHERE event_type = v_event_type
    AND is_active  = true
    AND (plan = NEW.plan OR plan IS NULL)
  ORDER BY plan NULLS LAST
  LIMIT 1;

  IF v_cfg IS NULL THEN RETURN NEW; END IF;

  -- 5. Calculate
  v_amt := CASE WHEN v_cfg.is_percentage
    THEN v_plan_price * v_cfg.percentage
    ELSE v_cfg.amount
  END;

  -- 6. Insert with full audit trail (append-only)
  INSERT INTO marketer_commissions
    (marketer_id, business_id, config_id, type, event_type,
     plan_id, plan_price_at_time, rate_at_time,
     amount, calculated_amount, status, reference)
  VALUES (
    v_mid, NEW.user_id, v_cfg.id, 'subscription', v_event_type,
    NEW.plan, v_plan_price,
    CASE WHEN v_cfg.is_percentage THEN v_cfg.percentage ELSE NULL END,
    v_amt, v_amt, 'pending', NEW.id::TEXT
  );

  -- 7. Notify marketer
  INSERT INTO marketer_notifications (marketer_id, type, title, message, link)
  VALUES (
    v_mid, 'commission',
    CASE v_event_type
      WHEN 'new_subscription' THEN 'New Commission Earned!'
      ELSE 'Renewal Commission Earned!'
    END,
    '₦' || v_amt::TEXT || ' for a ' || NEW.plan || ' ' ||
    CASE v_event_type WHEN 'new_subscription' THEN 'subscription' ELSE 'renewal' END,
    '/commissions'
  );

  -- 8. Check milestones
  PERFORM public.check_milestone_commissions(v_mid);

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.auto_create_commission()
  FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════
-- PART I  New function: upgrade commissions (UPDATE trigger)
--         Fires when plan changes to a more expensive plan.
--         Uses full new plan price (not difference) because:
--         - simpler and predictable
--         - rewards moving businesses to better plans
--         - differential requires tracking prior billing amounts
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.auto_create_upgrade_commission()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mid        UUID;
  v_cfg        RECORD;
  v_amt        DECIMAL(12,2);
  v_old_price  DECIMAL(12,2);
  v_new_price  DECIMAL(12,2);
BEGIN
  v_old_price := CASE OLD.plan
    WHEN 'naira' THEN 7000
    WHEN 'oga'   THEN 15000
    ELSE 0
  END;
  v_new_price := CASE NEW.plan
    WHEN 'naira' THEN 7000
    WHEN 'oga'   THEN 15000
    ELSE 0
  END;

  -- Only fire on upgrades (new plan is more expensive)
  IF v_new_price <= v_old_price OR v_new_price = 0 THEN RETURN NEW; END IF;

  v_mid := public.resolve_commission_marketer(NEW.user_id);
  IF v_mid IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_cfg
  FROM marketer_commission_config
  WHERE event_type = 'upgrade'
    AND is_active  = true
    AND (plan = NEW.plan OR plan IS NULL)
  ORDER BY plan NULLS LAST
  LIMIT 1;

  IF v_cfg IS NULL THEN RETURN NEW; END IF;

  v_amt := CASE WHEN v_cfg.is_percentage
    THEN v_new_price * v_cfg.percentage
    ELSE v_cfg.amount
  END;

  INSERT INTO marketer_commissions
    (marketer_id, business_id, config_id, type, event_type,
     plan_id, plan_price_at_time, rate_at_time,
     amount, calculated_amount, status, reference)
  VALUES (
    v_mid, NEW.user_id, v_cfg.id, 'subscription', 'upgrade',
    NEW.plan, v_new_price,
    CASE WHEN v_cfg.is_percentage THEN v_cfg.percentage ELSE NULL END,
    v_amt, v_amt, 'pending', 'UPGRADE-' || NEW.id::TEXT
  );

  INSERT INTO marketer_notifications (marketer_id, type, title, message, link)
  VALUES (
    v_mid, 'commission', 'Upgrade Commission!',
    '₦' || v_amt::TEXT || ' for upgrade to ' || NEW.plan,
    '/commissions'
  );

  PERFORM public.check_milestone_commissions(v_mid);

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.auto_create_upgrade_commission()
  FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════
-- PART J  Register upgrade trigger
-- ═══════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS trg_auto_upgrade_commission ON subscriptions;
CREATE TRIGGER trg_auto_upgrade_commission
AFTER UPDATE ON subscriptions
FOR EACH ROW
WHEN (OLD.plan IS DISTINCT FROM NEW.plan)
EXECUTE FUNCTION public.auto_create_upgrade_commission();

-- ═══════════════════════════════════════════════════════════
-- PART K  Register migration
-- ═══════════════════════════════════════════════════════════

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261105000002', 'commission_rebuild')
ON CONFLICT (version) DO NOTHING;
