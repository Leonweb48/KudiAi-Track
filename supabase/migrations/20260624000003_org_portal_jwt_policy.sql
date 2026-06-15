-- Allow org portal users to read their org via JWT metadata (more reliable than portal_user_id lookup)
CREATE POLICY "coop_org_portal_jwt" ON public.organizations
  FOR SELECT USING (
    (auth.jwt() -> 'user_metadata' ->> 'account_type') = 'organisation'
    AND id = (auth.jwt() -> 'user_metadata' ->> 'org_id')::uuid
  );
