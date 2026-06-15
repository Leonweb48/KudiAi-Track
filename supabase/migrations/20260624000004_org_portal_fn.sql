-- Drop the JWT policy that causes infinite recursion
DROP POLICY IF EXISTS "coop_org_portal_jwt" ON public.organizations;
DROP POLICY IF EXISTS "coop_org_portal_read" ON public.organizations;

-- Security-definer function: returns the org row for the calling user's portal_user_id
-- Bypasses RLS so no recursion is possible
CREATE OR REPLACE FUNCTION public.get_my_org()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT to_jsonb(o)
  FROM public.organizations o
  WHERE o.portal_user_id = auth.uid()
    AND o.status = 'active'
  LIMIT 1;
$$;
