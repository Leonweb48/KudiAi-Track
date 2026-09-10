-- ═════════════════════════════════════════════════════════════════════════════
-- Activate a PAID plan instantly when a coupon covers 100% of its price.
--
-- Before this, SubscriptionPlan handled a fully-discounted paid plan by calling
-- activate_free_subscription(), which only accepts free slugs and so quietly
-- dropped the owner onto "kobo". This RPC activates the plan the owner actually
-- chose, after confirming the coupon is valid and brings the price to ₦0.
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.activate_coupon_subscription(
  p_plan_slug     TEXT,
  p_coupon_code   TEXT,
  p_billing_cycle TEXT DEFAULT 'monthly'
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_price    NUMERIC;
  v_val      JSONB;
  v_final    NUMERIC;
  v_existing UUID;
  v_expires  TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF public.is_free_plan(p_plan_slug) THEN
    RAISE EXCEPTION 'Use activate_free_subscription for free plans';
  END IF;

  SELECT CASE WHEN p_billing_cycle = 'yearly' THEN price_yearly ELSE price_monthly END
    INTO v_price
  FROM public.subscription_plans WHERE slug = p_plan_slug AND is_active;
  IF v_price IS NULL OR v_price <= 0 THEN
    RAISE EXCEPTION 'Unknown or inactive plan: %', p_plan_slug;
  END IF;

  -- Coupon must be valid for this plan/cycle AND bring the total to zero.
  v_val := public.validate_coupon(p_coupon_code, p_plan_slug, p_billing_cycle, v_price);
  IF NOT COALESCE((v_val ->> 'valid')::boolean, false) THEN
    RAISE EXCEPTION '%', COALESCE(v_val ->> 'message', 'Coupon not accepted');
  END IF;
  v_final := COALESCE((v_val ->> 'final_amount')::numeric, v_price);
  IF v_final > 0 THEN
    RAISE EXCEPTION 'This coupon does not fully cover % (₦% still due) — payment is required', p_plan_slug, v_final;
  END IF;

  -- Record the redemption (best-effort; a failure here must not block activation).
  BEGIN
    PERFORM public.redeem_coupon(p_coupon_code, p_plan_slug, p_billing_cycle, v_price, v_price, 0, '');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'redeem_coupon failed for %: %', p_coupon_code, SQLERRM;
  END;

  v_expires := now() + (CASE WHEN p_billing_cycle = 'yearly' THEN interval '365 days' ELSE interval '30 days' END);
  PERFORM set_config('kudi.allow_plan_write', '1', true);

  SELECT id INTO v_existing FROM public.subscriptions
   WHERE user_id = v_uid
   ORDER BY (status = 'active') DESC, created_at DESC
   LIMIT 1;

  IF v_existing IS NOT NULL THEN
    UPDATE public.subscriptions SET
      plan = p_plan_slug, status = 'active', paystack_reference = NULL,
      expires_at = v_expires, billing_cycle = p_billing_cycle,
      cancel_at_period_end = false, cancelled_at = NULL
    WHERE id = v_existing;
  ELSE
    INSERT INTO public.subscriptions(user_id, plan, status, expires_at, billing_cycle)
    VALUES (v_uid, p_plan_slug, 'active', v_expires, p_billing_cycle);
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.activate_coupon_subscription(TEXT, TEXT, TEXT) TO authenticated;
