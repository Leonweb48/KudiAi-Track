-- Fix infinite recursion in org_members (and related tables) RLS policies.
--
-- Root cause:
--   coop_members_owner (ALL on org_members):
--     org_id IN (SELECT id FROM organizations WHERE owner_id = auth.uid())
--   This SELECT on organizations triggers org_members_read_own_org:
--     id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
--   That SELECT on org_members triggers coop_members_owner again → ∞
--
-- Fix: SECURITY DEFINER helper bypasses RLS when fetching owned org IDs,
--      breaking the recursion at the first step.

CREATE OR REPLACE FUNCTION public.my_owned_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT id FROM public.organizations WHERE owner_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.my_owned_org_ids() TO authenticated;

-- Re-create all coop_*_owner policies using the SECURITY DEFINER function
DROP POLICY IF EXISTS "coop_members_owner"    ON public.org_members;
DROP POLICY IF EXISTS "coop_savings_owner"    ON public.org_savings;
DROP POLICY IF EXISTS "coop_loans_owner"      ON public.org_loans;
DROP POLICY IF EXISTS "coop_repayments_owner" ON public.org_loan_repayments;
DROP POLICY IF EXISTS "coop_meetings_owner"   ON public.org_meetings;
DROP POLICY IF EXISTS "coop_attendance_owner" ON public.org_attendance;
DROP POLICY IF EXISTS "coop_wallet_owner"     ON public.org_wallet_txns;

CREATE POLICY "coop_members_owner"
  ON public.org_members FOR ALL
  USING (org_id IN (SELECT my_owned_org_ids()));

CREATE POLICY "coop_savings_owner"
  ON public.org_savings FOR ALL
  USING (org_id IN (SELECT my_owned_org_ids()));

CREATE POLICY "coop_loans_owner"
  ON public.org_loans FOR ALL
  USING (org_id IN (SELECT my_owned_org_ids()));

CREATE POLICY "coop_repayments_owner"
  ON public.org_loan_repayments FOR ALL
  USING (org_id IN (SELECT my_owned_org_ids()));

CREATE POLICY "coop_meetings_owner"
  ON public.org_meetings FOR ALL
  USING (org_id IN (SELECT my_owned_org_ids()));

CREATE POLICY "coop_attendance_owner"
  ON public.org_attendance FOR ALL
  USING (org_id IN (SELECT my_owned_org_ids()));

CREATE POLICY "coop_wallet_owner"
  ON public.org_wallet_txns FOR ALL
  USING (org_id IN (SELECT my_owned_org_ids()));
