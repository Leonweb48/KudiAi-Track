-- Post-migration grant audit: find any SECURITY DEFINER function that anon or
-- authenticated can still EXECUTE. Run after every migration that creates or
-- recreates a SECURITY DEFINER function. Zero rows = clean.
--
-- Usage: supabase db query --linked --file supabase/scripts/audit_fn_grants.sql

SELECT
  p.proname                                                   AS func_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid)       AS args,
  r.rolname                                                   AS grantee
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_roles     r ON has_function_privilege(r.oid, p.oid, 'EXECUTE')
WHERE n.nspname   = 'public'
  AND p.prosecdef = true                    -- SECURITY DEFINER only
  AND r.rolname  IN ('anon', 'authenticated')
ORDER BY p.proname, r.rolname;
