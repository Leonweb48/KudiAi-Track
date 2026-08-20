-- Add link column to marketer_notifications and wire it into the commission trigger.
-- The admin claims + payouts routes already INSERT with link= but the column was
-- missing, so those rows were silently dropped. This migration fixes that.

-- 1. Add link column
ALTER TABLE public.marketer_notifications
  ADD COLUMN IF NOT EXISTS link TEXT;

-- 2. Update auto_create_commission() to include link so bell can deep-link to /commissions.
--    Full function body reproduced from 20260828000002_fix_commission_plan_slugs.sql
--    with the notification INSERT updated.
CREATE OR REPLACE FUNCTION public.auto_create_commission()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mid        UUID;
  v_cfg        RECORD;
  v_amt        DECIMAL;
  v_plan_price DECIMAL;
BEGIN
  SELECT m.id INTO v_mid
  FROM brm_marketers m
  JOIN profiles p ON p.referred_by_marketer_id = m.id
  WHERE p.id = NEW.user_id AND m.status = 'active'
  LIMIT 1;

  IF v_mid IS NULL THEN RETURN NEW; END IF;

  v_plan_price := CASE NEW.plan
    WHEN 'naira' THEN 7000
    WHEN 'oga'   THEN 15000
    ELSE 0
  END;

  IF v_plan_price = 0 THEN RETURN NEW; END IF;

  SELECT * INTO v_cfg
  FROM marketer_commission_config
  WHERE type       = 'subscription'
    AND is_active  = true
    AND (plan = NEW.plan OR plan IS NULL)
  ORDER BY plan NULLS LAST
  LIMIT 1;

  IF v_cfg IS NULL THEN RETURN NEW; END IF;

  IF v_cfg.is_percentage THEN
    v_amt := v_plan_price * v_cfg.percentage;
  ELSE
    v_amt := v_cfg.amount;
  END IF;

  INSERT INTO marketer_commissions
    (marketer_id, business_id, config_id, type, amount, status, reference)
  VALUES
    (v_mid, NEW.user_id, v_cfg.id, 'subscription', v_amt, 'pending', NEW.id::TEXT);

  INSERT INTO marketer_notifications
    (marketer_id, type, title, message, link)
  VALUES (
    v_mid,
    'commission',
    'Commission Earned!',
    '₦' || v_amt::TEXT || ' commission for a ' || NEW.plan || ' subscription',
    '/commissions'
  );

  RETURN NEW;
END;
$$;

-- Re-apply security hardening (preserved from 20260701100000_fix_revoke_direct_grants.sql)
REVOKE EXECUTE ON FUNCTION public.auto_create_commission() FROM PUBLIC, anon, authenticated;

-- 3. Register migration
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261105000001', 'marketer_notifications_link')
ON CONFLICT (version) DO NOTHING;
