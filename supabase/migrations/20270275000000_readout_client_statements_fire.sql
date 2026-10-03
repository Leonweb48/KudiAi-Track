-- READ-ONLY: what client-statements answered to the scheduled-path call fired by 20270274 (counts only), and the job.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT status_code, left(COALESCE(content, ''), 160) AS body, created
             FROM net._http_response
            WHERE created > now() - interval '30 minutes'
              AND (content LIKE '%"candidates":%' OR content LIKE '%Unauthorized%')
            ORDER BY created DESC LIMIT 5 LOOP
    RAISE NOTICE 'fire: HTTP % % at %', r.status_code, r.body, r.created;
  END LOOP;
  RAISE NOTICE 'job: %', (SELECT string_agg(jobname || ' ' || schedule, ', ') FROM cron.job WHERE jobname = 'client-monthly-statements');
  RAISE NOTICE 'records: % (nothing should be recorded yet)', (SELECT count(*) FROM public.client_statements);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END
$$;
