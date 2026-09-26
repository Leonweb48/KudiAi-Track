-- READ-ONLY diagnostic (no writes): what could make an account-deletion statement fail — NOT NULL columns, non-trivial CHECKs, triggers, unique indexes.
-- Prints STRUCTURE only (names / definitions). No row values.
-- Read with:  gh run view <id> --log | grep NOTICE
DO $$
DECLARE r record;
  tbls text[] := ARRAY['profiles', 'staff', 'aso_clients', 'org_members', 'organizations', 'customers', 'credits', 'customer_loyalty', 'invoices', 'transactions',
    'branches', 'audit_logs', 'loan_applications', 'support_tickets', 'subscriptions', 'wallets', 'wallet_scheduled_transfers', 'wallet_payment_requests',
    'wallet_withdrawals', 'pending_bills', 'ajo_contributions', 'ajo_cycles', 'ajo_withdrawal_requests', 'aso_client_group_memberships', 'peer_esusu_members',
    'peer_esusu_groups', 'org_loans', 'user_consents', 'notifications', 'notification_preferences', 'push_tokens', 'profile_audit_log', 'faq_feedback',
    'platform_sessions', 'email_relay_usage', 'email_send_claims', 'welcome_email_queue', 'email_automation_queue', 'invoice_settings', 'bill_beneficiaries'];
BEGIN
  BEGIN
    RAISE NOTICE '── NOT NULL columns with no default (a fixture / an erase that sets these to NULL would fail) ──';
    FOR r IN
      SELECT c.table_name AS t, string_agg(c.column_name || ':' || c.data_type, ', ' ORDER BY c.ordinal_position) AS cols
        FROM information_schema.columns c
       WHERE c.table_schema = 'public' AND c.table_name = ANY (tbls) AND c.is_nullable = 'NO' AND c.column_default IS NULL AND c.is_identity = 'NO' AND c.is_generated = 'NEVER'
       GROUP BY c.table_name ORDER BY c.table_name
    LOOP RAISE NOTICE 'NN % : %', r.t, r.cols; END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'notnull failed: %', SQLERRM; END;

  BEGIN
    RAISE NOTICE '── NOT NULL columns WITH a default ──';
    FOR r IN
      SELECT c.table_name AS t, string_agg(c.column_name, ', ' ORDER BY c.ordinal_position) AS cols
        FROM information_schema.columns c
       WHERE c.table_schema = 'public' AND c.table_name = ANY (tbls) AND c.is_nullable = 'NO' AND c.column_default IS NOT NULL
       GROUP BY c.table_name ORDER BY c.table_name
    LOOP RAISE NOTICE 'NND % : %', r.t, r.cols; END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'notnull-default failed: %', SQLERRM; END;

  BEGIN
    RAISE NOTICE '── CHECK constraints on the tables not covered by the earlier readout ──';
    FOR r IN
      SELECT cl.relname AS t, c.conname, pg_get_constraintdef(c.oid) AS def
        FROM pg_constraint c JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = 'public'
       WHERE c.contype = 'c' AND cl.relname = ANY (tbls)
         AND cl.relname NOT IN ('profiles', 'staff', 'aso_clients', 'org_members', 'organizations', 'wallet_withdrawals', 'wallet_payment_requests', 'wallet_scheduled_transfers',
                                'pending_bills', 'ajo_cycles', 'ajo_withdrawal_requests', 'aso_client_group_memberships', 'peer_esusu_groups', 'peer_esusu_members', 'org_loans', 'subscriptions')
       ORDER BY cl.relname, c.conname
    LOOP RAISE NOTICE 'CHECK % : %', r.t, left(r.def, 240); END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'checks failed: %', SQLERRM; END;

  BEGIN
    RAISE NOTICE '── triggers (non-internal) on the same tables ──';
    FOR r IN
      SELECT cl.relname AS t, t.tgname, regexp_replace(pg_get_triggerdef(t.oid), '^CREATE( CONSTRAINT)? TRIGGER \S+ ', '') AS def
        FROM pg_trigger t JOIN pg_class cl ON cl.oid = t.tgrelid JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = 'public'
       WHERE NOT t.tgisinternal AND cl.relname = ANY (tbls)
       ORDER BY cl.relname, t.tgname
    LOOP RAISE NOTICE 'TRG % % : %', r.t, r.tgname, left(r.def, 220); END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'triggers failed: %', SQLERRM; END;

  BEGIN
    RAISE NOTICE '── unique indexes on the same tables ──';
    FOR r IN
      SELECT i.tablename AS t, i.indexname, regexp_replace(i.indexdef, '^CREATE UNIQUE INDEX \S+ ON \S+ ', '') AS def
        FROM pg_indexes i JOIN pg_class ic ON ic.relname = i.indexname JOIN pg_index x ON x.indexrelid = ic.oid AND x.indisunique AND NOT x.indisprimary
       WHERE i.schemaname = 'public' AND i.tablename = ANY (tbls)
       ORDER BY i.tablename, i.indexname
    LOOP RAISE NOTICE 'UQ % % : %', r.t, r.indexname, left(r.def, 200); END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'unique failed: %', SQLERRM; END;

  BEGIN
    RAISE NOTICE '── auth.refresh_tokens.user_id type, auth.users unique indexes, auth triggers ──';
    FOR r IN SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'refresh_tokens' AND column_name IN ('user_id', 'session_id')
    LOOP RAISE NOTICE 'auth.refresh_tokens.% : %', r.column_name, r.data_type; END LOOP;
    FOR r IN SELECT i.indexname, left(i.indexdef, 200) AS def FROM pg_indexes i JOIN pg_class ic ON ic.relname = i.indexname JOIN pg_index x ON x.indexrelid = ic.oid AND x.indisunique
              WHERE i.schemaname = 'auth' AND i.tablename = 'users'
    LOOP RAISE NOTICE 'auth.users UQ % : %', r.indexname, r.def; END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'auth failed: %', SQLERRM; END;

  BEGIN
    RAISE NOTICE '── Postgres version, and whether sha256() exists ──';
    RAISE NOTICE 'version=% sha256=%', current_setting('server_version'), (SELECT count(*) FROM pg_proc WHERE proname = 'sha256');
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'version failed: %', SQLERRM; END;
END $$;
