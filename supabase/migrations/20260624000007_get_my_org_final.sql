-- Final get_my_org(): case-insensitive email comparison + safe search_path
-- Also restores the simple portal_user_id RLS policy so direct client queries work too.

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
  -- Primary: find by portal_user_id (fast path)
  SELECT to_jsonb(o), o.id INTO v_org, v_org_id
  FROM public.organizations o
  WHERE o.portal_user_id = v_uid
  LIMIT 1;

  -- Fallback: case-insensitive email match when portal_user_id was never saved
  IF v_org IS NULL AND v_email IS NOT NULL THEN
    SELECT to_jsonb(o), o.id INTO v_org, v_org_id
    FROM public.organizations o
    WHERE lower(o.email) = v_email
      AND (o.portal_user_id IS NULL OR o.portal_user_id = v_uid)
    LIMIT 1;

    IF v_org IS NOT NULL THEN
      -- Auto-fix: persist portal_user_id so primary path works on next login
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

-- Restore the simple portal_user_id RLS policy (safe — no auth.jwt() call, no recursion risk)
DROP POLICY IF EXISTS "coop_org_portal_read" ON public.organizations;
CREATE POLICY "coop_org_portal_read" ON public.organizations
  FOR SELECT USING (portal_user_id = auth.uid());
