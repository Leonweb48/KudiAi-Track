-- Reads the answers to the two probes fired by the previous migration (READ-ONLY).
DO $$
DECLARE r record;
BEGIN
  PERFORM pg_sleep(10);
  FOR r IN
    SELECT id, status_code, left(content::text, 140) AS body, created
      FROM net._http_response
     WHERE created > now() - interval '5 minutes'
     ORDER BY id
  LOOP
    RAISE NOTICE 'PROBE-RESULT id=% status=% body=%', r.id, r.status_code, r.body;
  END LOOP;
END $$;
