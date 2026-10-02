-- READ-ONLY diagnostic (2026-10-02): do today's failed transfers differ from the ones that went through by SIZE? Amounts
-- are shown only as a band and as a multiple of the largest successful transfer since the business-account switch
-- (2026-09-24) — no exact amounts, names, account numbers or references (CI logs are public). No writes.
DO $$
DECLARE r record; v_max BIGINT; v_today BIGINT;
BEGIN
  SELECT max(amount_kobo) INTO v_max FROM public.wallet_withdrawals WHERE status = 'successful' AND created_at > '2026-09-24';
  SELECT coalesce(sum(amount_kobo), 0) INTO v_today FROM public.wallet_withdrawals
   WHERE status IN ('successful', 'processing', 'pending') AND created_at > date_trunc('day', now() AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos';
  RAISE NOTICE '== A1. every transfer since the switch: time, status, size band, x largest success';
  FOR r IN
    SELECT to_char(created_at, 'MM-DD HH24:MI') AS t, status, bank_code,
           CASE WHEN amount_kobo < 500000 THEN '<5k' WHEN amount_kobo < 2000000 THEN '5k-20k' WHEN amount_kobo < 5000000 THEN '20k-50k'
                WHEN amount_kobo < 10000000 THEN '50k-100k' WHEN amount_kobo < 20000000 THEN '100k-200k'
                WHEN amount_kobo < 50000000 THEN '200k-500k' ELSE '500k+' END AS band,
           round(amount_kobo::numeric / nullif(v_max, 0), 2) AS x_max
      FROM public.wallet_withdrawals WHERE created_at > '2026-09-24' ORDER BY created_at
  LOOP
    RAISE NOTICE 'A1 % % bank=% band=% x_largest_success=%', r.t, r.status, r.bank_code, r.band, r.x_max;
  END LOOP;
  RAISE NOTICE 'A2 sent today (WAT day, ok+in flight) band=%',
    CASE WHEN v_today < 2000000 THEN '<20k' WHEN v_today < 10000000 THEN '20k-100k' WHEN v_today < 50000000 THEN '100k-500k' ELSE '500k+' END;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
