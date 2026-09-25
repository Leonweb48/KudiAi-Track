-- READ-ONLY (no writes; counts and amounts only, no user identifiers): has anyone already abused the service-only functions
-- that were callable without the service key? Read with:  gh run view <id> --log | grep NOTICE
DO $$
DECLARE r record;
BEGIN
  -- 1. wallet credits by source: rows with no provider reference are the suspicious kind (the real ones carry a Flutterwave ref)
  FOR r IN
    SELECT source,
           count(*) AS n,
           count(*) FILTER (WHERE flw_reference IS NULL) AS no_ref,
           coalesce(sum(amount_kobo), 0) / 100 AS total_naira,
           coalesce(sum(amount_kobo) FILTER (WHERE flw_reference IS NULL), 0) / 100 AS no_ref_naira,
           min(created_at)::date AS first_seen, max(created_at)::date AS last_seen
      FROM public.wallet_ledger
     WHERE direction = 'credit'
     GROUP BY source ORDER BY source
  LOOP
    RAISE NOTICE 'abuse | credit source=% rows=% no_provider_ref=% total_NGN=% no_ref_NGN=% first=% last=%', r.source, r.n, r.no_ref, r.total_naira, r.no_ref_naira, r.first_seen, r.last_seen;
  END LOOP;

  -- 2. the ten largest single credits (amount, source, whether it carries a provider reference, date)
  FOR r IN
    SELECT amount_kobo / 100 AS naira, source, (flw_reference IS NOT NULL) AS has_ref, status, created_at::date AS d
      FROM public.wallet_ledger WHERE direction = 'credit' ORDER BY amount_kobo DESC LIMIT 10
  LOOP
    RAISE NOTICE 'abuse | top credit NGN=% source=% has_ref=% status=% date=%', r.naira, r.source, r.has_ref, r.status, r.d;
  END LOOP;

  -- 3. does every wallet balance equal what its own completed ledger adds up to? (a mismatch = money created/removed outside the ledger)
  FOR r IN
    SELECT count(*) AS wallets,
           count(*) FILTER (WHERE w.balance_kobo <> coalesce(l.net, 0)) AS mismatched,
           coalesce(sum(w.balance_kobo), 0) / 100 AS total_balance_naira
      FROM public.wallets w
      LEFT JOIN (SELECT wallet_id,
                        sum(CASE WHEN direction = 'credit' THEN amount_kobo ELSE -amount_kobo END) FILTER (WHERE status IN ('completed','pending')) AS net
                   FROM public.wallet_ledger GROUP BY wallet_id) l ON l.wallet_id = w.id
  LOOP
    RAISE NOTICE 'abuse | wallets=% balance_vs_ledger_mismatches=% total_balance_NGN=%', r.wallets, r.mismatched, r.total_balance_naira;
  END LOOP;

  -- 4. approvals that were "decided" with no admin behind them (a user calling an execute_* function themselves passes no admin id)
  FOR r IN
    SELECT request_type, count(*) AS n
      FROM public.admin_approval_requests
     WHERE status = 'approved' AND decided_by IS NULL
     GROUP BY request_type ORDER BY request_type
  LOOP
    RAISE NOTICE 'abuse | approved with NO admin id: type=% count=%', r.request_type, r.n;
  END LOOP;
  RAISE NOTICE 'abuse | approvals total approved=% of which with admin id=%',
    (SELECT count(*) FROM public.admin_approval_requests WHERE status = 'approved'),
    (SELECT count(*) FROM public.admin_approval_requests WHERE status = 'approved' AND decided_by IS NOT NULL);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'abuse | error: %', SQLERRM;
END $$;
