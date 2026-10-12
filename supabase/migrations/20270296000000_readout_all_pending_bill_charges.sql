-- READ-ONLY (2026-10-12): bill charges left 'pending' for over an hour across ALL wallets (owners and clients) —
-- money taken with the order's outcome never recorded. Counts by month and by who (client / business), plus how many
-- have a matching later charge of the same amount within 10 minutes (a retry). Counts only. No writes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT to_char(l.created_at AT TIME ZONE 'Africa/Lagos', 'YYYY-MM') AS mon,
           CASE WHEN w.user_id IN (SELECT client_user_id FROM public.aso_clients WHERE client_user_id IS NOT NULL) THEN 'client' ELSE 'business' END AS who,
           count(*) AS n,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.wallet_ledger l2 WHERE l2.wallet_id = l.wallet_id AND l2.source = 'bill_spend'
                                           AND l2.id <> l.id AND l2.amount_kobo = l.amount_kobo AND l2.status = 'completed'
                                           AND l2.created_at BETWEEN l.created_at AND l.created_at + interval '10 minutes')) AS with_retry
      FROM public.wallet_ledger l JOIN public.wallets w ON w.id = l.wallet_id
     WHERE l.source = 'bill_spend' AND l.status = 'pending' AND l.created_at < now() - interval '1 hour'
     GROUP BY 1, 2 ORDER BY 1, 2
  LOOP
    RAISE NOTICE 'Q % % pending=% followed_by_a_paid_retry=%', r.mon, r.who, r.n, r.with_retry;
  END LOOP;
  IF NOT FOUND THEN RAISE NOTICE 'Q none'; END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
