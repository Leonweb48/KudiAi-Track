-- ═════════════════════════════════════════════════════════════════════════════
-- Owner subscription payments move from Paystack bank-transfer + admin approval
-- to an instant debit from the owner's own KudiAI wallet.
--
-- Unlike Bills, a subscription payment has no external fulfilment step that can
-- fail after the money moves — so debit and plan-activation happen in ONE
-- atomic RPC, no hold/settle pair needed. Wallet debit is itself real-time,
-- server-verified proof of payment, so this activates the plan immediately
-- (no admin_approval_requests row, unlike the bank-transfer flow it replaces).
--
-- admin_approval_requests / submit_subscription_upgrade_request /
-- execute_subscription_upgrade are left in place (not dropped) — anything that
-- still reads them (historical rows, an admin dashboard view, the unrelated
-- downgrade-between-paid-tiers path) keeps working. The owner-facing paid
-- flow simply stops creating new subscription_upgrade requests.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. Widen wallet_ledger.source to accept subscription payments ────────────
-- wallet_ledger_source_check has been redefined by several migrations since
-- it was first declared (sale, ajo_*, transfer_fee, cbn_levy, wallet_fee all
-- came later) — this carries the full live list forward plus the two new
-- values, same drop-and-recreate convention every prior widening used.
ALTER TABLE public.wallet_ledger DROP CONSTRAINT IF EXISTS wallet_ledger_source_check;
ALTER TABLE public.wallet_ledger ADD CONSTRAINT wallet_ledger_source_check
  CHECK (source IN (
    'topup','sale','bill_spend','bill_reversal',
    'withdrawal','withdrawal_reversal','adjustment',
    'ajo_contribution','ajo_collection','ajo_payout',
    'transfer_fee','cbn_levy','wallet_fee',
    'subscription_spend','subscription_reversal'
  ));

-- ── 2. Trace a subscription row back to the wallet debit that paid for it ────
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS wallet_ledger_id UUID REFERENCES public.wallet_ledger(id);

-- ── 3. wallet_pay_subscription — owner-callable, debit + activate atomically ─
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

-- ── 4. wallet_reverse_subscription — service-role only (support/admin refund) ─
-- Parity with wallet_reverse_bill and the Paystack "refund" action this change
-- retires. Not wired into any UI here — a self-contained capability for
-- support tooling to call later if an erroneous charge needs undoing.
CREATE OR REPLACE FUNCTION public.wallet_reverse_subscription(
  p_ledger_id UUID,
  p_reason    TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row    public.wallet_ledger;
  v_wallet public.wallets;
  v_new    BIGINT;
BEGIN
  SELECT * INTO v_row FROM public.wallet_ledger WHERE id = p_ledger_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ledger row not found'; END IF;
  IF v_row.source <> 'subscription_spend' THEN RAISE EXCEPTION 'Not a subscription debit'; END IF;
  IF v_row.status = 'reversed' THEN RETURN; END IF;   -- idempotent

  PERFORM set_config('kudi.allow_wallet_write', '1', true);

  SELECT * INTO v_wallet FROM public.wallets WHERE id = v_row.wallet_id FOR UPDATE;
  v_new := v_wallet.balance_kobo + v_row.amount_kobo;
  UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_wallet.id;

  UPDATE public.wallet_ledger SET status = 'reversed' WHERE id = p_ledger_id;

  INSERT INTO public.wallet_ledger (
    wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
    source, status, reference, narration, meta
  ) VALUES (
    v_wallet.id, v_row.user_id, 'credit', v_row.amount_kobo, v_new,
    'subscription_reversal', 'completed', v_row.reference,
    COALESCE(p_reason, 'Subscription payment refunded to wallet'),
    jsonb_build_object('reversed_ledger_id', p_ledger_id)
  );

  -- The plan this payment activated is being refunded — drop back to free.
  PERFORM set_config('kudi.allow_plan_write', '1', true);
  UPDATE public.subscriptions SET
    plan = 'kobo', status = 'active', expires_at = NULL,
    cancel_at_period_end = false, cancelled_at = NULL
  WHERE wallet_ledger_id = p_ledger_id;
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_reverse_subscription(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wallet_reverse_subscription(UUID, TEXT) TO service_role;
