-- ROLLBACK PROBE v2 — persists nothing (each check aborts its own sub-transaction).
-- Re-runs the checks that could not complete the first time: the cash-book copy
-- clashed on the unique client_txn_id, the debt_payments table has no rows to
-- copy (so a payment is inserted against an existing credit instead), and the Ajo
-- re-stamp is re-tested after its fix.
DO $$
DECLARE
  v_ref text; v_bal numeric; v_prev numeric; v_found jsonb; v_src record; v_new_id uuid; v_bal2 numeric; v_total numeric; v_paid numeric;
BEGIN
  -- 1. transactions ----------------------------------------------------------------------
  BEGIN
    SELECT t.id, t.user_id INTO v_src FROM public.transactions t ORDER BY t.created_at DESC LIMIT 1;
    v_new_id := gen_random_uuid();
    SELECT COALESCE(SUM(CASE WHEN COALESCE(payment_type,'') = 'credit' THEN 0 WHEN type = 'in' THEN amount ELSE -amount END), 0)
      INTO v_prev FROM public.transactions WHERE user_id = v_src.user_id;
    INSERT INTO public.transactions
      SELECT (jsonb_populate_record(NULL::public.transactions,
               (to_jsonb(t) - 'receipt_ref' - 'balance_after' - 'client_txn_id')
               || jsonb_build_object('id', v_new_id, 'created_at', now(), 'type', 'in', 'amount', 100, 'payment_type', 'cash'))).*
        FROM public.transactions t WHERE t.id = v_src.id;
    SELECT receipt_ref, balance_after INTO v_ref, v_bal FROM public.transactions WHERE id = v_new_id;
    v_found := public.verify_receipt(v_ref);
    RAISE EXCEPTION 'PROBE_RESULT transactions: ref=% balance_after=% (business position before = %, so expected %) | verify_receipt=%',
      v_ref, v_bal, v_prev, v_prev + 100, v_found::text;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '%', SQLERRM;
  END;

  -- 2. debt_payments: a repayment against an existing credit ------------------------------
  BEGIN
    SELECT c.id AS credit_id, c.user_id AS owner_id, COALESCE(c.total_amount,0) + COALESCE(c.interest_amount,0) AS total
      INTO v_src FROM public.credits c ORDER BY c.created_at DESC LIMIT 1;
    IF v_src.credit_id IS NULL THEN RAISE EXCEPTION 'PROBE_RESULT debt_payments: (no credits exist to pay against)'; END IF;
    v_new_id := gen_random_uuid();
    SELECT COALESCE(SUM(amount),0) INTO v_paid FROM public.debt_payments WHERE credit_id = v_src.credit_id;
    INSERT INTO public.debt_payments (id, credit_id, owner_id, amount, payment_method) VALUES (v_new_id, v_src.credit_id, v_src.owner_id, 10, 'cash');
    SELECT receipt_ref, balance_after INTO v_ref, v_bal FROM public.debt_payments WHERE id = v_new_id;
    RAISE EXCEPTION 'PROBE_RESULT debt_payments: ref=% balance_after=% (credit total % - already paid % - 10 = %)',
      v_ref, v_bal, v_src.total, v_paid, GREATEST(v_src.total - v_paid - 10, 0);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '%', SQLERRM;
  END;

  -- 3. ajo_contributions, re-stamp after the fix -----------------------------------------
  BEGIN
    SELECT a.id, a.aso_client_id INTO v_src FROM public.ajo_contributions a ORDER BY a.created_at DESC LIMIT 1;
    v_new_id := gen_random_uuid();
    INSERT INTO public.ajo_contributions
      SELECT (jsonb_populate_record(NULL::public.ajo_contributions,
               (to_jsonb(a) - 'receipt_ref' - 'balance_after') || jsonb_build_object('id', v_new_id, 'created_at', now()))).*
        FROM public.ajo_contributions a WHERE a.id = v_src.id;
    SELECT receipt_ref, balance_after INTO v_ref, v_bal FROM public.ajo_contributions WHERE id = v_new_id;
    UPDATE public.aso_clients SET current_balance = COALESCE(current_balance, 0) + 500 WHERE id = v_src.aso_client_id;
    SELECT balance_after INTO v_bal2 FROM public.ajo_contributions WHERE id = v_new_id;
    RAISE EXCEPTION 'PROBE_RESULT ajo_contributions: ref=% balance_after_at_insert=% -> re-stamped to % (client balance is now %)',
      v_ref, v_bal, v_bal2, (SELECT current_balance FROM public.aso_clients WHERE id = v_src.aso_client_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '%', SQLERRM;
  END;

  RAISE NOTICE 'registry size after probes: % (must still be 380 — probes leave no trace)', (SELECT count(*) FROM public.receipt_references);
END
$$;
