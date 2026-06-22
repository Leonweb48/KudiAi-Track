-- Allow the org portal user (portal_user_id) to read and write all coop tables.
-- Root cause: my_owned_org_ids() only checked owner_id, not portal_user_id.
-- The portal user is a separate Supabase auth account that manages the org;
-- they need the same access as the owner for all cooperative operations.

CREATE OR REPLACE FUNCTION public.my_owned_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT id FROM public.organizations
  WHERE owner_id = auth.uid() OR portal_user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.my_owned_org_ids() TO authenticated;
