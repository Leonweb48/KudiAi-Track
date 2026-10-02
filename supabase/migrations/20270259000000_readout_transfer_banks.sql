-- READ-ONLY diagnostic (2026-10-02): which destination BANKS (institution codes — public, not personal) today's and
-- recent transfers went to, by outcome, and Flutterwave's error code on the failed one. No account numbers, names,
-- amounts or references — CI logs are public.
DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE '== B1. destination bank code x status, last 7 days';
  FOR r IN
    SELECT bank_code, status, count(*) AS n, to_char(max(created_at), 'MM-DD HH24:MI') AS last
      FROM public.wallet_withdrawals WHERE created_at > now() - interval '7 days'
     GROUP BY 1, 2 ORDER BY 1, 2
  LOOP
    RAISE NOTICE 'B1 bank=% % n=% last=%', r.bank_code, r.status, r.n, r.last;
  END LOOP;

  RAISE NOTICE '== B2. failed transfer webhooks: error code + type + bank fields';
  FOR r IN
    SELECT to_char(processed_at, 'MM-DD HH24:MI') AS t,
           payload #>> '{data,provider_response,code}' AS code,
           payload #>> '{data,provider_response,type}' AS typ,
           (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(coalesce(payload #> '{data,bank}', '{}'::jsonb)) k) AS bank_keys,
           payload #>> '{data,bank,code}' AS bank_code
      FROM public.wallet_webhook_log
     WHERE event ILIKE '%transfer%' AND processed_at > now() - interval '7 days'
       AND coalesce(payload #>> '{data,status}', '') ILIKE 'fail%'
  LOOP
    RAISE NOTICE 'B2 % code=% type=% bank=% bank_keys=%', r.t, r.code, r.typ, r.bank_code, r.bank_keys;
  END LOOP;

  RAISE NOTICE '== B3. failed transfers per sender today (distinct senders, attempts)';
  SELECT count(DISTINCT user_id) AS senders, count(*) AS attempts INTO r
    FROM public.wallet_withdrawals WHERE status = 'failed' AND created_at > now() - interval '1 day';
  RAISE NOTICE 'B3 failed today: senders=% attempts=%', r.senders, r.attempts;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
