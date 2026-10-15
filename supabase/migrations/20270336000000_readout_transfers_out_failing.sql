-- Read-out (changes nothing, counts/statuses only): "transfer out is not working" (2026-10-15). Today's transfer attempts,
-- whether they reached Flutterwave, approvals waiting, and recent transfer-related ledger rows and admin notices.

DO $$
DECLARE r RECORD; x text;
BEGIN
  FOR r IN
    SELECT to_char(created_at AT TIME ZONE 'Africa/Lagos', 'MM-DD HH24:MI') AS at, status,
           CASE WHEN amount_kobo <= 500000 THEN '<=5k' WHEN amount_kobo <= 1000000 THEN '5k-10k' WHEN amount_kobo <= 5000000 THEN '10k-50k' ELSE '>50k' END AS band,
           (flw_transfer_id IS NOT NULL) AS has_flw_id, (approval_request_id IS NOT NULL) AS needs_approval,
           EXISTS (SELECT 1 FROM public.wallets w WHERE w.flw_account_number = wd.account_number) AS to_kudiai_wallet
      FROM public.wallet_withdrawals wd WHERE created_at > now() - interval '2 days' ORDER BY created_at
  LOOP
    RAISE NOTICE 'transfer | % | % | % | flw_id=% | approval=% | to_kudiai=%', r.at, r.status, r.band, r.has_flw_id, r.needs_approval, r.to_kudiai_wallet;
  END LOOP;

  BEGIN
    FOR r IN SELECT status, count(*) AS n, to_char(max(created_at) AT TIME ZONE 'Africa/Lagos', 'MM-DD HH24:MI') AS last_at
               FROM public.admin_approval_requests WHERE created_at > now() - interval '3 days' GROUP BY 1
    LOOP RAISE NOTICE 'approvals | % | % | last %', r.status, r.n, r.last_at; END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'approvals | n/a (%)', SQLERRM; END;

  FOR r IN SELECT to_char(created_at AT TIME ZONE 'Africa/Lagos', 'MM-DD HH24:MI') AS at, source, direction, status
             FROM public.wallet_ledger
            WHERE created_at > now() - interval '2 days' AND source IN ('withdrawal', 'withdrawal_reversal', 'transfer_fee', 'cbn_levy', 'wallet_fee')
            ORDER BY created_at
  LOOP RAISE NOTICE 'ledger | % | % | % | %', r.at, r.source, r.direction, r.status; END LOOP;

  BEGIN
    FOR r IN SELECT to_char(created_at AT TIME ZONE 'Africa/Lagos', 'MM-DD HH24:MI') AS at, type, left(regexp_replace(coalesce(title, ''), '[0-9]{6,}', '#', 'g'), 60) AS title
               FROM public.notifications
              WHERE created_at > now() - interval '2 days' AND (type ILIKE '%transfer%' OR type ILIKE '%withdraw%' OR title ILIKE '%transfer%')
              ORDER BY created_at DESC LIMIT 25
    LOOP RAISE NOTICE 'notice | % | % | %', r.at, r.type, r.title; END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'notice | n/a (%)', SQLERRM; END;

  SELECT string_agg(key || '=' || value, ', ' ORDER BY key) INTO x FROM public.platform_config
   WHERE key ~ '^(wallet_transfers?_|wallet_withdraw|transfers_|wallet_payout|flw_active|wallet_tier1_|wallet_kill|wallet_paused)';
  RAISE NOTICE 'config | %', COALESCE(x, 'none');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'readout error | %', SQLERRM;
END $$;
