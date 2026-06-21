-- Allow members to read all active members in their own org.
-- Needed so GroupChat can build the avatarMap for message bubbles.
-- Uses SECURITY DEFINER to avoid triggering the recursive policy chain.

CREATE OR REPLACE FUNCTION public.my_member_org_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT org_id FROM public.org_members WHERE user_id = auth.uid() LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.my_member_org_id() TO authenticated;

DROP POLICY IF EXISTS "org_members_read_same_org" ON public.org_members;
CREATE POLICY "org_members_read_same_org" ON public.org_members
  FOR SELECT
  USING (
    status = 'active'
    AND org_id = (SELECT my_member_org_id())
  );
