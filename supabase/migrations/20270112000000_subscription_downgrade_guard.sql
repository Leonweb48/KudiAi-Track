-- ═════════════════════════════════════════════════════════════════════════════
-- Plan changes (upgrade or downgrade) executed silently and instantly with no
-- confirmation or result screen — this migration adds the server-side half of
-- the fix: a downgrade to a lower-tier plan (free or a cheaper paid tier) is
-- now rejected while the owner's current paid period is still active. They
-- can still upgrade at any time (unaffected). This has to be enforced here,
-- not just hidden in the UI, since activate_free_subscription and
-- wallet_pay_subscription are both callable directly.
--
-- Once the current plan's expires_at has passed (or there's no active paid
-- plan at all), a "downgrade" is just a normal plan change and goes through
-- the same instant paths as any other switch — there's no separate scheduling
-- mechanism, matching how this app already handles subscriptions elsewhere:
-- no auto-renewal, no auto-expiry sweep, everything the owner does is an
-- explicit, immediate action.
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.assert_downgrade_allowed(p_uid UUID, p_target_slug TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_target_sort INT;
  v_cur_plan    TEXT;
  v_cur_expires TIMESTAMPTZ;
  v_cur_sort    INT;
BEGIN
  SELECT sort_order INTO v_target_sort FROM public.subscription_plans WHERE slug = p_target_slug;

  SELECT plan, expires_at INTO v_cur_plan, v_cur_expires
  FROM public.subscriptions WHERE user_id = p_uid AND status = 'active'
  ORDER BY created_at DESC LIMIT 1;

  IF v_cur_plan IS NULL THEN RETURN; END IF;

  SELECT sort_order INTO v_cur_sort FROM public.subscription_plans WHERE slug = v_cur_plan;

  IF COALESCE(v_target_sort, 0) < COALESCE(v_cur_sort, 0)
     AND v_cur_expires IS NOT NULL AND v_cur_expires > now() THEN
    RAISE EXCEPTION 'You can switch to a lower plan once your current plan ends on %',
      to_char(v_cur_expires, 'DD Mon YYYY') USING ERRCODE = 'check_violation';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_downgrade_allowed(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.assert_downgrade_allowed(UUID, TEXT) TO service_role;

-- ── activate_free_subscription — add the guard, body otherwise unchanged ─────
CREATE OR REPLACE FUNCTION public.activate_free_subscription(p_plan_slug TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_existing UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_free_plan(p_plan_slug) THEN
    RAISE EXCEPTION 'activate_free_subscription only accepts free plans (got %)', p_plan_slug;
  END IF;

  PERFORM public.assert_downgrade_allowed(v_uid, p_plan_slug);

  PERFORM set_config('kudi.allow_plan_write', '1', true);

  SELECT id INTO v_existing FROM public.subscriptions
   WHERE user_id = v_uid
   ORDER BY (status = 'active') DESC, created_at DESC
   LIMIT 1;

  IF v_existing IS NOT NULL THEN
    UPDATE public.subscriptions SET
      plan = p_plan_slug, status = 'active', expires_at = NULL,
      cancel_at_period_end = false, cancelled_at = NULL
    WHERE id = v_existing;
  ELSE
    INSERT INTO public.subscriptions(user_id, plan, status, billing_cycle)
    VALUES (v_uid, p_plan_slug, 'active', 'monthly');
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.activate_free_subscription(TEXT) TO authenticated;

-- ── wallet_pay_subscription — add the guard, body otherwise unchanged ────────
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

  v_expires := now() + (CASE WHEN v_cycle = 'yearly' THEN interval '365 days' ELSE interval '30 days' END);
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
GRANT EXECUTE ON FUNCTION public.wallet_pay_subscription(TEXT, TEXT, TEXT) TO authenticated;
