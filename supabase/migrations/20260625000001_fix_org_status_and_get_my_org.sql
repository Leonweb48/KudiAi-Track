-- Fix 1: Ensure all orgs have status = 'active' by default.
-- The create-org action never set a status, leaving it NULL, which caused
-- the useAuth.js "orgRow.status !== 'active'" check to block portal logins.
ALTER TABLE public.organizations
  ALTER COLUMN status SET DEFAULT 'active';

UPDATE public.organizations
  SET status = 'active'
  WHERE status IS NULL;

-- Fix 2: Make get_my_org() email fallback work even when portal_user_id
-- points to a stale/deleted auth user (old condition blocked the fallback).
-- Now the email match alone is sufficient for the fallback; portal_user_id
-- is always corrected to the current user afterward.
CREATE OR REPLACE FUNCTION public.get_my_org()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_email  text := lower(auth.jwt() ->> 'email');
  v_org    jsonb;
  v_org_id uuid;
BEGIN
  -- Primary: find by portal_user_id (fast path — works for every normal login)
  SELECT to_jsonb(o), o.id INTO v_org, v_org_id
  FROM public.organizations o
  WHERE o.portal_user_id = v_uid
  LIMIT 1;

  -- Fallback: case-insensitive email match.
  -- Covers stale portal_user_id (wrong/deleted user ID) and first-time setup
  -- where portal_user_id was never saved.  We auto-fix portal_user_id afterward.
  IF v_org IS NULL AND v_email IS NOT NULL THEN
    SELECT to_jsonb(o), o.id INTO v_org, v_org_id
    FROM public.organizations o
    WHERE lower(o.email) = v_email
    LIMIT 1;

    IF v_org IS NOT NULL THEN
      -- Auto-fix: write correct portal_user_id so primary path works next login
      UPDATE public.organizations
        SET portal_user_id = v_uid
        WHERE id = v_org_id;

      SELECT to_jsonb(o) INTO v_org
      FROM public.organizations o
      WHERE o.id = v_org_id;
    END IF;
  END IF;

  RETURN v_org;
END;
$$;
