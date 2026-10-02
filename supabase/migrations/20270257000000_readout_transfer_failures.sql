-- READ-ONLY diagnostic (2026-10-02): Flutterwave's own words on today's failed transfer webhooks (status, complete_message,
-- error fields — every 4+ digit run masked; no names, account numbers, amounts or references; CI logs are public).
DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE '== F1. transfer webhooks today: status + Flutterwave message';
  FOR r IN
    SELECT to_char(processed_at, 'HH24:MI') AS t,
           left(coalesce(payload #>> '{data,status}', payload #>> '{status}', '?'), 20) AS st,
           left(regexp_replace(coalesce(payload #>> '{data,complete_message}', payload #>> '{data,status_message}',
                payload #>> '{data,processor_response}', payload #>> '{data,response_message}', ''), '\d{4,}', '#', 'g'), 200) AS msg,
           (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(coalesce(payload -> 'data', '{}'::jsonb)) k) AS keys
      FROM public.wallet_webhook_log
     WHERE event ILIKE '%transfer%' AND processed_at > now() - interval '30 hours'
     ORDER BY processed_at
  LOOP
    RAISE NOTICE 'F1 % status=% msg=% keys=%', r.t, r.st, r.msg, r.keys;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
