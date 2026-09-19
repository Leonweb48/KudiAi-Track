-- READ-ONLY — prints the answers to the probes fired by …144 (waits for pg_net first).
DO $$
DECLARE r record;
BEGIN
  PERFORM pg_sleep(25);
  RAISE NOTICE '=== answers to the cron-secret probes (newest first; ids follow the PROBE-A/B/C order above) ===';
  FOR r IN
    SELECT id, status_code, left(regexp_replace(coalesce(content::text, ''), '\s+', ' ', 'g'), 200) AS body, error_msg
    FROM net._http_response WHERE created > now() - interval '10 minutes' ORDER BY id DESC LIMIT 6
  LOOP
    RAISE NOTICE 'request % -> HTTP % %', r.id, r.status_code, coalesce(nullif(r.body, ''), r.error_msg, '');
  END LOOP;
END
$$;
