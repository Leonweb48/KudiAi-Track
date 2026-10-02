-- READ-ONLY diagnostic (2026-10-02): the destination bank's answer on today's failed transfer (provider_response, 4+ digit
-- runs masked) and whether today's transfers went to the same account (distinct counts only). No names, account
-- numbers, amounts or references — CI logs are public.
DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE '== P1. provider_response on failed transfer webhooks, last 30 h';
  FOR r IN
    SELECT to_char(processed_at, 'HH24:MI') AS t,
           left(regexp_replace(coalesce(payload #>> '{data,provider_response}', ''), '\d{4,}', '#', 'g'), 300) AS pr,
           left(regexp_replace(coalesce(payload #>> '{data,bank,name}', payload #>> '{data,payment_information,bank_name}', ''), '\d{4,}', '#', 'g'), 60) AS bank
      FROM public.wallet_webhook_log
     WHERE event ILIKE '%transfer%' AND processed_at > now() - interval '30 hours'
       AND coalesce(payload #>> '{data,status}', '') ILIKE 'fail%'
  LOOP
    RAISE NOTICE 'P1 % bank=% provider_response=%', r.t, r.bank, r.pr;
  END LOOP;

  RAISE NOTICE '== P2. today''s transfers: time, status, destination bank, same account as another today?';
  FOR r IN
    SELECT to_char(w.created_at, 'HH24:MI') AS t, w.status, coalesce(w.bank_name, '(code ' || length(w.bank_code) || ' chars)') AS bank,
           (SELECT count(*) FROM public.wallet_withdrawals o
             WHERE o.created_at::date = w.created_at::date AND o.account_number = w.account_number AND o.bank_code = w.bank_code) AS same_acct_today,
           (SELECT count(DISTINCT o.user_id) FROM public.wallet_withdrawals o WHERE o.created_at > now() - interval '1 day') AS senders_today
      FROM public.wallet_withdrawals w
     WHERE w.created_at > now() - interval '30 hours'
     ORDER BY w.created_at
  LOOP
    RAISE NOTICE 'P2 % % bank=% same_account_today=% senders_today=%', r.t, r.status, r.bank, r.same_acct_today, r.senders_today;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
