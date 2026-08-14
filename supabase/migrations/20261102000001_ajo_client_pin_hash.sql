-- P1-14: Hash aso_clients.portal_pin (transaction PIN) with bcrypt
-- Adds portal_pin_hash column, migrates existing plaintext PINs, clears plaintext.
-- Creates verify_bcrypt_pin(p_pin, p_hash) — reusable for any bcrypt comparison.

ALTER TABLE public.aso_clients ADD COLUMN IF NOT EXISTS portal_pin_hash TEXT;

-- Hash all existing plaintext PINs in-place with bcrypt (bf=8 rounds, same as org_members)
UPDATE public.aso_clients
SET portal_pin_hash = extensions.crypt(portal_pin, extensions.gen_salt('bf', 8))
WHERE portal_pin IS NOT NULL AND portal_pin <> '' AND portal_pin_hash IS NULL;

-- Clear the plaintext column for all rows that now have a hash
UPDATE public.aso_clients
SET portal_pin = NULL
WHERE portal_pin_hash IS NOT NULL;

-- Generic bcrypt comparison — takes the plaintext and stored bcrypt hash, returns boolean.
-- Works for any bcrypt hash (aso_clients, admin_users, or future tables).
CREATE OR REPLACE FUNCTION public.verify_bcrypt_pin(p_pin TEXT, p_hash TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
STABLE
AS $$
BEGIN
  IF p_hash IS NULL THEN RETURN FALSE; END IF;
  RETURN extensions.crypt(p_pin, p_hash) = p_hash;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.verify_bcrypt_pin(TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.verify_bcrypt_pin(TEXT, TEXT) TO service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  '20261102000001',
  'ajo_client_pin_hash',
  ARRAY[
    'ALTER TABLE public.aso_clients ADD COLUMN IF NOT EXISTS portal_pin_hash TEXT',
    'UPDATE public.aso_clients SET portal_pin_hash = extensions.crypt(portal_pin, extensions.gen_salt(''bf'', 8)) WHERE portal_pin IS NOT NULL AND portal_pin <> '''' AND portal_pin_hash IS NULL',
    'UPDATE public.aso_clients SET portal_pin = NULL WHERE portal_pin_hash IS NOT NULL',
    'CREATE OR REPLACE FUNCTION public.verify_bcrypt_pin(p_pin TEXT, p_hash TEXT) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions STABLE AS $f$ BEGIN IF p_hash IS NULL THEN RETURN FALSE; END IF; RETURN extensions.crypt(p_pin, p_hash) = p_hash; END; $f$',
    'REVOKE EXECUTE ON FUNCTION public.verify_bcrypt_pin(TEXT, TEXT) FROM PUBLIC',
    'GRANT EXECUTE ON FUNCTION public.verify_bcrypt_pin(TEXT, TEXT) TO service_role'
  ]
)
ON CONFLICT (version) DO NOTHING;
