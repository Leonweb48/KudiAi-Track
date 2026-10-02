-- READ-ONLY diagnostic (2026-10-03): what a monthly client statement would contain, before building it. Counts only —
-- savings entry types/statuses/contexts, how many rows carry a stored balance, and how many clients have a login, an
-- email, a wallet and activity last month. No names, emails, amounts per person or ids. No writes.
DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE '== S1. savings entries by type x status (all time | last 60 days | with balance_after)';
  FOR r IN SELECT type, status, count(*) AS n,
                  count(*) FILTER (WHERE created_at > now() - interval '60 days') AS recent,
                  count(*) FILTER (WHERE balance_after IS NOT NULL) AS with_bal
             FROM public.ajo_contributions GROUP BY 1, 2 ORDER BY 1, 2 LOOP
    RAISE NOTICE 'S1 % % n=% recent=% with_balance=%', r.type, r.status, r.n, r.recent, r.with_bal;
  END LOOP;

  RAISE NOTICE '== S2. savings entries by context';
  FOR r IN SELECT contribution_context, count(*) AS n FROM public.ajo_contributions GROUP BY 1 ORDER BY 1 LOOP
    RAISE NOTICE 'S2 % n=%', r.contribution_context, r.n;
  END LOOP;

  RAISE NOTICE '== S3. clients';
  RAISE NOTICE 'S3 total=% active=% with_login=% with_email=% login_and_email=%',
    (SELECT count(*) FROM public.aso_clients),
    (SELECT count(*) FROM public.aso_clients WHERE status = 'active'),
    (SELECT count(*) FROM public.aso_clients WHERE client_user_id IS NOT NULL),
    (SELECT count(*) FROM public.aso_clients WHERE coalesce(email, '') <> ''),
    (SELECT count(*) FROM public.aso_clients WHERE client_user_id IS NOT NULL AND coalesce(email, '') <> '');
  RAISE NOTICE 'S3 logins with more than one client record (several businesses): %',
    (SELECT count(*) FROM (SELECT client_user_id FROM public.aso_clients WHERE client_user_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1) x);
  RAISE NOTICE 'S3 client logins with a wallet: %',
    (SELECT count(DISTINCT c.client_user_id) FROM public.aso_clients c JOIN public.wallets w ON w.user_id = c.client_user_id);

  RAISE NOTICE '== S4. last month (September 2026, WAT): clients with savings activity | wallet activity | a balance';
  RAISE NOTICE 'S4 savings_active=% wallet_active=% savings_balance_gt0=%',
    (SELECT count(DISTINCT aso_client_id) FROM public.ajo_contributions
      WHERE created_at >= '2026-09-01 00:00+01' AND created_at < '2026-10-01 00:00+01'),
    (SELECT count(DISTINCT l.user_id) FROM public.wallet_ledger l JOIN public.aso_clients c ON c.client_user_id = l.user_id
      WHERE l.created_at >= '2026-09-01 00:00+01' AND l.created_at < '2026-10-01 00:00+01'),
    (SELECT count(*) FROM public.aso_clients WHERE coalesce(current_balance, 0) > 0);

  RAISE NOTICE '== S5. client wallet ledger sources (all time)';
  FOR r IN SELECT l.source, l.direction, count(*) AS n FROM public.wallet_ledger l
             WHERE l.user_id IN (SELECT client_user_id FROM public.aso_clients WHERE client_user_id IS NOT NULL)
             GROUP BY 1, 2 ORDER BY 1, 2 LOOP
    RAISE NOTICE 'S5 % % n=%', r.source, r.direction, r.n;
  END LOOP;

  RAISE NOTICE '== S6. columns';
  RAISE NOTICE 'S6 wallets: %', (SELECT string_agg(column_name, ', ' ORDER BY ordinal_position)
                          FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'wallets');
  RAISE NOTICE 'S6 wallet_ledger: %', (SELECT string_agg(column_name, ', ' ORDER BY ordinal_position)
                          FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'wallet_ledger');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END
$$;
