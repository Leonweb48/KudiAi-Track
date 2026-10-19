-- Owner's decision 2026-10-19: a wallet-to-wallet payment goes ahead only if the sender's balance covers the amount
-- PLUS the ₦10 Charge fee (20270359). Before, the fee was taken after the payment and silently skipped when the
-- balance was short — paying your whole balance made the move free.
--
-- wallet_move_fee_due(payer, amount) = the fee this move will be charged (same rule as the callers' fee blocks), and
-- the three balance checks now add it (edited in place, one condition + message each; stops if the text isn't found):
--   wallet_pay_ajo_contribution   — a client paying savings from their wallet
--   peer_esusu_pay_contribution   — a member paying into a savings circle
--   ajo_wallet_payout_now_check   — a business approving a client's withdrawal into the client's wallet

CREATE OR REPLACE FUNCTION public.wallet_move_fee_due(p_payer uuid, p_amount_kobo bigint)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- the callers charge when the count (which then includes this move) is > 3; before the move it is one lower
  SELECT CASE WHEN public.wallet_daily_transfer_count(p_payer) + 1 > 3 THEN public.wallet_transfer_fee_kobo(p_amount_kobo) ELSE 0 END;
$$;
REVOKE ALL ON FUNCTION public.wallet_move_fee_due(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_move_fee_due(uuid, bigint) TO service_role;

DO $mig$
DECLARE
  v_def text; n int; f text;
  -- client / circle payments: same condition and message in both functions
  c_old constant text := 'IF v_wallet.balance_kobo < p_amount_kobo THEN';
  c_new constant text := 'IF v_wallet.balance_kobo < p_amount_kobo + public.wallet_move_fee_due(v_uid, p_amount_kobo) THEN   -- amount + Charge fee (2026-10-19)';
  m_old constant text := '''error'', ''Insufficient wallet balance'', ''code'', ''insufficient_balance''';
  m_new constant text := '''error'', format(''Not enough in your wallet — you need ₦%s (₦%s + ₦%s charge fee).'', '
    || 'to_char((p_amount_kobo + public.wallet_move_fee_due(v_uid, p_amount_kobo)) / 100.0, ''FM999,999,990.00''), '
    || 'to_char(p_amount_kobo / 100.0, ''FM999,999,990.00''), to_char(public.wallet_move_fee_due(v_uid, p_amount_kobo) / 100.0, ''FM999,999,990.00'')), '
    || '''code'', ''insufficient_balance''';
BEGIN
  FOREACH f IN ARRAY ARRAY['wallet_pay_ajo_contribution', 'peer_esusu_pay_contribution'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = f;
    IF v_def IS NULL THEN RAISE EXCEPTION '% not found', f; END IF;
    IF position('amount + Charge fee (2026-10-19)' IN v_def) > 0 THEN RAISE NOTICE 'charge-fee-covered | % already applied', f; CONTINUE; END IF;
    IF position('wallet_daily_transfer_count(v_uid)' IN v_def) = 0 THEN RAISE EXCEPTION '% does not charge the fee to v_uid — refusing to guess', f; END IF;
    n := (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old);
    IF n <> 1 THEN RAISE EXCEPTION '%: balance check found % times — refusing to guess', f, n; END IF;
    n := (length(v_def) - length(replace(v_def, m_old, ''))) / length(m_old);
    IF n <> 1 THEN RAISE EXCEPTION '%: insufficient-balance message found % times — refusing to guess', f, n; END IF;
    EXECUTE replace(replace(v_def, c_old, c_new), m_old, m_new);
    RAISE NOTICE 'charge-fee-covered | % applied', f;
  END LOOP;
END $mig$;

DO $mig2$
DECLARE
  v_def text; n int;
  c_old constant text := 'IF v_bal < NEW.amount_kobo THEN';
  c_new constant text := 'IF v_bal < NEW.amount_kobo + public.wallet_move_fee_due(NEW.owner_id, NEW.amount_kobo) THEN   -- payout + Charge fee (2026-10-19)';
  a_old constant text := 'is ₦%. Top up your wallet, then approve again.''';
  a_new constant text := 'is ₦% including the ₦10 charge fee. Top up your wallet, then approve again.''';
  b_old constant text := 'to_char(NEW.amount_kobo / 100.0, ''FM999,999,999,990.00'');';
  b_new constant text := 'to_char((NEW.amount_kobo + public.wallet_move_fee_due(NEW.owner_id, NEW.amount_kobo)) / 100.0, ''FM999,999,999,990.00'');';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'ajo_wallet_payout_now_check';
  IF v_def IS NULL THEN RAISE EXCEPTION 'ajo_wallet_payout_now_check not found'; END IF;
  IF position('payout + Charge fee (2026-10-19)' IN v_def) > 0 THEN RAISE NOTICE 'charge-fee-covered | payout check already applied'; RETURN; END IF;
  FOREACH n IN ARRAY ARRAY[1, 2, 3] LOOP
    IF (length(v_def) - length(replace(v_def, (ARRAY[c_old, a_old, b_old])[n], ''))) / length((ARRAY[c_old, a_old, b_old])[n]) <> 1 THEN
      RAISE EXCEPTION 'ajo_wallet_payout_now_check: piece % not found exactly once — refusing to guess', n;
    END IF;
  END LOOP;
  EXECUTE replace(replace(replace(v_def, c_old, c_new), a_old, a_new), b_old, b_new);
  RAISE NOTICE 'charge-fee-covered | payout approval check applied';
END $mig2$;

-- the in-place edits keep each function's grants; restate them
REVOKE ALL ON FUNCTION public.ajo_wallet_payout_now_check() FROM PUBLIC, anon, authenticated;
