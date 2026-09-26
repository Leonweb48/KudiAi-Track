-- READ-ONLY diagnostic (no writes): what does a stored deposit webhook actually carry about the SENDER's bank?
--
-- Receipts are getting the sending/receiving bank and its logo. For money going out we already know the bank (the user
-- picks it). For a deposit the only thing stored today is originator_name, so before capturing the sender's bank we
-- need to know which field Flutterwave really uses. This prints JSON KEY NAMES only — plus, for keys whose name
-- mentions a bank, the distinct values when they are short and are not account numbers (bank names / bank codes are
-- public information). No names, account numbers, amounts or timestamps are printed.
-- Read with:  gh run view <id> --log | grep NOTICE
DO $$
DECLARE r record;
BEGIN
  BEGIN
    RAISE NOTICE 'charge.completed events=% transfer.* events=% topup ledger rows=% (with meta.originator=%)',
      (SELECT count(*) FROM public.wallet_webhook_log WHERE event = 'charge.completed'),
      (SELECT count(*) FROM public.wallet_webhook_log WHERE event LIKE 'transfer.%'),
      (SELECT count(*) FROM public.wallet_ledger WHERE source = 'topup'),
      (SELECT count(*) FROM public.wallet_ledger WHERE source = 'topup' AND COALESCE(meta ->> 'originator', '') <> '');
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'counts failed: %', SQLERRM; END;

  BEGIN
    RAISE NOTICE '── charge.completed: keys of data.payment_method.bank_transfer ──';
    FOR r IN
      SELECT k AS key, count(*) AS n
        FROM public.wallet_webhook_log l,
             LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(l.payload -> 'data' -> 'payment_method' -> 'bank_transfer') = 'object'
                                            THEN l.payload -> 'data' -> 'payment_method' -> 'bank_transfer' ELSE '{}'::jsonb END) AS k
       WHERE l.event = 'charge.completed'
       GROUP BY 1 ORDER BY 2 DESC, 1
    LOOP RAISE NOTICE 'bank_transfer.% (in % events)', r.key, r.n; END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'bank_transfer keys failed: %', SQLERRM; END;

  BEGIN
    RAISE NOTICE '── charge.completed: keys of data and data.payment_method ──';
    FOR r IN
      SELECT 'data' AS scope, k AS key, count(*) AS n
        FROM public.wallet_webhook_log l,
             LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(l.payload -> 'data') = 'object' THEN l.payload -> 'data' ELSE '{}'::jsonb END) AS k
       WHERE l.event = 'charge.completed' GROUP BY 1, 2
      UNION ALL
      SELECT 'payment_method', k, count(*)
        FROM public.wallet_webhook_log l,
             LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(l.payload -> 'data' -> 'payment_method') = 'object' THEN l.payload -> 'data' -> 'payment_method' ELSE '{}'::jsonb END) AS k
       WHERE l.event = 'charge.completed' GROUP BY 1, 2
      ORDER BY 1, 3 DESC, 2
    LOOP RAISE NOTICE '%.% (in % events)', r.scope, r.key, r.n; END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'data keys failed: %', SQLERRM; END;

  BEGIN
    RAISE NOTICE '── bank-ish fields inside bank_transfer: distinct short non-numeric-account values ──';
    FOR r IN
      SELECT e.key, count(DISTINCT e.value) AS distinct_values,
             (SELECT string_agg(v, ' | ') FROM (
                SELECT DISTINCT e2.value AS v
                  FROM public.wallet_webhook_log l2,
                       LATERAL jsonb_each_text(CASE WHEN jsonb_typeof(l2.payload -> 'data' -> 'payment_method' -> 'bank_transfer') = 'object'
                                                    THEN l2.payload -> 'data' -> 'payment_method' -> 'bank_transfer' ELSE '{}'::jsonb END) AS e2(key, value)
                 WHERE l2.event = 'charge.completed' AND e2.key = e.key
                   AND length(e2.value) BETWEEN 1 AND 40 AND e2.value !~ '^[0-9]{8,}$'
                 LIMIT 8) s) AS sample_values
        FROM public.wallet_webhook_log l,
             LATERAL jsonb_each_text(CASE WHEN jsonb_typeof(l.payload -> 'data' -> 'payment_method' -> 'bank_transfer') = 'object'
                                          THEN l.payload -> 'data' -> 'payment_method' -> 'bank_transfer' ELSE '{}'::jsonb END) AS e(key, value)
       WHERE l.event = 'charge.completed' AND e.key ~* 'bank'
       GROUP BY e.key ORDER BY e.key
    LOOP RAISE NOTICE 'field % : % distinct values, e.g. %', r.key, r.distinct_values, r.sample_values; END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'bank-ish values failed: %', SQLERRM; END;

  BEGIN
    RAISE NOTICE '── transfer.*: keys of data.bank and data.meta ──';
    FOR r IN
      SELECT 'bank' AS scope, k AS key, count(*) AS n
        FROM public.wallet_webhook_log l,
             LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(l.payload -> 'data' -> 'bank') = 'object' THEN l.payload -> 'data' -> 'bank' ELSE '{}'::jsonb END) AS k
       WHERE l.event LIKE 'transfer.%' GROUP BY 1, 2
      UNION ALL
      SELECT 'meta', k, count(*)
        FROM public.wallet_webhook_log l,
             LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(l.payload -> 'data' -> 'meta') = 'object' THEN l.payload -> 'data' -> 'meta' ELSE '{}'::jsonb END) AS k
       WHERE l.event LIKE 'transfer.%' GROUP BY 1, 2
      ORDER BY 1, 3 DESC, 2
    LOOP RAISE NOTICE 'transfer data.%.% (in % events)', r.scope, r.key, r.n; END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'transfer keys failed: %', SQLERRM; END;

  BEGIN
    RAISE NOTICE '── wallet_withdrawals bank fields ──';
    RAISE NOTICE 'rows=% with bank_name=% with bank_code=% ',
      (SELECT count(*) FROM public.wallet_withdrawals),
      (SELECT count(*) FROM public.wallet_withdrawals WHERE COALESCE(bank_name, '') <> ''),
      (SELECT count(*) FROM public.wallet_withdrawals WHERE COALESCE(bank_code, '') <> '');
    FOR r IN SELECT bank_code, count(*) AS n FROM public.wallet_withdrawals GROUP BY 1 ORDER BY 2 DESC LIMIT 25
    LOOP RAISE NOTICE 'withdrawal bank_code=% rows=%', r.bank_code, r.n; END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'withdrawals failed: %', SQLERRM; END;
END $$;
