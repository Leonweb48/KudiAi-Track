-- Read-out (changes nothing): today's transfers to OTHER banks — did each record a session ID (the NIP reference the
-- receiving bank traces with)? Prints yes/no, bank name and time only — never the IDs, names or account numbers.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT to_char(wd.created_at AT TIME ZONE 'Africa/Lagos', 'MM-DD HH24:MI') AS at, wd.status,
                  COALESCE(NULLIF(wd.bank_name, ''), wd.bank_code) AS bank,
                  (NULLIF(wd.session_id, '') IS NOT NULL) AS has_session, (wd.flw_transfer_id IS NOT NULL) AS has_flw_id,
                  to_char(wd.updated_at AT TIME ZONE 'Africa/Lagos', 'HH24:MI') AS settled_at
             FROM public.wallet_withdrawals wd
            WHERE wd.created_at > now() - interval '2 days'
              AND NOT EXISTS (SELECT 1 FROM public.wallets w WHERE w.flw_account_number = wd.account_number)
            ORDER BY wd.created_at
  LOOP RAISE NOTICE 'bank transfer | % | % | % | session_id=% | flw_id=% | updated %', r.at, r.status, r.bank, r.has_session, r.has_flw_id, r.settled_at; END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout error | %', SQLERRM;
END $$;
