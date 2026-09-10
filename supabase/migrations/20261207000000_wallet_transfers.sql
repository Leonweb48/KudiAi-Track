-- ═════════════════════════════════════════════════════════════════════════════
-- Send money from the wallet to any bank account (Flutterwave direct-transfers).
--
-- Same machinery as "withdraw to bank": funds held → admin approval → payout.
-- Adds a free-text narration and an optional "record as a business expense" flag
-- that, once the payout succeeds, writes a matching transactions row (type 'out',
-- category 'expense', payment_type 'wallet') so the books and the wallet agree.
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.wallet_withdrawals
  ADD COLUMN IF NOT EXISTS narration    TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS book_expense BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS txn_id       UUID;

-- ── wallet_submit_withdrawal — now takes narration + book_expense ──────────
DROP FUNCTION IF EXISTS public.wallet_submit_withdrawal(BIGINT, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.wallet_submit_withdrawal(
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
  v_business  TEXT;
  v_req_id    UUID;
  v_wd_id     UUID;
  v_today_out BIGINT;
  v_narr      TEXT := COALESCE(NULLIF(trim(p_narration), ''), 'Transfer to bank');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_amount_kobo IS NULL OR p_amount_kobo <= 0 THEN RAISE EXCEPTION 'Invalid amount'; END IF;
  IF COALESCE(p_bank_code,'') = '' OR COALESCE(p_account_number,'') = '' THEN
    RAISE EXCEPTION 'Bank and account number are required';
  END IF;
  IF p_amount_kobo > public.wallet_cfg('wallet_max_withdrawal_kobo', 5000000) THEN
    RAISE EXCEPTION 'Amount exceeds the per-transfer limit';
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
    RAISE EXCEPTION 'Daily transfer limit reached';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.admin_approval_requests
    WHERE requester = v_uid AND request_type = 'wallet_withdrawal' AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'You already have a transfer awaiting approval';
  END IF;

  v_new := v_wallet.balance_kobo - p_amount_kobo;
  UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_wallet.id;

  INSERT INTO public.wallet_ledger (
    wallet_id, user_id, direction, amount_kobo, balance_after_kobo, source, status, narration
  ) VALUES (
    v_wallet.id, v_uid, 'debit', p_amount_kobo, v_new, 'withdrawal', 'pending',
    v_narr || ' — awaiting admin approval'
  ) RETURNING * INTO v_ledger;

  INSERT INTO public.wallet_withdrawals (
    wallet_id, user_id, amount_kobo, bank_code, account_number, account_name,
    status, ledger_id, narration, book_expense
  ) VALUES (
    v_wallet.id, v_uid, p_amount_kobo, p_bank_code, p_account_number, p_account_name,
    'pending', v_ledger.id, v_narr, COALESCE(p_book_expense, false)
  ) RETURNING id INTO v_wd_id;

  SELECT business_name INTO v_business FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.admin_approval_requests(
    request_type, requester, business, target_id, payload, reason, status
  ) VALUES (
    'wallet_withdrawal', v_uid, COALESCE(v_business, ''), v_wd_id,
    jsonb_build_object(
      'withdrawal_id',  v_wd_id,
      'ledger_id',      v_ledger.id,
      'amount_kobo',    p_amount_kobo,
      'bank_code',      p_bank_code,
      'account_number', p_account_number,
      'account_name',   p_account_name,
      'narration',      v_narr,
      'book_expense',   COALESCE(p_book_expense, false),
      'submitted_at',   now()
    ),
    v_narr || ' — awaiting admin approval',
    'pending'
  ) RETURNING id INTO v_req_id;

  UPDATE public.wallet_withdrawals SET approval_request_id = v_req_id WHERE id = v_wd_id;
  RETURN v_req_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.wallet_submit_withdrawal(BIGINT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;

-- ── wallet_mark_withdrawal — book the expense once the payout succeeds ────
CREATE OR REPLACE FUNCTION public.wallet_mark_withdrawal(p_flw_transfer_id TEXT, p_status TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wd     public.wallet_withdrawals%ROWTYPE;
  v_wallet public.wallets;
  v_new    BIGINT;
  v_txn_id UUID;
BEGIN
  SELECT * INTO v_wd FROM public.wallet_withdrawals WHERE flw_transfer_id = p_flw_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE WARNING 'wallet_mark_withdrawal: no withdrawal for %', p_flw_transfer_id; RETURN; END IF;

  PERFORM set_config('kudi.allow_wallet_write', '1', true);

  IF p_status = 'successful' AND v_wd.status <> 'successful' THEN
    UPDATE public.wallet_withdrawals SET status = 'successful', updated_at = now() WHERE id = v_wd.id;
    UPDATE public.wallet_ledger SET status = 'completed' WHERE id = v_wd.ledger_id AND status = 'pending';

    IF v_wd.book_expense AND v_wd.txn_id IS NULL THEN
      INSERT INTO public.transactions (
        user_id, type, category, amount, customer_name, payment_type, note,
        transaction_date, client_txn_id
      ) VALUES (
        v_wd.user_id, 'out', 'expense', (v_wd.amount_kobo::numeric / 100),
        NULLIF(v_wd.account_name, ''), 'wallet',
        COALESCE(NULLIF(v_wd.narration, ''), 'Wallet transfer'),
        current_date, v_wd.id
      )
      ON CONFLICT (client_txn_id) DO NOTHING
      RETURNING id INTO v_txn_id;
      IF v_txn_id IS NULL THEN
        SELECT id INTO v_txn_id FROM public.transactions WHERE client_txn_id = v_wd.id;
      END IF;
      UPDATE public.wallet_withdrawals SET txn_id = v_txn_id WHERE id = v_wd.id;
      UPDATE public.wallet_ledger SET related_txn_id = v_txn_id WHERE id = v_wd.ledger_id;
    END IF;

  ELSIF p_status IN ('failed','reversed') AND v_wd.status NOT IN ('failed','reversed') THEN
    SELECT * INTO v_wallet FROM public.wallets WHERE id = v_wd.wallet_id FOR UPDATE;
    v_new := v_wallet.balance_kobo + v_wd.amount_kobo;
    UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_wallet.id;
    UPDATE public.wallet_ledger SET status = 'reversed' WHERE id = v_wd.ledger_id;
    INSERT INTO public.wallet_ledger (
      wallet_id, user_id, direction, amount_kobo, balance_after_kobo, source, status, narration
    ) VALUES (
      v_wallet.id, v_wd.user_id, 'credit', v_wd.amount_kobo, v_new,
      'withdrawal_reversal', 'completed', 'Transfer failed — refunded to wallet'
    );
    UPDATE public.wallet_withdrawals SET status = p_status, updated_at = now() WHERE id = v_wd.id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_mark_withdrawal(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wallet_mark_withdrawal(TEXT, TEXT) TO service_role;

-- ── reconcile: wallet transfer debits booked as expense vs the expense rows ─
CREATE OR REPLACE FUNCTION public.wallet_transfers_reconcile()
RETURNS TABLE (user_id UUID, wallet_expense_kobo BIGINT, booked_expense_kobo BIGINT, drift_kobo BIGINT)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH w AS (
    SELECT wd.user_id, COALESCE(SUM(wd.amount_kobo),0) AS k
    FROM public.wallet_withdrawals wd
    WHERE wd.book_expense AND wd.status = 'successful'
    GROUP BY wd.user_id
  ), t AS (
    SELECT user_id, COALESCE(SUM(round(amount * 100)),0)::bigint AS k
    FROM public.transactions
    WHERE payment_type = 'wallet' AND type = 'out' AND category = 'expense'
    GROUP BY user_id
  )
  SELECT COALESCE(w.user_id, t.user_id), COALESCE(w.k,0), COALESCE(t.k,0),
         COALESCE(w.k,0) - COALESCE(t.k,0)
  FROM w FULL OUTER JOIN t ON w.user_id = t.user_id;
$$;
REVOKE ALL ON FUNCTION public.wallet_transfers_reconcile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wallet_transfers_reconcile() TO service_role;
