-- READ-ONLY diagnostic (no writes): are there scheduled wallet transfers waiting on the (broken) cron → edge-function call?
-- Prints counts and dates only (no recipients, no amounts per person), plus the cron jobs that exist. Read with:
--   gh run view <id> --log | grep NOTICE
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT status, count(*) AS n, count(*) FILTER (WHERE next_run_at < now()) AS overdue,
                  min(next_run_at) AS earliest, max(next_run_at) AS latest
             FROM public.wallet_scheduled_transfers GROUP BY status ORDER BY status LOOP
    RAISE NOTICE 'scheduled transfers: status=% total=% overdue=% earliest=% latest=%', r.status, r.n, r.overdue, r.earliest, r.latest;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM public.wallet_scheduled_transfers) THEN RAISE NOTICE 'scheduled transfers: none at all'; END IF;

  FOR r IN SELECT jobname, schedule, active FROM cron.job ORDER BY jobname LOOP
    RAISE NOTICE 'cron job: % | % | active=%', r.jobname, r.schedule, r.active;
  END LOOP;

  FOR r IN SELECT status_code, count(*) AS n, max(created) AS last
             FROM net._http_response GROUP BY status_code ORDER BY status_code LOOP
    RAISE NOTICE 'recent pg_net responses: status=% n=% last=%', r.status_code, r.n, r.last;
  END LOOP;
END $$;
