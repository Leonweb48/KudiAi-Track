-- READ-ONLY diagnostic (no writes): why did the transfer.disburse webhook of 2026-09-24 ~13:04 UTC report FAILED?
-- Prints only status / reason fields and the payload's top-level key names — no recipient details.
-- Read with:  gh run view <id> --log | grep NOTICE
DO $$
DECLARE r record; keys text;
BEGIN
  FOR r IN
    SELECT processed_at, payload
      FROM public.wallet_webhook_log
     WHERE event = 'transfer.disburse' AND payload -> 'data' ->> 'status' = 'FAILED'
     ORDER BY processed_at DESC LIMIT 3
  LOOP
    SELECT string_agg(k, ',') INTO keys FROM jsonb_object_keys(r.payload -> 'data') AS k;
    RAISE NOTICE 'FAILED transfer webhook at %: data keys=[%]', r.processed_at, keys;
    RAISE NOTICE '  reason fields: %', jsonb_strip_nulls(jsonb_build_object(
      'status',              r.payload -> 'data' ->> 'status',
      'complete_message',    r.payload -> 'data' ->> 'complete_message',
      'processor_response',  r.payload -> 'data' ->> 'processor_response',
      'status_reason',       r.payload -> 'data' ->> 'status_reason',
      'reason',              r.payload -> 'data' ->> 'reason',
      'message',             r.payload -> 'data' ->> 'message',
      'error',               r.payload -> 'data' -> 'error',
      'failure_reason',      r.payload -> 'data' ->> 'failure_reason',
      'amount',              r.payload -> 'data' -> 'amount',
      'source_currency',     r.payload -> 'data' ->> 'source_currency'));
  END LOOP;
END $$;
