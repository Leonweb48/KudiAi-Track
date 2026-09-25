-- READ-ONLY security audit (no writes, no data — names/flags only). Read with:  gh run view <id> --log | grep NOTICE
-- Each section is isolated so one failure cannot hide the others.

-- 1. RLS: public tables with RLS OFF, and which app roles hold table privileges on them
DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT c.relname,
           has_table_privilege('anon', c.oid, 'SELECT') AS anon_sel,
           has_table_privilege('anon', c.oid, 'INSERT,UPDATE,DELETE') AS anon_w,
           has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_sel,
           has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE') AS auth_w
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity
     ORDER BY c.relname
  LOOP
    n := n + 1;
    RAISE NOTICE 'sec1 | RLS OFF table=% anon_read=% anon_write=% auth_read=% auth_write=%', r.relname, r.anon_sel, r.anon_w, r.auth_sel, r.auth_w;
  END LOOP;
  RAISE NOTICE 'sec1 | total tables with RLS off = %', n;
  RAISE NOTICE 'sec1 | tables with RLS on = %', (SELECT count(*) FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE ns.nspname='public' AND c.relkind IN ('r','p') AND c.relrowsecurity);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'sec1 | error: %', SQLERRM;
END $$;

-- 2. Policies that let anon/public in, or that are wide open (USING true) for authenticated
DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT tablename, policyname, cmd, roles::text AS roles, regexp_replace(coalesce(qual,'-'), '\s+', ' ', 'g') AS q, regexp_replace(coalesce(with_check,'-'), '\s+', ' ', 'g') AS wc
      FROM pg_policies
     WHERE schemaname = 'public'
       AND ( roles::text ~ '(anon|public)'
             OR (coalesce(trim(qual),'true') IN ('true','(true)') AND cmd IN ('SELECT','UPDATE','DELETE','ALL'))
             OR (coalesce(trim(with_check),'') IN ('true','(true)') AND cmd IN ('INSERT','UPDATE','ALL')) )
     ORDER BY tablename, policyname
     LIMIT 150
  LOOP
    n := n + 1;
    RAISE NOTICE 'sec2 | table=% policy="%" cmd=% roles=% using=% check=%', r.tablename, left(r.policyname, 50), r.cmd, r.roles, left(r.q, 110), left(r.wc, 60);
  END LOOP;
  RAISE NOTICE 'sec2 | listed % open-ish policies', n;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'sec2 | error: %', SQLERRM;
END $$;

-- 3. SECURITY DEFINER functions callable by anon (includes the implicit PUBLIC grant), flagged if the body never checks the caller
DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig,
           (p.prosrc ~* 'auth\.uid\(|auth\.jwt\(|auth\.role\(|request\.jwt|request\.header|service_role|is_admin|is_super|verify_|cron_secret') AS checks_caller,
           (p.proconfig::text ~ 'search_path') AS pinned
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.prokind = 'f' AND p.prosecdef
       AND p.prorettype <> 'trigger'::regtype
       AND has_function_privilege('anon', p.oid, 'EXECUTE')
     ORDER BY 1
  LOOP
    n := n + 1;
    RAISE NOTICE 'sec3 | ANON can execute definer fn % | checks_caller=% search_path_pinned=%', r.sig, r.checks_caller, r.pinned;
  END LOOP;
  RAISE NOTICE 'sec3 | total definer functions executable by anon = %', n;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'sec3 | error: %', SQLERRM;
END $$;

-- 4. SECURITY DEFINER functions callable by any logged-in user whose body never looks at who the caller is (cross-tenant/IDOR candidates)
DO $$
DECLARE r record; n int := 0; tot int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.prokind = 'f' AND p.prosecdef
       AND p.prorettype <> 'trigger'::regtype
       AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
       AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
       AND NOT (p.prosrc ~* 'auth\.uid\(|auth\.jwt\(|auth\.role\(|request\.jwt|request\.header|service_role|is_admin|is_super|cron_secret|get_my_staff|staff_can|is_owner|current_user')
     ORDER BY 1
  LOOP
    n := n + 1;
    IF n <= 120 THEN RAISE NOTICE 'sec4 | AUTHENTICATED can execute definer fn WITHOUT any caller check: %', r.sig; END IF;
  END LOOP;
  RAISE NOTICE 'sec4 | total = %', n;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'sec4 | error: %', SQLERRM;
END $$;

-- 5. SECURITY DEFINER functions that do NOT pin search_path (search_path hijack risk)
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.prokind = 'f' AND p.prosecdef AND coalesce(p.proconfig::text, '') !~ 'search_path';
  RAISE NOTICE 'sec5 | definer functions without a pinned search_path = %', n;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'sec5 | error: %', SQLERRM;
END $$;

-- 6. Views that bypass RLS (owner-privileged) and are readable by app roles
DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT c.relname, has_table_privilege('anon', c.oid, 'SELECT') AS anon_sel, has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_sel,
           coalesce(c.reloptions::text, '') ~ 'security_invoker=(true|on)' AS invoker
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind IN ('v','m')
     ORDER BY c.relname
  LOOP
    n := n + 1;
    RAISE NOTICE 'sec6 | view=% security_invoker=% anon_read=% auth_read=%', r.relname, r.invoker, r.anon_sel, r.auth_sel;
  END LOOP;
  RAISE NOTICE 'sec6 | views = %', n;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'sec6 | error: %', SQLERRM;
END $$;

-- 7. Storage: buckets and any policy open to anon/public
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id, public, file_size_limit, allowed_mime_types IS NOT NULL AS mime_limited FROM storage.buckets ORDER BY id LOOP
    RAISE NOTICE 'sec7 | bucket=% public=% size_limit=% mime_limited=%', r.id, r.public, r.file_size_limit, r.mime_limited;
  END LOOP;
  FOR r IN SELECT policyname, cmd, roles::text AS roles, left(regexp_replace(coalesce(qual, coalesce(with_check,'-')), '\s+', ' ', 'g'), 130) AS q
             FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' ORDER BY policyname LOOP
    RAISE NOTICE 'sec7 | storage policy="%" cmd=% roles=% expr=%', left(r.policyname, 55), r.cmd, r.roles, r.q;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'sec7 | error: %', SQLERRM;
END $$;

-- 8. Scheduled jobs: do any embed a bearer token / secret in their command text?  Vault secret NAMES only.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobname, schedule, (command ~ 'eyJ[A-Za-z0-9_-]{20,}') AS has_jwt, (command ~* 'service_role') AS mentions_service_role, (command ~* '(secret|password|apikey|api_key)\s*[:=]\s*''[^'']{8,}''') AS has_literal_secret FROM cron.job ORDER BY jobname LOOP
    RAISE NOTICE 'sec8 | cron job=% schedule=% embeds_jwt=% mentions_service_role=% literal_secret=%', r.jobname, r.schedule, r.has_jwt, r.mentions_service_role, r.has_literal_secret;
  END LOOP;
  FOR r IN SELECT name FROM vault.secrets ORDER BY name LOOP
    RAISE NOTICE 'sec8 | vault secret name=%', r.name;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'sec8 | error: %', SQLERRM;
END $$;

-- 9. Sensitive-looking tables/columns exposed to app roles (names only)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_name, c.column_name,
           has_column_privilege('anon', format('public.%I', c.table_name), c.column_name, 'SELECT') AS anon_read,
           has_column_privilege('authenticated', format('public.%I', c.table_name), c.column_name, 'SELECT') AS auth_read
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.column_name ~* '(password|passwd|secret|token|api_key|apikey|private_key|pin_hash|bvn|nin|otp|card_number|cvv|account_number|refresh)'
       AND c.table_name IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public')
     ORDER BY c.table_name, c.column_name
     LIMIT 120
  LOOP
    RAISE NOTICE 'sec9 | %.% anon_read=% auth_read=%', r.table_name, r.column_name, r.anon_read, r.auth_read;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'sec9 | error: %', SQLERRM;
END $$;
