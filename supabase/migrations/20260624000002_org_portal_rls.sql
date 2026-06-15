-- Allow the org portal user to read their own organisation row
CREATE POLICY "coop_org_portal_read" ON public.organizations
  FOR SELECT USING (portal_user_id = auth.uid());
