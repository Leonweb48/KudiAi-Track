-- READ-ONLY diagnostic (no writes): the exact columns, allowed statuses and auth-schema shape needed to build in-app account deletion.
-- Prints STRUCTURE only (column names / types, CHECK constraint text, index names). No row values.
-- Read with:  gh run view <id> --log | grep NOTICE
DO $$
DECLARE r record;
BEGIN
  BEGIN
    RAISE NOTICE '── all columns of the tables deletion touches ──';
    FOR r IN
      SELECT c.table_schema || '.' || c.table_name AS t, string_agg(c.column_name || ':' || c.data_type, ', ' ORDER BY c.ordinal_position) AS cols
        FROM information_schema.columns c
       WHERE (c.table_schema = 'public' AND c.table_name IN (
              'profiles', 'staff', 'aso_clients', 'org_members', 'organizations', 'customers', 'credits', 'wallets', 'wallet_withdrawals',
              'wallet_payment_requests', 'wallet_scheduled_transfers', 'pending_bills', 'ajo_cycles', 'ajo_withdrawal_requests',
              'aso_client_group_memberships', 'ajo_group_turns', 'peer_esusu_groups', 'peer_esusu_members', 'peer_esusu_turns',
              'org_loans', 'org_savings', 'org_withdrawals', 'org_member_withdrawal_requests', 'subscriptions', 'notifications',
              'push_tokens', 'branches', 'invoice_settings', 'support_tickets', 'wallet_kyc', 'ajo_contributions', 'transactions',
              'wallet_ledger', 'user_consents', 'platform_sessions', 'bill_beneficiaries', 'customer_loyalty', 'loan_applications'))
          OR (c.table_schema = 'auth' AND c.table_name IN ('users', 'identities', 'sessions', 'refresh_tokens', 'mfa_factors', 'one_time_tokens'))
       GROUP BY 1 ORDER BY 1
    LOOP RAISE NOTICE 'COLS % : %', r.t, r.cols; END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'columns failed: %', SQLERRM; END;

  BEGIN
    RAISE NOTICE '── CHECK constraints (allowed values) on the same tables ──';
    FOR r IN
      SELECT cl.relname AS t, c.conname, pg_get_constraintdef(c.oid) AS def
        FROM pg_constraint c JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = 'public'
       WHERE c.contype = 'c' AND cl.relname IN ('profiles', 'staff', 'aso_clients', 'org_members', 'organizations', 'wallet_withdrawals',
              'wallet_payment_requests', 'wallet_scheduled_transfers', 'pending_bills', 'ajo_cycles', 'ajo_withdrawal_requests',
              'aso_client_group_memberships', 'peer_esusu_groups', 'peer_esusu_members', 'org_loans', 'subscriptions')
       ORDER BY cl.relname, c.conname
    LOOP RAISE NOTICE 'CHECK % : %', r.t, left(r.def, 260); END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'checks failed: %', SQLERRM; END;

  BEGIN
    RAISE NOTICE '── the functions that already exist with delete / erase / anonym in their name, and rate_limit_hit ──';
    FOR r IN SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
              WHERE p.proname ~* '(delete|erase|anonym|rate_limit|deletion)' ORDER BY p.proname
    LOOP RAISE NOTICE 'FN %(%)', r.proname, r.args; END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fn failed: %', SQLERRM; END;

  BEGIN
    RAISE NOTICE '── profile account types in use (counts only) ──';
    RAISE NOTICE 'profiles=% staff=% aso_clients=% (with portal user=%) org_members=% (with user=%) organizations=%',
      (SELECT count(*) FROM public.profiles), (SELECT count(*) FROM public.staff), (SELECT count(*) FROM public.aso_clients),
      (SELECT count(*) FROM public.aso_clients WHERE client_user_id IS NOT NULL), (SELECT count(*) FROM public.org_members),
      (SELECT count(*) FROM public.org_members WHERE user_id IS NOT NULL), (SELECT count(*) FROM public.organizations);
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'counts failed: %', SQLERRM; END;
END $$;
