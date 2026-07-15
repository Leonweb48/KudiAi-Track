-- Fix auto_create_commission() to use current plan slugs (kobo/naira/oga).
-- Old CASE used deactivated slugs (basic/professional/enterprise) so every
-- subscription since the plan rename silently produced no commission.
CREATE OR REPLACE FUNCTION auto_create_commission()
RETURNS TRIGGER AS $$
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
  WHERE type = 'subscription'
    AND is_active = true
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

  INSERT INTO marketer_notifications (marketer_id, type, title, message)
  VALUES (
    v_mid,
    'commission',
    'Commission Earned!',
    '₦' || v_amt::TEXT || ' commission for a ' || NEW.plan || ' subscription'
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Preserve security hardening from 20260630200000_fix_security_warnings.sql
ALTER FUNCTION public.auto_create_commission() SET search_path = public, pg_temp;
REVOKE EXECUTE ON FUNCTION public.auto_create_commission() FROM PUBLIC, anon, authenticated;
