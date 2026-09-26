-- READ-ONLY diagnostic (no writes): where does personal data live, and what depends on a user? (for in-app account deletion)
--
-- Prints STRUCTURE only — table / column names, foreign keys, storage bucket names. No row values are printed.
-- Read with:  gh run view <id> --log | grep NOTICE
DO $$
DECLARE r record;
BEGIN
  BEGIN
    RAISE NOTICE '── columns that look personal, per table (name | type) ──';
    FOR r IN
      SELECT c.table_name, string_agg(c.column_name || ':' || c.data_type, ', ' ORDER BY c.ordinal_position) AS cols
        FROM information_schema.columns c
        JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
       WHERE c.table_schema = 'public'
         AND c.column_name ~* '(name|phone|email|address|nin|bvn|birth|dob|kin|account_number|account_name|image|photo|avatar|signature|passport|id_card|selfie|proof|document|otp|pin|token|device|ip_|_ip|lat|lng|location|note)'
         AND c.column_name !~* '(^id$|_id$|username_hint|business_name_hint|planning|admin_notes_x)'
       GROUP BY c.table_name ORDER BY c.table_name
    LOOP RAISE NOTICE 'T % : %', r.table_name, r.cols; END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'personal columns failed: %', SQLERRM; END;

  BEGIN
    RAISE NOTICE '── foreign keys to auth.users (table.column → on delete) ──';
    FOR r IN
      SELECT cl.relname AS tbl, a.attname AS col, CASE c.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'r' THEN 'RESTRICT' WHEN 'a' THEN 'NO ACTION' ELSE c.confdeltype::text END AS del
        FROM pg_constraint c
        JOIN pg_class cl ON cl.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = 'public'
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
       WHERE c.contype = 'f' AND c.confrelid = 'auth.users'::regclass
       ORDER BY cl.relname, a.attname
    LOOP RAISE NOTICE 'FK % . % → %', r.tbl, r.col, r.del; END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'auth fk failed: %', SQLERRM; END;

  BEGIN
    RAISE NOTICE '── foreign keys to public.profiles ──';
    FOR r IN
      SELECT cl.relname AS tbl, a.attname AS col, CASE c.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'r' THEN 'RESTRICT' WHEN 'a' THEN 'NO ACTION' ELSE c.confdeltype::text END AS del
        FROM pg_constraint c
        JOIN pg_class cl ON cl.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = 'public'
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
       WHERE c.contype = 'f' AND c.confrelid = 'public.profiles'::regclass
       ORDER BY cl.relname, a.attname
    LOOP RAISE NOTICE 'FK % . % → %', r.tbl, r.col, r.del; END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'profiles fk failed: %', SQLERRM; END;

  BEGIN
    RAISE NOTICE '── every public table that has a user_id / owner_id / client_user_id / member_user_id style column ──';
    FOR r IN
      SELECT c.table_name, string_agg(c.column_name, ', ' ORDER BY c.column_name) AS cols
        FROM information_schema.columns c
        JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
       WHERE c.table_schema = 'public' AND c.column_name ~* '^(user_id|owner_id|client_user_id|member_user_id|staff_user_id|created_by|creator_id|requested_by|approved_by|recorded_by|actor_id)$'
       GROUP BY c.table_name ORDER BY c.table_name
    LOOP RAISE NOTICE 'U % : %', r.table_name, r.cols; END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'user columns failed: %', SQLERRM; END;

  BEGIN
    RAISE NOTICE '── storage buckets (name, public?) and object counts ──';
    FOR r IN SELECT b.id, b.public, (SELECT count(*) FROM storage.objects o WHERE o.bucket_id = b.id) AS n FROM storage.buckets b ORDER BY b.id
    LOOP RAISE NOTICE 'bucket % public=% objects=%', r.id, r.public, r.n; END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'storage failed: %', SQLERRM; END;

  BEGIN
    RAISE NOTICE '── does verify_txn_pin exist, and its argument list ──';
    FOR r IN SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
              WHERE p.proname IN ('verify_txn_pin', 'txn_pin_status', 'set_txn_pin', 'has_txn_pin')
    LOOP RAISE NOTICE 'fn %(%) definer=%', r.proname, r.args, r.prosecdef; END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fn list failed: %', SQLERRM; END;

  BEGIN
    RAISE NOTICE '── triggers on auth.users (handle_new_user etc.) ──';
    FOR r IN SELECT t.tgname, pg_get_triggerdef(t.oid) AS def FROM pg_trigger t WHERE t.tgrelid = 'auth.users'::regclass AND NOT t.tgisinternal
    LOOP RAISE NOTICE 'trigger % : %', r.tgname, left(r.def, 200); END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'auth triggers failed: %', SQLERRM; END;
END $$;
