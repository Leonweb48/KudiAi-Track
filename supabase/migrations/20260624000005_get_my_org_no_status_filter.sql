-- Remove status = 'active' filter from get_my_org() so inactive org portal users
-- are still caught by the auth routing and shown an appropriate error message
-- rather than falling through to business onboarding.
CREATE OR REPLACE FUNCTION public.get_my_org()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT to_jsonb(o)
  FROM public.organizations o
  WHERE o.portal_user_id = auth.uid()
  LIMIT 1;
$$;
