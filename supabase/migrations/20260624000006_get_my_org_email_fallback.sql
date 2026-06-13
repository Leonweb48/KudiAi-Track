-- Upgrade get_my_org() to recover from broken portal_user_id links.
-- Primary lookup: portal_user_id = auth.uid() (normal case).
-- Fallback lookup: org email = auth user's email (when setup-org-portal failed to save portal_user_id).
-- If found via email fallback, auto-fixes portal_user_id so the primary path works next time.
-- Only used for org portal users (account_type = 'organisation'); business owner emails
-- rarely match an org contact email, so false matches are extremely unlikely.
CREATE OR REPLACE FUNCTION public.get_my_org()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_email text := auth.jwt() ->> 'email';
  v_org  jsonb;
  v_org_id uuid;
BEGIN
  -- Primary: find by portal_user_id
  SELECT to_jsonb(o), o.id INTO v_org, v_org_id
  FROM public.organizations o
  WHERE o.portal_user_id = v_uid
  LIMIT 1;

  -- Fallback: find by the org's email matching this auth user's email.
  -- This recovers from cases where the portal_user_id update failed silently.
  IF v_org IS NULL AND v_email IS NOT NULL THEN
    SELECT to_jsonb(o), o.id INTO v_org, v_org_id
    FROM public.organizations o
    WHERE o.email = v_email
      AND (o.portal_user_id IS NULL OR o.portal_user_id = v_uid)
    LIMIT 1;

    -- Auto-fix: save portal_user_id so primary path works next time
    IF v_org IS NOT NULL THEN
      UPDATE public.organizations
      SET portal_user_id = v_uid
      WHERE id = v_org_id;

      -- Re-fetch the now-updated row
      SELECT to_jsonb(o) INTO v_org
      FROM public.organizations o
      WHERE o.id = v_org_id;
    END IF;
  END IF;

  RETURN v_org;
END;
$$;
