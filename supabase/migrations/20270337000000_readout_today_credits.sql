-- Read-out (changes nothing, counts only): did every incoming payment today become a wallet credit, including the
-- KudiAI wallet-to-wallet sends? (2026-10-15)
DO $$
DECLARE r RECORD; n int;
BEGIN
  FOR r IN SELECT to_char(created_at AT TIME ZONE 'Africa/Lagos', 'HH24:MI') AS at, source, amount_kobo / 100 AS naira
             FROM public.wallet_ledger WHERE direction = 'credit' AND created_at > date_trunc('day', now() AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos'
            ORDER BY created_at
  LOOP RAISE NOTICE 'credit today | % | % | %', r.at, r.source, r.naira; END LOOP;
  SELECT count(*) INTO n FROM public.wallet_webhook_log WHERE event = 'charge.completed'
     AND processed_at > date_trunc('day', now() AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos';
  RAISE NOTICE 'charge webhooks today | %', n;
  SELECT count(*) INTO n FROM public.wallet_webhook_log h WHERE h.event = 'charge.completed'
     AND h.processed_at > date_trunc('day', now() AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos'
     AND NOT EXISTS (SELECT 1 FROM public.wallet_ledger l WHERE l.flw_reference = h.flw_reference);
  RAISE NOTICE 'charge webhooks today with no credit | %', n;
  FOR r IN SELECT to_char(wd.created_at AT TIME ZONE 'Africa/Lagos', 'HH24:MI') AS at,
                  EXISTS (SELECT 1 FROM public.wallet_ledger l JOIN public.wallets w ON w.id = l.wallet_id
                           WHERE w.flw_account_number = wd.account_number AND l.direction = 'credit' AND l.amount_kobo = wd.amount_kobo
                             AND l.created_at BETWEEN wd.created_at AND wd.created_at + interval '2 hours') AS credited
             FROM public.wallet_withdrawals wd
            WHERE wd.created_at > now() - interval '1 day' AND EXISTS (SELECT 1 FROM public.wallets w WHERE w.flw_account_number = wd.account_number)
            ORDER BY wd.created_at
  LOOP RAISE NOTICE 'wallet-to-wallet | sent % | receiver credited %', r.at, r.credited; END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout error | %', SQLERRM;
END $$;
