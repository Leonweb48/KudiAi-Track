-- SECURITY DEFINER function to fetch the calling user's org_members record.
-- Bypasses RLS so the organizations join never triggers the recursive policy
-- (org_members_read_own_org → sub-SELECT on org_members → policy re-evaluated).
-- Also handles the case where user_id was never saved on the member row
-- (add-member bug) by falling back to a case-insensitive email match.

CREATE OR REPLACE FUNCTION public.get_my_membership()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_email  text := lower(auth.jwt() ->> 'email');
  v_row    public.org_members%ROWTYPE;
  v_org    jsonb;
BEGIN
  -- Primary path: user_id match (fast, expected for all normal logins)
  SELECT * INTO v_row
  FROM public.org_members
  WHERE user_id = v_uid AND status = 'active'
  LIMIT 1;

  -- Fallback: email match when user_id was never written (registration edge-case)
  IF v_row.id IS NULL AND v_email IS NOT NULL THEN
    SELECT * INTO v_row
    FROM public.org_members
    WHERE lower(email) = v_email AND status = 'active'
    LIMIT 1;

    -- Auto-fix: persist user_id so the primary path works on the next login
    IF v_row.id IS NOT NULL THEN
      UPDATE public.org_members SET user_id = v_uid WHERE id = v_row.id;
    END IF;
  END IF;

  IF v_row.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Fetch the organization row separately (avoids any RLS recursion on the join)
  SELECT to_jsonb(o) INTO v_org
  FROM public.organizations o
  WHERE o.id = v_row.org_id;

  RETURN to_jsonb(v_row) || jsonb_build_object('organizations', v_org);
END;
$$;

-- Grant execute to authenticated users (they can only see their own row because
-- the function uses auth.uid() / auth.jwt() internally)
GRANT EXECUTE ON FUNCTION public.get_my_membership() TO authenticated;
