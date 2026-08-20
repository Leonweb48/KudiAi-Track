-- ─────────────────────────────────────────────────────────────────────────────
-- Fix commission plan slugs and switch to dynamic price lookup
--
-- Problems fixed:
--   1. marketer_commission_config had plan='naira'/'oga' but subscriptions
--      actually use subscription_plans.slug ('business plan'/'enterprise plan').
--      The mismatch caused the trigger to always fall through to no-config
--      (returning early) and the claims route to map 0 price → ₦500 fallback.
--   2. auto_create_commission / auto_create_upgrade_commission had hardcoded
--      CASE WHEN 'naira'/'oga' price maps — now replaced with a live lookup
--      from subscription_plans so the trigger is resilient to plan catalogue
--      changes without requiring a new migration.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Rename plan slugs to match subscription_plans.slug
UPDATE public.marketer_commission_config SET plan = 'business plan'   WHERE plan = 'naira';
UPDATE public.marketer_commission_config SET plan = 'enterprise plan' WHERE plan = 'oga';

-- 2. Recreate auto_create_commission with dynamic price lookup
CREATE OR REPLACE FUNCTION public.auto_create_commission()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
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

  -- 2. Plan price from subscription_plans (authoritative source of truth)
  SELECT COALESCE(sp.price_monthly, 0) INTO v_plan_price
  FROM public.subscription_plans sp
  WHERE sp.slug = NEW.plan AND sp.is_active = true
  LIMIT 1;
  v_plan_price := COALESCE(v_plan_price, 0);
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

REVOKE ALL ON FUNCTION public.auto_create_commission() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_create_commission() TO service_role;

-- 3. Recreate auto_create_upgrade_commission with dynamic price lookup
CREATE OR REPLACE FUNCTION public.auto_create_upgrade_commission()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_mid        UUID;
  v_cfg        RECORD;
  v_amt        DECIMAL(12,2);
  v_old_price  DECIMAL(12,2);
  v_new_price  DECIMAL(12,2);
BEGIN
  -- Look up prices from subscription_plans (authoritative source of truth)
  SELECT COALESCE(price_monthly, 0) INTO v_old_price
  FROM public.subscription_plans WHERE slug = OLD.plan AND is_active = true LIMIT 1;
  v_old_price := COALESCE(v_old_price, 0);

  SELECT COALESCE(price_monthly, 0) INTO v_new_price
  FROM public.subscription_plans WHERE slug = NEW.plan AND is_active = true LIMIT 1;
  v_new_price := COALESCE(v_new_price, 0);

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

REVOKE ALL ON FUNCTION public.auto_create_upgrade_commission() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_create_upgrade_commission() TO service_role;

-- Register migration
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261120000001', 'fix_commission_plan_slugs_and_dynamic_price')
ON CONFLICT DO NOTHING;
