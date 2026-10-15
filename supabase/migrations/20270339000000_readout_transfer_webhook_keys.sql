-- Read-out (changes nothing): the FIELD NAMES (never values) of the newest transfer.disburse webhook payload, to find
-- where Flutterwave puts the NIP session ID. Values that look like long digit strings are reported only as their length.
DO $$
DECLARE p jsonb; r RECORD;
BEGIN
  SELECT payload INTO p FROM public.wallet_webhook_log WHERE event = 'transfer.disburse' ORDER BY processed_at DESC LIMIT 1;
  IF p IS NULL THEN RAISE NOTICE 'keys | no transfer webhook'; RETURN; END IF;
  FOR r IN
    WITH RECURSIVE walk(path, val) AS (
      SELECT k, v FROM jsonb_each(p) AS e(k, v)
      UNION ALL
      SELECT walk.path || '.' || e.k, e.v FROM walk, jsonb_each(CASE WHEN jsonb_typeof(walk.val) = 'object' THEN walk.val ELSE '{}'::jsonb END) AS e(k, v)
    )
    SELECT path, jsonb_typeof(val) AS t,
           CASE WHEN jsonb_typeof(val) = 'string' AND (val #>> '{}') ~ '^[0-9]{15,40}$' THEN 'digits:' || length(val #>> '{}') ELSE '' END AS shape
      FROM walk ORDER BY path
  LOOP RAISE NOTICE 'key | % | % %', r.path, r.t, r.shape; END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout error | %', SQLERRM;
END $$;
