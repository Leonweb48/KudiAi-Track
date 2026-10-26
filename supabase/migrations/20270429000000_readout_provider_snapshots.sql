-- READ-ONLY (2026-10-26): is the provider wallet snapshot (cron provider-balance-snapshot, 20270428) recording? COUNTS and
-- times only — never a balance (the repo and its Actions logs are public). No writes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT provider, count(*) AS n, max(observed_at) AS last FROM public.bill_provider_balances GROUP BY provider ORDER BY 1 LOOP
    RAISE NOTICE 'SNAP % | readings=% | last=%', r.provider, r.n, to_char(r.last AT TIME ZONE 'Africa/Lagos', 'YYYY-MM-DD HH24:MI');
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM public.bill_provider_balances) THEN RAISE NOTICE 'SNAP none yet'; END IF;
  RAISE NOTICE 'SNAP cron job present=%', EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'provider-balance-snapshot');
END $$;
