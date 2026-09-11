-- ═════════════════════════════════════════════════════════════════════════════
-- Wallets for Ajo/Aso clients.
--
-- aso_clients.client_user_id is a real auth.users id (see aso_client_auth
-- migration), so the existing wallets/wallet_ledger schema — keyed only on
-- user_id — already works for a client's own session unmodified. This
-- migration adds:
--   1. 'ajo_contribution' as a valid wallet_ledger source
--   2. wallet_get_or_create_for(p_user_id) — service-role provisioning on
--      behalf of a client who has no session yet (owner opts them in while
--      adding them)
--   3. wallet_pay_ajo_contribution(...) — atomic: debit the client's own
--      wallet AND book the contribution (mirrors ajo_confirm_payment's
--      finalise logic — cycle-capacity guard, first-period commission fee,
--      aso_clients balance update), all in one transaction since there's no
--      external gateway to wait on.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. widen the ledger source check ────────────────────────────────────────
ALTER TABLE public.wallet_ledger DROP CONSTRAINT IF EXISTS wallet_ledger_source_check;
ALTER TABLE public.wallet_ledger ADD CONSTRAINT wallet_ledger_source_check
  CHECK (source IN (
    'topup','sale','bill_spend','bill_reversal',
    'withdrawal','withdrawal_reversal','adjustment',
    'ajo_contribution'));

-- ── 2. wallet_get_or_create_for — service-role, provision on someone's behalf ──
CREATE OR REPLACE FUNCTION public.wallet_get_or_create_for(p_user_id UUID)
RETURNS public.wallets LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.wallets;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'user id required'; END IF;

  SELECT * INTO v_row FROM public.wallets WHERE user_id = p_user_id;
  IF FOUND THEN RETURN v_row; END IF;

  PERFORM set_config('kudi.allow_wallet_write', '1', true);
  INSERT INTO public.wallets (user_id) VALUES (p_user_id)
  ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_get_or_create_for(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wallet_get_or_create_for(UUID) TO service_role;

-- ── 3. wallet_pay_ajo_contribution — client-callable ────────────────────────
-- Caller must be the client themselves (aso_clients.client_user_id = auth.uid()).
-- cycle_id/group_id are expected pre-resolved+validated by the caller (the
-- ajo-portal edge function mirrors initialize-payment's gates before calling
-- this) — this function's own cycle-capacity guard is defense in depth, same
-- as ajo_confirm_payment.
CREATE OR REPLACE FUNCTION public.wallet_pay_ajo_contribution(
  p_aso_client_id        UUID,
  p_amount_kobo          BIGINT,
  p_contribution_context TEXT DEFAULT 'personal_savings',
  p_group_id             UUID DEFAULT NULL,
  p_cycle_id             UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid            UUID := auth.uid();
  v_client         RECORD;
  v_wallet         public.wallets;
  v_new            BIGINT;
  v_contrib_id     UUID;
  v_amount         NUMERIC;
  v_cycle_id       UUID := p_cycle_id;
  v_cycle_fee      NUMERIC := 0;
  v_commission_id  UUID;
  v_cycle_expected NUMERIC := 0;
  v_commission_acc NUMERIC := 0;
  v_freq_days      INT;
  v_base_date      DATE;
  v_next_date      DATE;
  v_guard_cycle    RECORD;
  v_guard_sum      NUMERIC;
  v_guard_target   NUMERIC;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_amount_kobo IS NULL OR p_amount_kobo <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Enter an amount to contribute');
  END IF;

  SELECT * INTO v_client FROM public.aso_clients WHERE id = p_aso_client_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Client not found'); END IF;
  IF v_client.client_user_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Forbidden');
  END IF;

  v_amount := p_amount_kobo::numeric / 100;

  -- ── cycle-capacity guard — mirrors ajo_confirm_payment ────────────────────
  IF v_cycle_id IS NOT NULL THEN
    SELECT * INTO v_guard_cycle FROM public.ajo_cycles WHERE id = v_cycle_id;
    IF FOUND THEN
      IF v_guard_cycle.status IN ('completed', 'settled') THEN
        RETURN jsonb_build_object('ok', false, 'error', format(
          'The savings cycle "%s" is already complete.', COALESCE(v_guard_cycle.label, 'this cycle')));
      END IF;
      SELECT COALESCE(SUM(amount), 0) INTO v_guard_sum FROM public.ajo_contributions
       WHERE cycle_id = v_cycle_id AND type = 'contribution' AND status = 'completed';
      v_guard_target := v_guard_cycle.length_periods * v_guard_cycle.expected_amount_per_period;
      IF v_guard_target > 0 AND v_guard_sum >= v_guard_target THEN
        RETURN jsonb_build_object('ok', false, 'error', format(
          'The savings cycle "%s" is full — ₦%s target already reached.',
          COALESCE(v_guard_cycle.label, 'this cycle'), to_char(v_guard_target, 'FM999,999,990.00')));
      END IF;
    END IF;
  END IF;

  -- ── debit the client's own wallet ─────────────────────────────────────────
  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Activate your wallet first'); END IF;
  IF v_wallet.status <> 'active' THEN RETURN jsonb_build_object('ok', false, 'error', 'Wallet is not active'); END IF;
  IF v_wallet.balance_kobo < p_amount_kobo THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Insufficient wallet balance');
  END IF;

  PERFORM set_config('kudi.allow_wallet_write', '1', true);

  v_new := v_wallet.balance_kobo - p_amount_kobo;
  UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_wallet.id;

  -- ── book the contribution ──────────────────────────────────────────────────
  INSERT INTO public.ajo_contributions (
    aso_client_id, owner_id, amount, type, payment_method, status,
    notes, contribution_context, cycle_id, group_id, initiated_by, paid_at,
    payment_channel
  ) VALUES (
    p_aso_client_id, v_client.user_id, v_amount, 'contribution', 'wallet', 'completed',
    'Paid from KudiAI Wallet', p_contribution_context, v_cycle_id,
    CASE WHEN p_contribution_context <> 'personal_savings' THEN p_group_id ELSE NULL END,
    'client', now(), 'wallet'
  ) RETURNING id INTO v_contrib_id;

  INSERT INTO public.wallet_ledger (
    wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
    source, status, reference, narration, related_txn_id
  ) VALUES (
    v_wallet.id, v_uid, 'debit', p_amount_kobo, v_new,
    'ajo_contribution', 'completed', v_contrib_id::text, 'Ajo contribution', v_contrib_id
  );

  -- ── first-period commission fee (personal_savings only) — mirrors ajo_confirm_payment ──
  IF p_contribution_context = 'personal_savings' AND v_cycle_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.ajo_cycles cy
      WHERE cy.id = v_cycle_id AND cy.status = 'active' AND cy.commission_model = 'first_period'
    ) OR EXISTS (
      SELECT 1 FROM public.ajo_contributions fc
      WHERE fc.cycle_id = v_cycle_id AND fc.type = 'commission' AND fc.status = 'completed'
    ) THEN
      v_cycle_id := NULL;
    END IF;

    IF v_cycle_id IS NOT NULL THEN
      SELECT expected_amount_per_period, COALESCE(commission_balance, 0)
      INTO v_cycle_expected, v_commission_acc
      FROM public.ajo_cycles WHERE id = v_cycle_id;

      IF v_commission_acc = 0 AND v_amount > 0 THEN
        v_cycle_fee := LEAST(v_amount, v_cycle_expected);
        UPDATE public.ajo_cycles SET commission_balance = v_cycle_expected WHERE id = v_cycle_id;
        INSERT INTO public.ajo_contributions (
          aso_client_id, owner_id, amount, type,
          payment_method, status, notes,
          fee_for_contribution_id, paystack_status, contribution_context, cycle_id
        ) VALUES (
          p_aso_client_id, v_client.user_id, v_cycle_fee, 'commission',
          'wallet', 'completed', 'Collector''s fee — Day 1',
          v_contrib_id, 'completed', p_contribution_context, v_cycle_id
        )
        RETURNING id INTO v_commission_id;
      END IF;
    END IF;
  END IF;

  -- ── update the client's savings tally ───────────────────────────────────────
  v_freq_days := CASE COALESCE(v_client.contribution_frequency, 'monthly')
    WHEN 'daily'  THEN 1
    WHEN 'weekly' THEN 7
    ELSE 30
  END;
  v_base_date := COALESCE(v_client.next_contribution_date, CURRENT_DATE);
  v_next_date := v_base_date + v_freq_days;

  UPDATE public.aso_clients SET
    current_balance        = COALESCE(current_balance, 0) + v_amount - v_cycle_fee,
    total_saved             = COALESCE(total_saved, 0)     + v_amount,
    next_contribution_date = v_next_date
  WHERE id = p_aso_client_id;

  RETURN jsonb_build_object(
    'ok',                 true,
    'contribution_id',    v_contrib_id,
    'amount',             v_amount,
    'cycle_fee',          v_cycle_fee,
    'commission_id',      v_commission_id,
    'new_wallet_balance', v_new,
    'new_client_balance', COALESCE(v_client.current_balance, 0) + v_amount - v_cycle_fee
  );
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_pay_ajo_contribution(UUID, BIGINT, TEXT, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wallet_pay_ajo_contribution(UUID, BIGINT, TEXT, UUID, UUID) TO authenticated;
