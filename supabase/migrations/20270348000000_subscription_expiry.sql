-- ═════════════════════════════════════════════════════════════════════════════
-- Owner plans now END (2026-10-18, owner's decision: no auto-charge).
-- Until now nothing happened at a paid plan's end date: no renewal, no downgrade (only owners who had CANCELLED were
-- moved to Free, by the app), no reminders — 2 owners were on Premium up to 4 days past their end date.
--
-- Rules (hourly sweep):
--   • reminders 3 days and 1 day before expires_at (bell + phone, once each per period)
--   • at expires_at: 3-day grace (grace_until), paid features keep working, "your plan has ended" notice
--   • after grace_until: plan → Free ('kobo'), notice; data is untouched. Renewing = paying again (wallet_pay_subscription
--     sets a new expires_at, which clears grace and reminder marks).
--   • an owner who CANCELLED goes to Free at expires_at, no grace (as the app already did).
--   • owners already past their end date when this ships get their 3 days from today.
-- Also closes a hole: an owner's own login could UPDATE its subscription row's expires_at (e.g. to 2099) — the plan
-- write guard only checked plan/status. Now authenticated users can't change expires_at / grace on a paid plan.
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS grace_until      timestamptz,
  ADD COLUMN IF NOT EXISTS reminded_3d_for  timestamptz,   -- the expires_at value the 3-day reminder was sent for
  ADD COLUMN IF NOT EXISTS reminded_1d_for  timestamptz,
  ADD COLUMN IF NOT EXISTS ended_notice_for timestamptz;

-- ── 1. write guard: also protect the end date and grace on paid plans ─────────
CREATE OR REPLACE FUNCTION public.guard_subscription_plan_writes()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_role TEXT;
BEGIN
  v_role := COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');

  -- Only guard genuine end-user (authenticated) sessions. service_role, the
  -- SECURITY DEFINER approval RPCs (which set kudi.allow_plan_write), migrations,
  -- pg_cron and the dashboard all pass straight through.
  IF v_role <> 'authenticated'
     OR current_setting('kudi.allow_plan_write', true) = '1' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT public.is_free_plan(NEW.plan) THEN
      RAISE EXCEPTION 'Paid plans require admin approval — pay by bank transfer and wait for confirmation'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.grace_until IS NOT NULL THEN
      RAISE EXCEPTION 'Plan dates can only be changed by a payment' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: allow cancellation toggles and downgrades to a free plan; block any
  -- move to or between paid plans, and any paid re-activation.
  IF NEW.plan IS DISTINCT FROM OLD.plan AND NOT public.is_free_plan(NEW.plan) THEN
    RAISE EXCEPTION 'Plan upgrades require admin approval'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status = 'active'
     AND NOT public.is_free_plan(NEW.plan)
     AND OLD.status <> 'active' THEN
    RAISE EXCEPTION 'Plan activation requires admin approval'
      USING ERRCODE = 'check_violation';
  END IF;
  -- NEW: a paid plan's end date, grace and reminder marks are not the owner's to edit
  IF NOT public.is_free_plan(NEW.plan) AND (
       NEW.expires_at       IS DISTINCT FROM OLD.expires_at
    OR NEW.grace_until      IS DISTINCT FROM OLD.grace_until
    OR NEW.reminded_3d_for  IS DISTINCT FROM OLD.reminded_3d_for
    OR NEW.reminded_1d_for  IS DISTINCT FROM OLD.reminded_1d_for
    OR NEW.ended_notice_for IS DISTINCT FROM OLD.ended_notice_for) THEN
    RAISE EXCEPTION 'Plan dates can only be changed by a payment' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- ── 2. a new end date (renewal / new plan) starts a clean period ──────────────
CREATE OR REPLACE FUNCTION public.subscription_new_period_resets()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.plan IS DISTINCT FROM OLD.plan THEN
    IF NEW.expires_at IS NULL OR NEW.expires_at > now() OR public.is_free_plan(NEW.plan) THEN
      NEW.grace_until := NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_subscription_new_period ON public.subscriptions;
CREATE TRIGGER trg_subscription_new_period
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.subscription_new_period_resets();

-- ── 3. the sweep ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.subscription_expiry_note(p_user uuid, p_type text, p_title text, p_body text, p_dedupe text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO notifications (user_id, type, category, title, body, deep_link, priority, dedupe_key)
  VALUES (p_user, p_type, 'alert', p_title, p_body, jsonb_build_object('tab', 'home', 'openPlans', true), 'high', p_dedupe)
  ON CONFLICT (dedupe_key) WHERE read_at IS NULL AND dedupe_key IS NOT NULL DO NOTHING;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'subscription_expiry_note skipped: %', SQLERRM;   -- a notice must never block the sweep
END $$;

CREATE OR REPLACE FUNCTION public.subscription_expiry_sweep()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  v_name text;
  v_r3 int := 0; v_r1 int := 0; v_ended int := 0; v_free int := 0;
  fmt_d CONSTANT text := 'FMDD Mon YYYY';
BEGIN
  PERFORM set_config('kudi.allow_plan_write', '1', true);

  FOR r IN
    SELECT s.*, coalesce(p.name, initcap(s.plan)) AS plan_name
      FROM subscriptions s LEFT JOIN subscription_plans p ON p.slug = s.plan
     WHERE s.status = 'active' AND s.expires_at IS NOT NULL AND NOT public.is_free_plan(s.plan)
  LOOP
    v_name := r.plan_name;

    -- a) cancelled and over → Free now (no grace: the owner chose to stop)
    IF r.cancel_at_period_end AND r.expires_at <= now() THEN
      UPDATE subscriptions SET plan = 'kobo', expires_at = NULL, cancel_at_period_end = false, cancelled_at = NULL,
             grace_until = NULL WHERE id = r.id;
      PERFORM subscription_expiry_note(r.user_id, 'plan_downgraded', 'You''re now on the Free plan',
        format('Your %s plan ended on %s as you asked. Your records are all still here — renew any time to get the paid features back.',
               v_name, to_char(r.expires_at AT TIME ZONE 'Africa/Lagos', fmt_d)),
        'plan_free:' || r.id || ':' || extract(epoch FROM r.expires_at)::bigint);
      v_free := v_free + 1; CONTINUE;
    END IF;

    -- b) grace over → Free
    IF r.grace_until IS NOT NULL AND r.grace_until <= now() THEN
      UPDATE subscriptions SET plan = 'kobo', expires_at = NULL, cancel_at_period_end = false, cancelled_at = NULL,
             grace_until = NULL WHERE id = r.id;
      PERFORM subscription_expiry_note(r.user_id, 'plan_downgraded', 'You''re now on the Free plan',
        format('Your %s plan was not renewed, so your account moved to the Free plan. Your sales, stock and savings records are all still here — renew to get %s features back.',
               v_name, v_name),
        'plan_free:' || r.id || ':' || extract(epoch FROM r.expires_at)::bigint);
      v_free := v_free + 1; CONTINUE;
    END IF;

    -- c) just ended → start the 3-day grace, tell the owner once
    IF r.expires_at <= now() AND NOT r.cancel_at_period_end THEN
      IF r.grace_until IS NULL THEN
        UPDATE subscriptions SET grace_until = r.expires_at + interval '3 days' WHERE id = r.id;
        r.grace_until := r.expires_at + interval '3 days';
      END IF;
      IF r.ended_notice_for IS DISTINCT FROM r.expires_at THEN
        PERFORM subscription_expiry_note(r.user_id, 'plan_ended', format('Your %s plan has ended', v_name),
          format('Renew by %s to keep your %s features. After that your account moves to the Free plan — your records stay.',
                 to_char(r.grace_until AT TIME ZONE 'Africa/Lagos', fmt_d), v_name),
          'plan_ended:' || r.id || ':' || extract(epoch FROM r.expires_at)::bigint);
        UPDATE subscriptions SET ended_notice_for = r.expires_at WHERE id = r.id;
        v_ended := v_ended + 1;
      END IF;
      CONTINUE;
    END IF;

    -- d) 1 day before
    IF r.expires_at <= now() + interval '1 day' THEN
      IF r.reminded_1d_for IS DISTINCT FROM r.expires_at THEN
        PERFORM subscription_expiry_note(r.user_id, 'plan_ending', format('Your %s plan ends tomorrow', v_name),
          CASE WHEN r.cancel_at_period_end
            THEN format('Your %s plan ends on %s and you won''t be charged. Renew if you want to keep its features.', v_name, to_char(r.expires_at AT TIME ZONE 'Africa/Lagos', fmt_d))
            ELSE format('Your %s plan ends on %s. Plans don''t renew by themselves — renew now to keep your features.', v_name, to_char(r.expires_at AT TIME ZONE 'Africa/Lagos', fmt_d)) END,
          'plan_end_1d:' || r.id || ':' || extract(epoch FROM r.expires_at)::bigint);
        UPDATE subscriptions SET reminded_1d_for = r.expires_at, reminded_3d_for = r.expires_at WHERE id = r.id;
        v_r1 := v_r1 + 1;
      END IF;
      CONTINUE;
    END IF;

    -- e) 3 days before
    IF r.expires_at <= now() + interval '3 days' AND r.reminded_3d_for IS DISTINCT FROM r.expires_at THEN
      PERFORM subscription_expiry_note(r.user_id, 'plan_ending', format('Your %s plan ends in 3 days', v_name),
        format('Your %s plan ends on %s. Plans don''t renew by themselves — renew to keep your features without a break.',
               v_name, to_char(r.expires_at AT TIME ZONE 'Africa/Lagos', fmt_d)),
        'plan_end_3d:' || r.id || ':' || extract(epoch FROM r.expires_at)::bigint);
      UPDATE subscriptions SET reminded_3d_for = r.expires_at WHERE id = r.id;
      v_r3 := v_r3 + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('reminded_3d', v_r3, 'reminded_1d', v_r1, 'ended', v_ended, 'moved_to_free', v_free);
END $$;

REVOKE ALL ON FUNCTION public.subscription_expiry_sweep()                               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.subscription_expiry_note(uuid, text, text, text, text)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.subscription_new_period_resets()                          FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_expiry_sweep() TO service_role;

-- ── 4. owners already past their end date: their 3 days start today ──────────
UPDATE public.subscriptions
   SET grace_until = now() + interval '3 days'
 WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= now()
   AND NOT coalesce(cancel_at_period_end, false) AND NOT public.is_free_plan(plan) AND grace_until IS NULL;

-- ── 4b. renewing early keeps the days left (body otherwise unchanged from 20270112000000) ─────────────────────────
CREATE OR REPLACE FUNCTION public.wallet_pay_subscription(
  p_plan_slug     TEXT,
  p_billing_cycle TEXT DEFAULT 'monthly',
  p_coupon_code   TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_cycle     TEXT := CASE WHEN p_billing_cycle = 'yearly' THEN 'yearly' ELSE 'monthly' END;
  v_plan_name TEXT;
  v_price     NUMERIC;
  v_val       JSONB;
  v_final     NUMERIC;
  v_discount  NUMERIC := 0;
  v_kobo      BIGINT;
  v_wallet    public.wallets;
  v_ledger    public.wallet_ledger;
  v_ledger_id UUID := NULL;
  v_new       BIGINT;
  v_existing  UUID;
  v_expires   TIMESTAMPTZ;
  v_cur_end   TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF public.is_free_plan(p_plan_slug) THEN
    RAISE EXCEPTION 'Use activate_free_subscription for free plans';
  END IF;

  PERFORM public.assert_downgrade_allowed(v_uid, p_plan_slug);

  SELECT name, CASE WHEN v_cycle = 'yearly' THEN price_yearly ELSE price_monthly END
    INTO v_plan_name, v_price
  FROM public.subscription_plans WHERE slug = p_plan_slug AND is_active;
  IF v_price IS NULL OR v_price <= 0 THEN
    RAISE EXCEPTION 'Unknown or inactive plan: %', p_plan_slug;
  END IF;

  -- Canonical, server-computed price — never trust a client-supplied amount.
  v_final := v_price;
  IF p_coupon_code IS NOT NULL AND p_coupon_code <> '' THEN
    v_val := public.validate_coupon(p_coupon_code, p_plan_slug, v_cycle, v_price);
    IF NOT COALESCE((v_val ->> 'valid')::boolean, false) THEN
      RAISE EXCEPTION '%', COALESCE(v_val ->> 'message', 'Coupon not accepted');
    END IF;
    v_discount := COALESCE((v_val ->> 'discount_amount')::numeric, 0);
    v_final    := COALESCE((v_val ->> 'final_amount')::numeric, v_price);
  END IF;

  v_kobo := ROUND(v_final * 100);

  -- A coupon can fully cover the price — skip the wallet debit entirely.
  IF v_kobo > 0 THEN
    PERFORM set_config('kudi.allow_wallet_write', '1', true);

    SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_uid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'No wallet — activate your wallet first'; END IF;
    IF v_wallet.status <> 'active' THEN RAISE EXCEPTION 'Wallet is not active'; END IF;
    IF v_wallet.balance_kobo < v_kobo THEN
      RAISE EXCEPTION 'Insufficient wallet balance' USING ERRCODE = 'check_violation';
    END IF;

    v_new := v_wallet.balance_kobo - v_kobo;
    UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_wallet.id;

    INSERT INTO public.wallet_ledger (
      wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
      source, status, narration
    ) VALUES (
      v_wallet.id, v_uid, 'debit', v_kobo, v_new,
      'subscription_spend', 'completed',
      format('Plan upgrade — %s (%s)', COALESCE(v_plan_name, p_plan_slug), v_cycle)
    ) RETURNING * INTO v_ledger;

    v_ledger_id := v_ledger.id;
  END IF;

  -- Best-effort redemption record — must never block activation.
  IF p_coupon_code IS NOT NULL AND p_coupon_code <> '' THEN
    BEGIN
      PERFORM public.redeem_coupon(
        p_coupon_code, p_plan_slug, v_cycle, v_price, v_discount, v_final,
        COALESCE(v_ledger_id::text, ''));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'redeem_coupon failed for %: %', p_coupon_code, SQLERRM;
    END;
  END IF;

  -- Renewing the SAME plan before it ends adds the new period on top of the current end date (before 2026-10-18 the
  -- days left were lost: the new end was always counted from today). A different plan starts today, as before.
  SELECT expires_at INTO v_cur_end FROM public.subscriptions
   WHERE user_id = v_uid AND status = 'active' AND plan = p_plan_slug AND expires_at > now()
   ORDER BY created_at DESC LIMIT 1;
  v_expires := COALESCE(v_cur_end, now()) + (CASE WHEN v_cycle = 'yearly' THEN interval '365 days' ELSE interval '30 days' END);
  PERFORM set_config('kudi.allow_plan_write', '1', true);

  SELECT id INTO v_existing FROM public.subscriptions
   WHERE user_id = v_uid
   ORDER BY (status = 'active') DESC, created_at DESC
   LIMIT 1;

  IF v_existing IS NOT NULL THEN
    UPDATE public.subscriptions SET
      plan = p_plan_slug, status = 'active', paystack_reference = NULL,
      wallet_ledger_id = v_ledger_id,
      expires_at = v_expires, billing_cycle = v_cycle,
      cancel_at_period_end = false, cancelled_at = NULL
    WHERE id = v_existing;
  ELSE
    INSERT INTO public.subscriptions(user_id, plan, status, wallet_ledger_id, expires_at, billing_cycle)
    VALUES (v_uid, p_plan_slug, 'active', v_ledger_id, v_expires, v_cycle);
  END IF;

  RETURN jsonb_build_object(
    'ok',               true,
    'plan_slug',        p_plan_slug,
    'plan_name',        v_plan_name,
    'billing_cycle',    v_cycle,
    'amount_charged',   v_final,
    'expires_at',       v_expires,
    'wallet_ledger_id', v_ledger_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_pay_subscription(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wallet_pay_subscription(TEXT, TEXT, TEXT) TO authenticated;

-- ── 5. schedule (hourly) + run once now ───────────────────────────────────────
DO $$
BEGIN
  PERFORM cron.unschedule('subscription-expiry-sweep') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'subscription-expiry-sweep');
  PERFORM cron.schedule('subscription-expiry-sweep', '7 * * * *', 'SELECT public.subscription_expiry_sweep();');
  RAISE NOTICE 'subscription expiry: first sweep %', public.subscription_expiry_sweep();
END $$;
