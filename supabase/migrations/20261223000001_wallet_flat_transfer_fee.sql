-- Fee model overhaul, replacing the ₦50-at-₦10k CBN levy with:
--   - Zero fee, ever, on deposits (topups) — full gross amount always credited.
--   - A flat ₦10 fee (under ₦10,000) or ₦50 (at/above ₦10,000) on any OUTGOING
--     transfer — wallet-to-bank withdrawal OR wallet-to-wallet internal move
--     (ajo contribution/payout) — added on top of the amount, never
--     subtracted from what the destination receives. Still gated behind the
--     existing "first 3 free transfers/day" quota (wallet_daily_transfer_count,
--     unchanged).
--   - External transfers used to also charge the real Flutterwave transfer fee
--     as a SEPARATE debit on top of the CBN levy; that's now folded into the
--     single flat fee below — the client sees exactly one fee line per transfer.

-- ── New unified fee calculator, replacing wallet_cbn_levy_kobo ──────────────

CREATE OR REPLACE FUNCTION public.wallet_transfer_fee_kobo(p_amount_kobo bigint)
 RETURNS bigint
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE WHEN COALESCE(p_amount_kobo, 0) >= 1000000 THEN 5000 ELSE 1000 END;
$function$;

-- ── wallet_credit: deposits are now unconditionally fee-free ────────────────

CREATE OR REPLACE FUNCTION public.wallet_credit(p_user_id uuid, p_amount_kobo bigint, p_source text, p_flw_reference text, p_narration text DEFAULT NULL::text, p_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS wallet_ledger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_wallet public.wallets;
  v_row    public.wallet_ledger;
  v_new    BIGINT;
BEGIN
  IF p_amount_kobo IS NULL OR p_amount_kobo <= 0 THEN
    RAISE EXCEPTION 'credit amount must be positive';
  END IF;

  -- idempotency: return the existing row if this reference was already credited
  IF p_flw_reference IS NOT NULL THEN
    SELECT * INTO v_row FROM public.wallet_ledger
     WHERE source = p_source AND flw_reference = p_flw_reference;
    IF FOUND THEN RETURN v_row; END IF;
  END IF;

  PERFORM set_config('kudi.allow_wallet_write', '1', true);

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.wallets (user_id) VALUES (p_user_id) RETURNING * INTO v_wallet;
  END IF;

  v_new := v_wallet.balance_kobo + p_amount_kobo;

  -- Insert the ledger row first. If a concurrent call already credited this
  -- reference the partial unique index rejects it → no row back → do NOT touch
  -- the balance again, just return the row that won.
  IF p_flw_reference IS NOT NULL THEN
    INSERT INTO public.wallet_ledger (
      wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
      source, status, flw_reference, narration, meta
    ) VALUES (
      v_wallet.id, p_user_id, 'credit', p_amount_kobo, v_new,
      p_source, 'completed', p_flw_reference, p_narration, COALESCE(p_meta, '{}'::jsonb)
    )
    ON CONFLICT (source, flw_reference) WHERE flw_reference IS NOT NULL DO NOTHING
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
      SELECT * INTO v_row FROM public.wallet_ledger
       WHERE source = p_source AND flw_reference = p_flw_reference;
      RETURN v_row;
    END IF;
  ELSE
    INSERT INTO public.wallet_ledger (
      wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
      source, status, flw_reference, narration, meta
    ) VALUES (
      v_wallet.id, p_user_id, 'credit', p_amount_kobo, v_new,
      p_source, 'completed', NULL, p_narration, COALESCE(p_meta, '{}'::jsonb)
    )
    RETURNING * INTO v_row;
  END IF;

  UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_wallet.id;

  RETURN v_row;
END;
$function$;

-- ── wallet_transfer_sent: one flat fee replaces the FLW-passthrough + levy pair ─

CREATE OR REPLACE FUNCTION public.wallet_transfer_sent(p_withdrawal_id uuid, p_flw_transfer_id text, p_fee_kobo bigint DEFAULT 0)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_wd     public.wallet_withdrawals%ROWTYPE;
  v_wallet public.wallets;
  v_new    BIGINT;
  v_fee    BIGINT;
  v_free   BOOLEAN;
BEGIN
  PERFORM set_config('kudi.allow_wallet_write', '1', true);
  UPDATE public.wallet_withdrawals SET
    status = 'processing',
    flw_transfer_id = COALESCE(p_flw_transfer_id, flw_transfer_id),
    fee_kobo = COALESCE(NULLIF(p_fee_kobo, 0), fee_kobo),
    updated_at = now()
  WHERE id = p_withdrawal_id
  RETURNING * INTO v_wd;

  IF NOT FOUND THEN RETURN; END IF;

  -- The withdrawal's own debit row (source='withdrawal') was already inserted
  -- by wallet_hold_transfer before this function ever runs, so this count
  -- already includes the current transfer.
  v_free := public.wallet_daily_transfer_count(v_wd.user_id) <= 3;

  -- ── Flat outgoing-transfer fee (₦10 under ₦10,000, ₦50 at/above), charged to
  --    the same wallet, best-effort — only once the day's first 3 free
  --    transfers are used. This is a single additional debit on top of the
  --    transfer amount already held; the destination still receives the full
  --    amount requested. Best-effort: skipped, never blocking or reversing an
  --    already-successful transfer, if the remaining balance can't cover it. ──
  IF NOT v_free THEN
    v_fee := public.wallet_transfer_fee_kobo(v_wd.amount_kobo);
    IF v_fee > 0 THEN
      SELECT * INTO v_wallet FROM public.wallets WHERE id = v_wd.wallet_id FOR UPDATE;
      IF FOUND AND v_wallet.balance_kobo >= v_fee THEN
        v_new := v_wallet.balance_kobo - v_fee;
        UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_wallet.id;
        INSERT INTO public.wallet_ledger (
          wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
          source, status, reference, narration, related_txn_id
        ) VALUES (
          v_wallet.id, v_wd.user_id, 'debit', v_fee, v_new,
          'transfer_fee', 'completed', p_withdrawal_id::text,
          'Transfer fee', p_withdrawal_id
        );
        PERFORM public.wallet_credit_settlement(v_fee, 'transfer_fee',
          'Transfer fee — withdrawal ' || p_withdrawal_id::text, p_withdrawal_id);
      END IF;
    END IF;
  END IF;
END;
$function$;

-- ── wallet_pay_ajo_contribution: swap levy calculator, same 'wallet_fee' label ─

CREATE OR REPLACE FUNCTION public.wallet_pay_ajo_contribution(p_aso_client_id uuid, p_amount_kobo bigint, p_contribution_context text DEFAULT 'personal_savings'::text, p_group_id uuid DEFAULT NULL::uuid, p_cycle_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid            UUID := auth.uid();
  v_client         RECORD;
  v_wallet         public.wallets;
  v_owner_wallet   public.wallets;
  v_new            BIGINT;
  v_owner_new      BIGINT;
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
  -- daily-free-transfer fee
  v_wfee           BIGINT;
  v_wfee_new       BIGINT;
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
    RETURN jsonb_build_object('ok', false, 'error', 'Insufficient wallet balance', 'code', 'insufficient_balance');
  END IF;

  PERFORM set_config('kudi.allow_wallet_write', '1', true);

  v_new := v_wallet.balance_kobo - p_amount_kobo;
  UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_wallet.id;

  -- ── credit the owner's wallet — real money, same collection account every
  --    client pays into by default. Provisioned if the owner somehow doesn't
  --    have one yet. ──
  SELECT * INTO v_owner_wallet FROM public.wallets WHERE user_id = v_client.user_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.wallets (user_id) VALUES (v_client.user_id)
    ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
    RETURNING * INTO v_owner_wallet;
  END IF;
  v_owner_new := v_owner_wallet.balance_kobo + p_amount_kobo;
  UPDATE public.wallets SET balance_kobo = v_owner_new WHERE id = v_owner_wallet.id;

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

  INSERT INTO public.wallet_ledger (
    wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
    source, status, reference, narration, related_txn_id
  ) VALUES (
    v_owner_wallet.id, v_client.user_id, 'credit', p_amount_kobo, v_owner_new,
    'ajo_collection', 'completed', v_contrib_id::text,
    'Ajo contribution — ' || COALESCE(NULLIF(v_client.full_name, ''), 'a client'), v_contrib_id
  );

  -- ── daily-free-transfer wallet fee — first 3 qualifying transfers/day
  --    (shared with external transfers) are free; from the 4th, a flat ₦10
  --    (under ₦10,000) or ₦50 (at/above), booked as a platform 'wallet_fee'
  --    (not a real bank cost — this transfer never touches a bank). ──
  IF public.wallet_daily_transfer_count(v_uid) > 3 THEN
    v_wfee := public.wallet_transfer_fee_kobo(p_amount_kobo);
    IF v_wfee > 0 THEN
      SELECT * INTO v_wallet FROM public.wallets WHERE id = v_wallet.id FOR UPDATE;
      IF v_wallet.balance_kobo >= v_wfee THEN
        v_wfee_new := v_wallet.balance_kobo - v_wfee;
        UPDATE public.wallets SET balance_kobo = v_wfee_new WHERE id = v_wallet.id;
        INSERT INTO public.wallet_ledger (
          wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
          source, status, reference, narration, related_txn_id
        ) VALUES (
          v_wallet.id, v_uid, 'debit', v_wfee, v_wfee_new,
          'wallet_fee', 'completed', v_contrib_id::text,
          'Wallet transfer fee (daily free transfers used)', v_contrib_id
        );
        PERFORM public.wallet_credit_settlement(v_wfee, 'wallet_fee',
          'Wallet fee — contribution ' || v_contrib_id::text, v_contrib_id);
      END IF;
    END IF;
  END IF;

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
$function$;

-- ── ajo_settle_due_wallet_payouts: swap levy calculator, same 'wallet_fee' label ─

CREATE OR REPLACE FUNCTION public.ajo_settle_due_wallet_payouts()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row            RECORD;
  v_owner_wallet   public.wallets;
  v_client_wallet  public.wallets;
  v_owner_new      BIGINT;
  v_client_new     BIGINT;
  v_owner_ledger   UUID;
  v_client_ledger  UUID;
  -- daily-free-transfer fee
  v_wfee           BIGINT;
  v_wfee_new       BIGINT;
BEGIN
  IF NOT public.ajo_is_business_day(CURRENT_DATE) THEN
    RETURN;
  END IF;

  FOR v_row IN
    SELECT * FROM public.ajo_wallet_payouts
    WHERE status = 'pending' AND scheduled_date <= CURRENT_DATE
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      SELECT * INTO v_owner_wallet FROM public.wallets WHERE user_id = v_row.owner_id FOR UPDATE;
      IF NOT FOUND OR v_owner_wallet.status <> 'active' OR v_owner_wallet.balance_kobo < v_row.amount_kobo THEN
        UPDATE public.ajo_wallet_payouts
        SET status = 'failed', failure_reason = 'Owner wallet balance insufficient at settlement time'
        WHERE id = v_row.id;
        CONTINUE;
      END IF;

      SELECT * INTO v_client_wallet FROM public.wallets WHERE user_id = v_row.client_user_id FOR UPDATE;
      IF NOT FOUND THEN
        PERFORM set_config('kudi.allow_wallet_write', '1', true);
        INSERT INTO public.wallets (user_id) VALUES (v_row.client_user_id)
        ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
        RETURNING * INTO v_client_wallet;
      END IF;

      PERFORM set_config('kudi.allow_wallet_write', '1', true);
      v_owner_new  := v_owner_wallet.balance_kobo  - v_row.amount_kobo;
      v_client_new := v_client_wallet.balance_kobo + v_row.amount_kobo;

      UPDATE public.wallets SET balance_kobo = v_owner_new  WHERE id = v_owner_wallet.id;
      UPDATE public.wallets SET balance_kobo = v_client_new WHERE id = v_client_wallet.id;

      INSERT INTO public.wallet_ledger (
        wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
        source, status, reference, narration, related_txn_id
      ) VALUES (
        v_owner_wallet.id, v_row.owner_id, 'debit', v_row.amount_kobo, v_owner_new,
        'ajo_payout', 'completed', v_row.id::text, 'Ajo withdrawal payout', v_row.withdrawal_id
      ) RETURNING id INTO v_owner_ledger;

      INSERT INTO public.wallet_ledger (
        wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
        source, status, reference, narration, related_txn_id
      ) VALUES (
        v_client_wallet.id, v_row.client_user_id, 'credit', v_row.amount_kobo, v_client_new,
        'ajo_payout', 'completed', v_row.id::text, 'Ajo withdrawal payout', v_row.withdrawal_id
      ) RETURNING id INTO v_client_ledger;

      -- ── daily-free-transfer wallet fee, charged to the OWNER (whose wallet
      --    funds the payout) — same shared quota, same best-effort. ──
      IF public.wallet_daily_transfer_count(v_row.owner_id) > 3 THEN
        v_wfee := public.wallet_transfer_fee_kobo(v_row.amount_kobo);
        IF v_wfee > 0 THEN
          SELECT * INTO v_owner_wallet FROM public.wallets WHERE id = v_owner_wallet.id FOR UPDATE;
          IF v_owner_wallet.balance_kobo >= v_wfee THEN
            v_wfee_new := v_owner_wallet.balance_kobo - v_wfee;
            UPDATE public.wallets SET balance_kobo = v_wfee_new WHERE id = v_owner_wallet.id;
            INSERT INTO public.wallet_ledger (
              wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
              source, status, reference, narration, related_txn_id
            ) VALUES (
              v_owner_wallet.id, v_row.owner_id, 'debit', v_wfee, v_wfee_new,
              'wallet_fee', 'completed', v_row.id::text,
              'Wallet transfer fee (daily free transfers used)', v_row.withdrawal_id
            );
            PERFORM public.wallet_credit_settlement(v_wfee, 'wallet_fee',
              'Wallet fee — payout ' || v_row.id::text, v_row.withdrawal_id);
          END IF;
        END IF;
      END IF;

      UPDATE public.ajo_wallet_payouts
      SET status = 'paid', paid_at = now(), owner_ledger_id = v_owner_ledger, client_ledger_id = v_client_ledger
      WHERE id = v_row.id;

    EXCEPTION WHEN OTHERS THEN
      UPDATE public.ajo_wallet_payouts
      SET status = 'failed', failure_reason = SQLERRM
      WHERE id = v_row.id;
    END;
  END LOOP;
END;
$function$;

-- ── Retire the old levy calculator — nothing calls it after the above ───────
DROP FUNCTION IF EXISTS public.wallet_cbn_levy_kobo(bigint);
