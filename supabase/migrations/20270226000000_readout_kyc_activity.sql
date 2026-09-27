-- READ-ONLY diagnostic (no writes): what has actually happened since the identity-check switches were turned on, before the provider token existed
-- server-side — counts and outcomes only, never a number, a name or any personal data. Read with:  gh run view <id> --log | grep NOTICE
DO $$
DECLARE r record; v_since timestamptz := now() - interval '2 days';
BEGIN
  RAISE NOTICE 'kyc_checks total: %', (SELECT count(*) FROM public.kyc_checks WHERE created_at >= v_since);
  FOR r IN SELECT kind, outcome, billed, count(*) AS n FROM public.kyc_checks WHERE created_at >= v_since GROUP BY 1, 2, 3 ORDER BY 1, 2 LOOP
    RAISE NOTICE 'kyc_checks | kind=% outcome=% billed=% n=%', r.kind, r.outcome, r.billed, r.n;
  END LOOP;
  RAISE NOTICE 'kyc_verified total: %', (SELECT count(*) FROM public.kyc_verified);
  FOR r IN SELECT title, count(*) AS n, max(created_at) AS last FROM public.admin_notifications
            WHERE title ILIKE '%youverify%' OR title ILIKE '%ID verification%' GROUP BY 1 LOOP
    RAISE NOTICE 'admin alert | title=% n=% last=%', r.title, r.n, r.last;
  END LOOP;
  RAISE NOTICE 'wallets with a wallet: %  (for scale only)', (SELECT count(*) FROM public.wallets WHERE flw_account_number IS NOT NULL AND updated_at >= v_since);
END $$;
