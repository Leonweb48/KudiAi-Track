-- READ-ONLY health check (2026-10-12, before filming Masterclass #5): since yesterday's checks (2026-10-11 13:00 UTC),
-- bills by status, failed-bill error codes, transfers by status (+ the bank's reason for failures), Ajo contributions.
-- Counts, statuses and error codes only; digits masked (CI logs are public). No writes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT category, coalesce(bill_status, '?') st, count(*) n FROM public.transactions
            WHERE payment_type = 'bill_payment' AND created_at > '2026-10-11 13:00:00+00' GROUP BY 1, 2 ORDER BY 1, 2 LOOP
    RAISE NOTICE 'K1 bills: % % = %', r.category, r.st, r.n;
  END LOOP;
  FOR r IN SELECT category, left(regexp_replace(split_part(coalesce(note, ''), '| PS:', 1), '[0-9]', '#', 'g'), 90) err, count(*) n
             FROM public.transactions WHERE payment_type = 'bill_payment' AND bill_status = 'failed' AND created_at > '2026-10-11 13:00:00+00'
            GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 8 LOOP
    RAISE NOTICE 'K2 failed bill: % | % | n=%', r.category, r.err, r.n;
  END LOOP;
  FOR r IN SELECT status, count(*) n FROM public.wallet_withdrawals WHERE created_at > '2026-10-11 13:00:00+00' GROUP BY 1 ORDER BY 1 LOOP
    RAISE NOTICE 'K3 transfers: % = %', r.status, r.n;
  END LOOP;
  FOR r IN SELECT n.metadata->>'provider_code' c, n.metadata->>'provider_type' t, n.metadata->>'flw_code' fc, n.metadata->>'flw_type' ft, count(*) k
             FROM public.wallet_withdrawals w JOIN public.admin_notifications n ON n.metadata->>'withdrawal_id' = w.id::text
            WHERE w.status = 'failed' AND w.created_at > '2026-10-11 13:00:00+00' GROUP BY 1, 2, 3, 4 LOOP
    RAISE NOTICE 'K4 transfer failure reason: provider=%/% flw=%/% n=%', r.c, r.t, r.fc, r.ft, r.k;
  END LOOP;
  RAISE NOTICE 'K5 ajo contributions: completed=% pending=% other=%',
    (SELECT count(*) FROM public.ajo_contributions WHERE created_at > '2026-10-11 13:00:00+00' AND status = 'completed'),
    (SELECT count(*) FROM public.ajo_contributions WHERE created_at > '2026-10-11 13:00:00+00' AND status = 'pending'),
    (SELECT count(*) FROM public.ajo_contributions WHERE created_at > '2026-10-11 13:00:00+00' AND status NOT IN ('completed', 'pending'));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
