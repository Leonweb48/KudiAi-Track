-- Fix 1: Allow org members to read their own record (needed for useAuth detection)
DROP POLICY IF EXISTS "org_members_read_own" ON public.org_members;
CREATE POLICY "org_members_read_own" ON public.org_members
  FOR SELECT
  USING (auth.uid() = user_id);

-- Fix 2: Allow org members to read the organisation they belong to (needed for useAuth join)
DROP POLICY IF EXISTS "org_members_read_own_org" ON public.organizations;
CREATE POLICY "org_members_read_own_org" ON public.organizations
  FOR SELECT
  USING (
    id IN (
      SELECT org_id FROM public.org_members WHERE user_id = auth.uid()
    )
  );

-- Fix 3: Allow staff to read the branch they are assigned to (needed for branch selector)
DROP POLICY IF EXISTS "staff_read_own_branch" ON public.branches;
CREATE POLICY "staff_read_own_branch" ON public.branches
  FOR SELECT
  USING (
    id IN (
      SELECT branch_id FROM public.staff
      WHERE user_id = auth.uid() AND branch_id IS NOT NULL
    )
  );
