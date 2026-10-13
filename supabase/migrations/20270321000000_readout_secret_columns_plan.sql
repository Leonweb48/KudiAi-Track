-- READ-ONLY (2026-10-13): facts for protecting secret columns on aso_clients/staff/org_members/profiles — does Realtime
-- filter columns by privilege, which of the four tables are published, can migrations create event triggers, and how
-- many columns each table has. Booleans/counts only. No writes.
DO $$
DECLARE t text;
BEGIN
  RAISE NOTICE 'S1 realtime.apply_rls mentions column privileges: %',
    COALESCE((SELECT position('column_privilege' IN pg_get_functiondef(p.oid)) > 0
                FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'realtime' AND p.proname = 'apply_rls' LIMIT 1), false);
  FOREACH t IN ARRAY ARRAY['aso_clients', 'staff', 'org_members', 'profiles'] LOOP
    RAISE NOTICE 'S2 % | published: % | columns: % | authenticated column grants: %', t,
      EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = t),
      (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t),
      (SELECT count(*) FROM information_schema.column_privileges WHERE table_schema = 'public' AND table_name = t AND grantee = 'authenticated' AND privilege_type = 'SELECT');
  END LOOP;
  RAISE NOTICE 'S3 migration role % superuser % ; existing event triggers %', current_user,
    (SELECT rolsuper FROM pg_roles WHERE rolname = current_user), (SELECT count(*) FROM pg_event_trigger);
  RAISE NOTICE 'S4 aso_clients rows with a plaintext portal_pin: %', (SELECT count(*) FROM public.aso_clients WHERE portal_pin IS NOT NULL AND portal_pin <> '');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
