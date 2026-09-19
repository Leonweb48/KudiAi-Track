-- ROLLBACK PROBE — persists nothing.
-- Each check inserts a COPY of a real row inside a sub-transaction, reads back what
-- the new triggers produced, then raises an exception so PostgreSQL discards the
-- insert (and the registry row) again. Proves, on the live schema, that new rows
-- get a stored reference and a balance-after at write time.
DO $$
DECLARE
  v_ref text; v_bal numeric; v_prev numeric; v_amount numeric; v_found jsonb; v_dup int;
  v_src record; v_new_id uuid; v_uid uuid; v_client uuid; v_bal2 numeric;
BEGIN
  -- 1. transactions: reference + cash-book running balance --------------------------------
  BEGIN
    SELECT t.id, t.user_id INTO v_src FROM public.transactions t ORDER BY t.created_at DESC LIMIT 1;
    v_new_id := gen_random_uuid();
    SELECT COALESCE(SUM(CASE WHEN COALESCE(payment_type,'') = 'credit' THEN 0 WHEN type = 'in' THEN amount ELSE -amount END), 0)
      INTO v_prev FROM public.transactions WHERE user_id = v_src.user_id;
    INSERT INTO public.transactions
      SELECT (jsonb_populate_record(NULL::public.transactions,
               (to_jsonb(t) - 'receipt_ref' - 'balance_after') || jsonb_build_object('id', v_new_id, 'created_at', now(), 'type', 'in', 'amount', 100, 'payment_type', 'cash'))).*
        FROM public.transactions t WHERE t.id = v_src.id;
    SELECT receipt_ref, balance_after INTO v_ref, v_bal FROM public.transactions WHERE id = v_new_id;
    v_found := public.verify_receipt(v_ref);
    RAISE EXCEPTION 'PROBE_RESULT transactions: ref=% balance_after=% (expected previous % + 100 = %) verify_receipt=%',
      v_ref, v_bal, v_prev, v_prev + 100, v_found::text;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '%', SQLERRM;
  END;

  -- 2. debt_payments: reference + what the debtor still owes ---------------------------
  BEGIN
    SELECT d.id, d.credit_id INTO v_src FROM public.debt_payments d ORDER BY d.created_at DESC LIMIT 1;
    IF v_src.id IS NULL THEN RAISE EXCEPTION 'PROBE_RESULT debt_payments: (no rows to copy)'; END IF;
    v_new_id := gen_random_uuid();
    INSERT INTO public.debt_payments
      SELECT (jsonb_populate_record(NULL::public.debt_payments,
               (to_jsonb(d) - 'receipt_ref' - 'balance_after') || jsonb_build_object('id', v_new_id, 'created_at', now(), 'amount', 10))).*
        FROM public.debt_payments d WHERE d.id = v_src.id;
    SELECT receipt_ref, balance_after INTO v_ref, v_bal FROM public.debt_payments WHERE id = v_new_id;
    RAISE EXCEPTION 'PROBE_RESULT debt_payments: ref=% balance_after=% (debtor still owes)', v_ref, v_bal;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '%', SQLERRM;
  END;

  -- 3. ajo_contributions: reference + client balance, incl. the re-stamp when the balance moves --
  BEGIN
    SELECT a.id, a.aso_client_id INTO v_src FROM public.ajo_contributions a ORDER BY a.created_at DESC LIMIT 1;
    IF v_src.id IS NULL THEN RAISE EXCEPTION 'PROBE_RESULT ajo_contributions: (no rows to copy)'; END IF;
    v_new_id := gen_random_uuid();
    INSERT INTO public.ajo_contributions
      SELECT (jsonb_populate_record(NULL::public.ajo_contributions,
               (to_jsonb(a) - 'receipt_ref' - 'balance_after') || jsonb_build_object('id', v_new_id, 'created_at', now()))).*
        FROM public.ajo_contributions a WHERE a.id = v_src.id;
    SELECT receipt_ref, balance_after INTO v_ref, v_bal FROM public.ajo_contributions WHERE id = v_new_id;
    UPDATE public.aso_clients SET current_balance = COALESCE(current_balance, 0) + 500 WHERE id = v_src.aso_client_id;
    SELECT balance_after INTO v_bal2 FROM public.ajo_contributions WHERE id = v_new_id;
    RAISE EXCEPTION 'PROBE_RESULT ajo_contributions: ref=% balance_after_at_insert=% after the client balance moved (+500) it was re-stamped to % (expected %)',
      v_ref, v_bal, v_bal2, (SELECT current_balance FROM public.aso_clients WHERE id = v_src.aso_client_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '%', SQLERRM;
  END;

  -- 4. Uniqueness across everything, and nothing leaked from the probes ----------------------
  SELECT count(*) INTO v_dup FROM (SELECT ref FROM public.receipt_references GROUP BY ref HAVING count(*) > 1) x;
  RAISE NOTICE 'registry duplicates: % (must be 0); registry size after probes: % (was 380 — probes must leave no trace)', v_dup, (SELECT count(*) FROM public.receipt_references);
  RAISE NOTICE 'public.verify_receipt(''not-a-ref'') = %', public.verify_receipt('not-a-ref')::text;
END
$$;
