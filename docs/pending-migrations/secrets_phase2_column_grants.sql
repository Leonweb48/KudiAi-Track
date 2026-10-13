-- Secret columns, phase 2: signed-in users (and signed-out visitors) can no longer READ OTP codes, PIN hashes, portal /
-- session tokens or BVN hashes on aso_clients, staff, org_members and profiles — only the server functions (service
-- role) can. Apply only after phones run the app version that selects explicit columns (918f690 / src/shared/safeColumns.js):
-- an older app that selects "*" on these tables gets "permission denied".
-- Every other column stays readable (row-level security still decides WHICH rows). New columns added later are granted
-- automatically within 10 minutes by sync_safe_column_grants() (pg_cron) — secret ones never.

CREATE OR REPLACE FUNCTION public.secret_columns(p_table text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_table
    WHEN 'aso_clients' THEN ARRAY['portal_pin','portal_pin_hash','otp_code','pending_otp','bvn_hash','bvn_verification_reference']
    WHEN 'staff'       THEN ARRAY['otp_code','email_change_otp','bvn_hash','bvn_verification_reference']
    WHEN 'org_members' THEN ARRAY['portal_pin','portal_pin_hash','otp_code','portal_token','member_session_token','pin_reset_otp_hash']
    WHEN 'profiles'    THEN ARRAY['app_pin_hash','txn_pin_hash','pin_reset_token','bvn_hash','bvn_verification_reference']
    ELSE ARRAY[]::text[] END
$$;
REVOKE ALL ON FUNCTION public.secret_columns(text) FROM PUBLIC, anon, authenticated;

-- (Re)grant SELECT on every non-secret column. Idempotent; also picks up columns added since.
CREATE OR REPLACE FUNCTION public.sync_safe_column_grants() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t text; cols text;
BEGIN
  FOREACH t IN ARRAY ARRAY['aso_clients', 'staff', 'org_members', 'profiles'] LOOP
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = t AND column_name <> ALL (public.secret_columns(t));
    IF cols IS NOT NULL THEN
      EXECUTE format('GRANT SELECT (%s) ON public.%I TO authenticated', cols, t);
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_safe_column_grants() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE t text; n_auth int; n_secret_visible int;
BEGIN
  FOREACH t IN ARRAY ARRAY['aso_clients', 'staff', 'org_members', 'profiles'] LOOP
    EXECUTE format('REVOKE SELECT ON public.%I FROM authenticated, anon', t);
  END LOOP;
  PERFORM public.sync_safe_column_grants();
  FOREACH t IN ARRAY ARRAY['aso_clients', 'staff', 'org_members', 'profiles'] LOOP
    SELECT count(*) INTO n_auth FROM information_schema.column_privileges
     WHERE table_schema = 'public' AND table_name = t AND grantee = 'authenticated' AND privilege_type = 'SELECT';
    SELECT count(*) INTO n_secret_visible FROM information_schema.column_privileges
     WHERE table_schema = 'public' AND table_name = t AND grantee IN ('authenticated', 'anon') AND privilege_type = 'SELECT'
       AND column_name = ANY (public.secret_columns(t));
    IF n_secret_visible > 0 THEN RAISE EXCEPTION 'secrets | % still exposes % secret column(s)', t, n_secret_visible; END IF;
    RAISE NOTICE 'secrets | % : signed-in users can read % columns, 0 secret', t, n_auth;
  END LOOP;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('sync-safe-column-grants') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-safe-column-grants');
  PERFORM cron.schedule('sync-safe-column-grants', '*/10 * * * *', 'SELECT public.sync_safe_column_grants()');
  RAISE NOTICE 'secrets | new non-secret columns are granted every 10 minutes';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'secrets | could not schedule the grant sync: %', SQLERRM;
END $$;
