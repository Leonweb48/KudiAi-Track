-- ═════════════════════════════════════════════════════════════════════════════
-- Instant wallet transfers — no admin approval.
--
-- The owner confirms with their transaction PIN and the payout runs immediately
-- (Flutterwave direct-transfers). Guardrails: per-transfer cap + daily cap,
-- unchanged. wallet_mark_withdrawal (webhook) still completes the ledger row and
-- books the expense on success, or refunds the hold on failure/reversal.
--
-- Also resolves any transfer left waiting on the retired approval flow.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. hold funds for a transfer (owner-callable) ──────────────────────────
CREATE OR REPLACE FUNCTION public.wallet_hold_transfer(
  p_amount_kobo    BIGINT,
  p_bank_code      TEXT,
  p_account_number TEXT,
  p_account_name   TEXT    DEFAULT NULL,
  p_narration      TEXT    DEFAULT '',
  p_book_expense   BOOLEAN DEFAULT false
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_wallet    public.wallets;
  v_ledger    public.wallet_ledger;
  v_new       BIGINT;
  v_wd_id     UUID;
  v_today_out BIGINT;
  v_narr      TEXT := COALESCE(NULLIF(trim(p_narration), ''), 'Transfer to bank');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_amount_kobo IS NULL OR p_amount_kobo < 10000 THEN RAISE EXCEPTION 'Minimum transfer is ₦100'; END IF;
  IF COALESCE(p_bank_code,'') = '' OR COALESCE(p_account_number,'') = '' THEN
    RAISE EXCEPTION 'Bank and account number are required';
  END IF;
  IF p_amount_kobo > public.wallet_cfg('wallet_max_withdrawal_kobo', 5000000) THEN
    RAISE EXCEPTION 'That is above your per-transfer limit';
  END IF;

  PERFORM set_config('kudi.allow_wallet_write', '1', true);

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No wallet'; END IF;
  IF v_wallet.balance_kobo < p_amount_kobo THEN
    RAISE EXCEPTION 'Insufficient wallet balance' USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(SUM(amount_kobo), 0) INTO v_today_out
  FROM public.wallet_ledger
  WHERE user_id = v_uid AND source = 'withdrawal'
    AND status IN ('pending','completed')
    AND created_at >= date_trunc('day', now());
  IF v_today_out + p_amount_kobo > public.wallet_cfg('wallet_daily_withdrawal_cap_kobo', 10000000) THEN
    RAISE EXCEPTION 'You have reached today''s transfer limit';
  END IF;

  v_new := v_wallet.balance_kobo - p_amount_kobo;
  UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_wallet.id;

  INSERT INTO public.wallet_ledger (
    wallet_id, user_id, direction, amount_kobo, balance_after_kobo, source, status, narration
  ) VALUES (
    v_wallet.id, v_uid, 'debit', p_amount_kobo, v_new, 'withdrawal', 'pending', v_narr
  ) RETURNING * INTO v_ledger;

  INSERT INTO public.wallet_withdrawals (
    wallet_id, user_id, amount_kobo, bank_code, account_number, account_name,
    status, ledger_id, narration, book_expense
  ) VALUES (
    v_wallet.id, v_uid, p_amount_kobo, p_bank_code, p_account_number, p_account_name,
    'processing', v_ledger.id, v_narr, COALESCE(p_book_expense, false)
  ) RETURNING id INTO v_wd_id;

  RETURN v_wd_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.wallet_hold_transfer(BIGINT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;

-- ── 2. transfer accepted by Flutterwave (service-role) ─────────────────────
CREATE OR REPLACE FUNCTION public.wallet_transfer_sent(
  p_withdrawal_id UUID, p_flw_transfer_id TEXT, p_fee_kobo BIGINT DEFAULT 0
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('kudi.allow_wallet_write', '1', true);
  UPDATE public.wallet_withdrawals SET
    status = 'processing',
    flw_transfer_id = COALESCE(p_flw_transfer_id, flw_transfer_id),
    fee_kobo = COALESCE(NULLIF(p_fee_kobo, 0), fee_kobo),
    updated_at = now()
  WHERE id = p_withdrawal_id;
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_transfer_sent(UUID, TEXT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wallet_transfer_sent(UUID, TEXT, BIGINT) TO service_role;

-- ── 3. transfer rejected by Flutterwave → refund the hold (service-role) ───
CREATE OR REPLACE FUNCTION public.wallet_transfer_failed(
  p_withdrawal_id UUID, p_reason TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wd     public.wallet_withdrawals%ROWTYPE;
  v_wallet public.wallets;
  v_new    BIGINT;
BEGIN
  SELECT * INTO v_wd FROM public.wallet_withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND OR v_wd.status IN ('failed','reversed','successful') THEN RETURN; END IF;

  PERFORM set_config('kudi.allow_wallet_write', '1', true);

  SELECT * INTO v_wallet FROM public.wallets WHERE id = v_wd.wallet_id FOR UPDATE;
  v_new := v_wallet.balance_kobo + v_wd.amount_kobo;
  UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_wallet.id;
  UPDATE public.wallet_ledger SET status = 'reversed' WHERE id = v_wd.ledger_id;
  INSERT INTO public.wallet_ledger (
    wallet_id, user_id, direction, amount_kobo, balance_after_kobo, source, status, narration
  ) VALUES (
    v_wallet.id, v_wd.user_id, 'credit', v_wd.amount_kobo, v_new,
    'withdrawal_reversal', 'completed', COALESCE(p_reason, 'Transfer could not be completed — refunded')
  );
  UPDATE public.wallet_withdrawals SET status = 'failed', updated_at = now() WHERE id = v_wd.id;
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_transfer_failed(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wallet_transfer_failed(UUID, TEXT) TO service_role;

-- ── 4. resolve transfers stuck on the retired approval flow ────────────────
DO $$
DECLARE r RECORD;
BEGIN
  PERFORM set_config('kudi.allow_wallet_write', '1', true);
  FOR r IN
    SELECT wd.* FROM public.wallet_withdrawals wd
    WHERE wd.status = 'pending'
  LOOP
    -- refund the held amount
    UPDATE public.wallets SET balance_kobo = balance_kobo + r.amount_kobo WHERE id = r.wallet_id;
    UPDATE public.wallet_ledger SET status = 'reversed' WHERE id = r.ledger_id;
    INSERT INTO public.wallet_ledger (
      wallet_id, user_id, direction, amount_kobo, balance_after_kobo, source, status, narration
    )
    SELECT r.wallet_id, r.user_id, 'credit', r.amount_kobo, w.balance_kobo,
           'withdrawal_reversal', 'completed', 'Transfer cancelled — refunded'
    FROM public.wallets w WHERE w.id = r.wallet_id;
    UPDATE public.wallet_withdrawals SET status = 'failed', updated_at = now() WHERE id = r.id;
  END LOOP;

  UPDATE public.admin_approval_requests
     SET status = 'cancelled', decided_at = now(),
         decision_note = 'Wallet transfers are now instant — no approval needed'
   WHERE request_type = 'wallet_withdrawal' AND status = 'pending';
END $$;
