-- READ-ONLY: the first scheduled runs of the monthly jobs today (asking for September, which nobody is due) — the
-- scheduler's run status and the functions' answers (counts only). No writes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT j.jobname, d.status, count(*) AS n, max(d.start_time) AS last
             FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
            WHERE j.jobname IN ('owner-monthly-reports', 'client-monthly-statements') AND d.start_time > now() - interval '3 hours'
            GROUP BY 1, 2 ORDER BY 1, 2 LOOP
    RAISE NOTICE 'job % %: % run(s), last %', r.jobname, r.status, r.n, r.last;
  END LOOP;
  FOR r IN SELECT status_code, left(COALESCE(content, ''), 150) AS body, created
             FROM net._http_response
            WHERE created > now() - interval '3 hours' AND content LIKE '%"candidates":%'
            ORDER BY created DESC LIMIT 6 LOOP
    RAISE NOTICE 'answer: HTTP % % at %', r.status_code, r.body, r.created;
  END LOOP;
  RAISE NOTICE 'records: owner % client %', (SELECT count(*) FROM public.owner_monthly_reports), (SELECT count(*) FROM public.client_statements);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END
$$;
