-- READ-ONLY (2026-10-11): the bank's own reason for today's failed transfer (the webhook alert stores it as
-- provider_code / provider_type / provider_message). Digits masked; no account, name, reference or amount. No writes.
DO $$
DECLARE a record;
BEGIN
  FOR a IN
    SELECT n.title, n.metadata->>'status' AS st, n.metadata->>'provider_code' AS c, n.metadata->>'provider_type' AS t,
           left(regexp_replace(coalesce(n.metadata->>'provider_message', ''), '[0-9]', '#', 'g'), 140) AS m
      FROM public.wallet_withdrawals w
      JOIN public.admin_notifications n ON n.metadata->>'withdrawal_id' = w.id::text
     WHERE w.status = 'failed' AND w.created_at > now() - interval '7 days'
     ORDER BY w.created_at
  LOOP
    RAISE NOTICE 'R % | status=% code=% type=% | "%"', a.title, a.st, a.c, a.t, a.m;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
