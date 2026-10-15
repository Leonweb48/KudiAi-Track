-- Read-out (changes nothing, counts only): timeline of Flutterwave webhooks and outgoing transfers since 13 Oct —
-- did incoming-payment notifications stop arriving after 14 Oct 07:06 (Lagos), or arrive and get dropped?

DO $$
DECLARE r RECORD; x text;
BEGIN
  FOR r IN
    SELECT event, to_char(date_trunc('hour', processed_at AT TIME ZONE 'Africa/Lagos'), 'MM-DD HH24') AS h, count(*) AS n
      FROM public.wallet_webhook_log WHERE processed_at > '2026-10-13 23:00+00'
     GROUP BY 1, 2 ORDER BY 2, 1
  LOOP
    RAISE NOTICE 'webhook hour | % | % | %', r.h, r.event, r.n;
  END LOOP;
  SELECT to_char(max(processed_at) AT TIME ZONE 'Africa/Lagos', 'MM-DD HH24:MI') INTO x FROM public.wallet_webhook_log;
  RAISE NOTICE 'webhook | last logged at % (Lagos)', x;

  -- outgoing transfers (bank + to other KudiAI wallets) by day and status
  FOR r IN
    SELECT to_char(created_at AT TIME ZONE 'Africa/Lagos', 'MM-DD') AS d, status, count(*) AS n
      FROM public.wallet_withdrawals WHERE created_at > now() - interval '3 days'
     GROUP BY 1, 2 ORDER BY 1, 2
  LOOP
    RAISE NOTICE 'transfers out | % | % | %', r.d, r.status, r.n;
  END LOOP;

  -- transfers out to a KudiAI virtual account (a wallet-to-wallet send) whose receiving wallet got nothing
  SELECT count(*) INTO x FROM public.wallet_withdrawals wd
   WHERE wd.created_at > now() - interval '3 days' AND wd.status IN ('successful', 'sent', 'completed', 'processing')
     AND EXISTS (SELECT 1 FROM public.wallets w WHERE w.flw_account_number = wd.account_number)
     AND NOT EXISTS (SELECT 1 FROM public.wallet_ledger l JOIN public.wallets w2 ON w2.id = l.wallet_id
                      WHERE w2.flw_account_number = wd.account_number AND l.direction = 'credit' AND l.created_at >= wd.created_at);
  RAISE NOTICE 'wallet-to-wallet sends with nothing credited to the receiving wallet (3 days) | %', x;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'readout error | %', SQLERRM;
END $$;
