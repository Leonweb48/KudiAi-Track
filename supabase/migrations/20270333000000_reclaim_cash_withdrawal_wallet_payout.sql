-- One-off (2026-10-14, owner approved: "pull it back to the owner wallet"): take back the ONE wallet payout made for a
-- withdrawal the owner recorded as CASH before 20270332000000 (read-out: 1 payout, ₦4,825, 1 business). The client was
-- paid twice — cash by hand plus the same amount into their wallet — so the wallet copy goes back:
-- client wallet → business wallet, two 'ajo_reversal' ledger rows that point at the payout, plus an in-app notice
-- telling the client why.
--
-- Strict: if the live data isn't exactly one such payout of ₦4,825 for a cash withdrawal, or the client's wallet can't
-- cover it in full, or a wallet is closed/inactive, NOTHING moves (a notice says why). Any error inside the move is
-- caught and rolled back so this can never block the migration pipeline. Re-running is safe: a reclaimed payout has an
-- 'ajo_reversal' ledger row referencing it and is no longer selected.

DO $$
DECLARE
  c_expected_count CONSTANT int    := 1;
  c_expected_kobo  CONSTANT bigint := 482500;
  n      int := 0;
  total  bigint := 0;
  r      RECORD;
  v_ow   public.wallets;
  v_cw   public.wallets;
  v_ow_new bigint;
  v_cw_new bigint;
  v_biz  text;
BEGIN
  SELECT count(*), COALESCE(sum(p.amount_kobo), 0) INTO n, total
    FROM public.ajo_wallet_payouts p
    JOIN public.ajo_contributions w ON w.id = p.withdrawal_id AND w.type = 'withdrawal'
   WHERE p.request_id IS NULL AND p.status = 'paid'
     AND COALESCE(w.payment_method, 'cash') = 'cash'
     AND NOT EXISTS (SELECT 1 FROM public.wallet_ledger x WHERE x.reference = p.id::text AND x.source = 'ajo_reversal');

  IF n = 0 THEN
    RAISE NOTICE 'cash-payout-reclaim | nothing to take back (already done)';
    RETURN;
  END IF;
  IF n <> c_expected_count OR total <> c_expected_kobo THEN
    RAISE NOTICE 'cash-payout-reclaim | found % payout(s) totalling ₦% — not the approved % / ₦%; nothing moved',
      n, to_char(total / 100.0, 'FM999,999,990.00'), c_expected_count, to_char(c_expected_kobo / 100.0, 'FM999,999,990.00');
    RETURN;
  END IF;

  SELECT p.*, w.created_at AS wd_at,
         (SELECT full_name FROM public.aso_clients c WHERE c.id = p.client_id) AS client_name
    INTO r
    FROM public.ajo_wallet_payouts p
    JOIN public.ajo_contributions w ON w.id = p.withdrawal_id AND w.type = 'withdrawal'
   WHERE p.request_id IS NULL AND p.status = 'paid'
     AND COALESCE(w.payment_method, 'cash') = 'cash'
     AND NOT EXISTS (SELECT 1 FROM public.wallet_ledger x WHERE x.reference = p.id::text AND x.source = 'ajo_reversal');

  BEGIN
    -- lock both wallets in a fixed order
    SELECT * INTO v_ow FROM public.wallets WHERE user_id = r.owner_id;
    SELECT * INTO v_cw FROM public.wallets WHERE user_id = r.client_user_id;
    IF v_ow.id IS NULL OR v_cw.id IS NULL THEN
      RAISE NOTICE 'cash-payout-reclaim | a wallet is missing — nothing moved';
      RETURN;
    END IF;
    IF v_ow.id < v_cw.id THEN
      SELECT * INTO v_ow FROM public.wallets WHERE id = v_ow.id FOR UPDATE;
      SELECT * INTO v_cw FROM public.wallets WHERE id = v_cw.id FOR UPDATE;
    ELSE
      SELECT * INTO v_cw FROM public.wallets WHERE id = v_cw.id FOR UPDATE;
      SELECT * INTO v_ow FROM public.wallets WHERE id = v_ow.id FOR UPDATE;
    END IF;

    IF v_ow.status <> 'active' OR v_cw.status = 'closed' THEN
      RAISE NOTICE 'cash-payout-reclaim | business wallet inactive or client wallet closed — nothing moved';
      RETURN;
    END IF;
    IF v_cw.balance_kobo < r.amount_kobo THEN
      RAISE NOTICE 'cash-payout-reclaim | client wallet is ₦% short of the ₦% to take back — nothing moved',
        to_char((r.amount_kobo - v_cw.balance_kobo) / 100.0, 'FM999,999,990.00'), to_char(r.amount_kobo / 100.0, 'FM999,999,990.00');
      RETURN;
    END IF;

    SELECT COALESCE(NULLIF(business_name, ''), 'your savings collector') INTO v_biz FROM public.profiles WHERE id = r.owner_id;

    PERFORM set_config('kudi.allow_wallet_write', '1', true);
    v_cw_new := v_cw.balance_kobo - r.amount_kobo;
    v_ow_new := v_ow.balance_kobo + r.amount_kobo;
    UPDATE public.wallets SET balance_kobo = v_cw_new WHERE id = v_cw.id;
    UPDATE public.wallets SET balance_kobo = v_ow_new WHERE id = v_ow.id;
    INSERT INTO public.wallet_ledger (wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
                                      source, status, reference, narration, related_txn_id, meta)
    VALUES (v_cw.id, v_cw.user_id, 'debit', r.amount_kobo, v_cw_new, 'ajo_reversal', 'completed', r.id::text,
            'Withdrawal paid in cash — wallet copy taken back', r.withdrawal_id,
            jsonb_build_object('payout_id', r.id, 'reason', 'cash_withdrawal_double_paid'));
    INSERT INTO public.wallet_ledger (wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
                                      source, status, reference, narration, related_txn_id, meta)
    VALUES (v_ow.id, v_ow.user_id, 'credit', r.amount_kobo, v_ow_new, 'ajo_reversal', 'completed', r.id::text,
            'Cash withdrawal — returned from ' || COALESCE(NULLIF(r.client_name, ''), 'the client') || '''s wallet', r.withdrawal_id,
            jsonb_build_object('payout_id', r.id, 'reason', 'cash_withdrawal_double_paid'));

    INSERT INTO public.notifications (user_id, type, category, title, body, deep_link, priority, dedupe_key)
    VALUES (r.client_user_id, 'wallet_correction', 'money',
            '₦' || to_char(r.amount_kobo / 100.0, 'FM999,999,990.00') || ' taken back from your wallet',
            'Your savings withdrawal of ' || to_char(r.wd_at AT TIME ZONE 'Africa/Lagos', 'DD Mon YYYY') ||
            ' was paid to you in cash by ' || v_biz || ', and the same amount was also sent to your wallet by mistake. '
            || 'That wallet copy has been returned to ' || v_biz || '. Your savings balance is unchanged.',
            jsonb_build_object('tab', 'home'), 'high', 'cash_payout_reclaim_' || r.id::text);
    INSERT INTO public.notifications (user_id, type, category, title, body, deep_link, priority, dedupe_key)
    VALUES (r.owner_id, 'wallet_correction', 'money',
            '₦' || to_char(r.amount_kobo / 100.0, 'FM999,999,990.00') || ' returned to your wallet',
            'A cash withdrawal you recorded for ' || COALESCE(NULLIF(r.client_name, ''), 'a client') ||
            ' was also paid into their wallet by mistake. That amount is back in your wallet.',
            jsonb_build_object('tab', 'wallet'), 'normal', 'cash_payout_reclaim_owner_' || r.id::text);

    RAISE NOTICE 'cash-payout-reclaim | took back ₦% from the client''s wallet into the business wallet',
      to_char(r.amount_kobo / 100.0, 'FM999,999,990.00');
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'cash-payout-reclaim | refused by the database (%), nothing moved', SQLERRM;
  END;
END $$;
