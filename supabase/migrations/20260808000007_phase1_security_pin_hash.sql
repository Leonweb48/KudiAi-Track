-- Phase 1 security: hash org_member portal PINs with bcrypt
-- RLS on org_withdrawal_items and org_meeting_rsvp already org-scoped (fixed in 000002/000003)

-- 1. Add hash column
ALTER TABLE public.org_members ADD COLUMN IF NOT EXISTS portal_pin_hash TEXT;

-- 2. Hash all existing PINs (bcrypt cost 8, same as admin txn_pin_hash pattern)
UPDATE public.org_members
SET portal_pin_hash = extensions.crypt(COALESCE(portal_pin, '0000'), extensions.gen_salt('bf', 8))
WHERE portal_pin_hash IS NULL;

-- 3. Remove plaintext PINs from existing rows (keep column for rollback, just clear values)
UPDATE public.org_members SET portal_pin = NULL WHERE portal_pin_hash IS NOT NULL;

-- 4. Verify PIN — called by edge function instead of plain-text comparison
CREATE OR REPLACE FUNCTION public.verify_member_pin(p_member_id UUID, p_pin TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
STABLE
AS $$
DECLARE
  v_hash TEXT;
BEGIN
  SELECT portal_pin_hash INTO v_hash FROM public.org_members WHERE id = p_member_id;
  IF v_hash IS NULL THEN RETURN FALSE; END IF;
  RETURN extensions.crypt(p_pin, v_hash) = v_hash;
END;
$$;

-- 5. Hash a PIN — called by edge function when setting/resetting a PIN
CREATE OR REPLACE FUNCTION public.hash_member_pin(p_pin TEXT)
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

-- 6. Lock down: revoke from public, grant only to service_role
REVOKE EXECUTE ON FUNCTION public.verify_member_pin(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.hash_member_pin(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_member_pin(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.hash_member_pin(TEXT) TO service_role;

-- Register migration
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  '20260808000007',
  'phase1_security_pin_hash',
  ARRAY[
    'ALTER TABLE public.org_members ADD COLUMN IF NOT EXISTS portal_pin_hash TEXT',
    'UPDATE public.org_members SET portal_pin_hash = extensions.crypt(COALESCE(portal_pin, ''0000''), extensions.gen_salt(''bf'', 8)) WHERE portal_pin_hash IS NULL',
    'UPDATE public.org_members SET portal_pin = NULL WHERE portal_pin_hash IS NOT NULL',
    'CREATE OR REPLACE FUNCTION public.verify_member_pin(p_member_id UUID, p_pin TEXT) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions STABLE AS $f$ DECLARE v_hash TEXT; BEGIN SELECT portal_pin_hash INTO v_hash FROM public.org_members WHERE id = p_member_id; IF v_hash IS NULL THEN RETURN FALSE; END IF; RETURN extensions.crypt(p_pin, v_hash) = v_hash; END; $f$',
    'CREATE OR REPLACE FUNCTION public.hash_member_pin(p_pin TEXT) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions VOLATILE AS $f$ BEGIN RETURN extensions.crypt(p_pin, extensions.gen_salt(''bf'', 8)); END; $f$',
    'REVOKE EXECUTE ON FUNCTION public.verify_member_pin(UUID, TEXT) FROM PUBLIC',
    'REVOKE EXECUTE ON FUNCTION public.hash_member_pin(TEXT) FROM PUBLIC',
    'GRANT EXECUTE ON FUNCTION public.verify_member_pin(UUID, TEXT) TO service_role',
    'GRANT EXECUTE ON FUNCTION public.hash_member_pin(TEXT) TO service_role'
  ]
)
ON CONFLICT (version) DO NOTHING;
