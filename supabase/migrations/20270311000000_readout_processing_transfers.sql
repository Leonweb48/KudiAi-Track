-- READ-ONLY (2026-10-13): the two transfers still "processing" since this morning — how old, amount band, whether they were
-- under the free allowance / stamp-duty threshold, and whether Flutterwave's id was recorded. Counts and bands only. No writes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT w.status,
                  CASE WHEN now() - w.created_at < interval '30 minutes' THEN '<30m' WHEN now() - w.created_at < interval '3 hours' THEN '30m-3h' ELSE '>3h' END age,
                  CASE WHEN w.amount_kobo < 1000000 THEN '<10k' ELSE '>=10k' END band,
                  (w.flw_transfer_id IS NOT NULL) has_flw_id,
                  (SELECT count(*) FROM public.wallet_ledger l WHERE l.reference = w.id::text AND l.source IN ('transfer_fee','cbn_levy')) charges,
                  to_char(w.created_at AT TIME ZONE 'Africa/Lagos', 'HH24:MI') wat
             FROM public.wallet_withdrawals w
            WHERE w.created_at > '2026-10-13 07:00:00+00' ORDER BY w.created_at LOOP
    RAISE NOTICE 'P1 % | age % | % | flw id % | charges % | at % WAT', r.status, r.age, r.band, r.has_flw_id, r.charges, r.wat;
  END LOOP;
  RAISE NOTICE 'P2 processing older than 3h (any date) = %',
    (SELECT count(*) FROM public.wallet_withdrawals WHERE status = 'processing' AND created_at < now() - interval '3 hours');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
