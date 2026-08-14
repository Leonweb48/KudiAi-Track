-- P1-15: Create hash_admin_pin RPC for bcrypt-hashing admin 2FA PINs.
-- verify_bcrypt_pin (from 20261102000001) handles verification for both admin and ajo-client PINs.
-- Existing SHA-256 admin hashes are upgraded lazily on next successful PIN verification in the app.

CREATE OR REPLACE FUNCTION public.hash_admin_pin(p_pin TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
VOLATILE
AS $$
BEGIN
  RETURN extensions.crypt(p_pin, extensions.gen_salt('bf', 8));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.hash_admin_pin(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.hash_admin_pin(TEXT) TO service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  '20261102000002',
  'admin_pin_bcrypt',
  ARRAY[
    'CREATE OR REPLACE FUNCTION public.hash_admin_pin(p_pin TEXT) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions VOLATILE AS $f$ BEGIN RETURN extensions.crypt(p_pin, extensions.gen_salt(''bf'', 8)); END; $f$',
    'REVOKE EXECUTE ON FUNCTION public.hash_admin_pin(TEXT) FROM PUBLIC',
    'GRANT EXECUTE ON FUNCTION public.hash_admin_pin(TEXT) TO service_role'
  ]
)
ON CONFLICT (version) DO NOTHING;
