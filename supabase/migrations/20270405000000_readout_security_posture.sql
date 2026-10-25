-- READ-ONLY (2026-10-25): security posture of the live database for the owner's audit. Object NAMES only (no rows,
-- no values). The run log is deleted right after reading. No writes.
DO $$
DECLARE r record; n int;
BEGIN
  -- 1. public tables without row-level security that anon/authenticated can touch
  FOR r IN
    SELECT c.relname,
           has_table_privilege('anon', c.oid, 'SELECT') a_sel, has_table_privilege('anon', c.oid, 'INSERT') a_ins,
           has_table_privilege('authenticated', c.oid, 'SELECT') u_sel, has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE') u_wr
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
       AND (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE'))
     ORDER BY 1 LOOP
    RAISE NOTICE 'S1 no-RLS % | anon sel=% ins=% | auth sel=% write=%', r.relname, r.a_sel, r.a_ins, r.u_sel, r.u_wr;
  END LOOP;
  -- 2. policies open to anon / public
  FOR r IN
    SELECT tablename, policyname, cmd, roles::text, left(coalesce(qual, ''), 80) q, left(coalesce(with_check, ''), 80) w
      FROM pg_policies WHERE schemaname = 'public' AND (roles && ARRAY['anon', 'public']::name[]) ORDER BY 1, 2 LOOP
    RAISE NOTICE 'S2 anon-policy % | % | % | % | using=% | check=%', r.tablename, r.policyname, r.cmd, r.roles, r.q, r.w;
  END LOOP;
  -- 3. policies letting ANY logged-in user read / write ALL rows (qual or check literally true)
  FOR r IN
    SELECT tablename, policyname, cmd, roles::text, coalesce(qual, '') q, coalesce(with_check, '') w
      FROM pg_policies WHERE schemaname = 'public' AND (roles && ARRAY['authenticated']::name[])
       AND (coalesce(qual, '') IN ('true', '(true)') OR coalesce(with_check, '') IN ('true', '(true)')) ORDER BY 1 LOOP
    RAISE NOTICE 'S3 all-rows % | % | % | using=% | check=%', r.tablename, r.policyname, r.cmd, r.q, r.w;
  END LOOP;
  -- 4. SECURITY DEFINER functions anon can execute
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) args FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.prosecdef AND has_function_privilege('anon', p.oid, 'EXECUTE') ORDER BY 1 LOOP
    RAISE NOTICE 'S4 anon-definer %(%)', r.proname, left(r.args, 120);
  END LOOP;
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.prosecdef AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
  RAISE NOTICE 'S5 definer fns callable by any logged-in user: %', n;
  -- 5. of those, the money / admin sounding ones
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) args FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.prosecdef AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
       AND p.proname ~* '(wallet|credit|debit|transfer|payout|withdraw|approve|admin|refund|balance|reward|cashback|referral|settle|fund|ledger|coupon|promo|fee|kyc|tier|pin|otp|role|grant|freeze|reverse|bonus|point)'
     ORDER BY 1 LOOP
    RAISE NOTICE 'S6 auth-definer %(%)', r.proname, left(r.args, 140);
  END LOOP;
  -- 6. views that bypass RLS (not security_invoker) readable by anon/authenticated
  FOR r IN
    SELECT c.relname, has_table_privilege('anon', c.oid, 'SELECT') a, has_table_privilege('authenticated', c.oid, 'SELECT') u
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind IN ('v', 'm')
       AND NOT coalesce((SELECT bool_or(opt = 'security_invoker=true' OR opt = 'security_invoker=on') FROM unnest(c.reloptions) opt), false)
       AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('authenticated', c.oid, 'SELECT')) ORDER BY 1 LOOP
    RAISE NOTICE 'S7 rls-bypass-view % | anon=% auth=%', r.relname, r.a, r.u;
  END LOOP;
  -- 7. storage
  FOR r IN SELECT id, public, file_size_limit, coalesce(array_length(allowed_mime_types, 1), 0) mimes FROM storage.buckets ORDER BY 1 LOOP
    RAISE NOTICE 'S8 bucket % public=% size_limit=% mime_types=%', r.id, r.public, r.file_size_limit, r.mimes;
  END LOOP;
  FOR r IN
    SELECT policyname, cmd, roles::text, left(coalesce(qual, ''), 120) q, left(coalesce(with_check, ''), 120) w
      FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND (roles && ARRAY['anon', 'public']::name[]) ORDER BY 1 LOOP
    RAISE NOTICE 'S9 storage-anon % | % | % | using=% | check=%', r.policyname, r.cmd, r.roles, r.q, r.w;
  END LOOP;
  -- 8. the safety-net cron is still scheduled?
  BEGIN
    RAISE NOTICE 'S10 cron security-revoke-anon-definer scheduled: %', (SELECT count(*) FROM cron.job WHERE jobname = 'security-revoke-anon-definer');
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'S10 cron unreadable: %', SQLERRM; END;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
