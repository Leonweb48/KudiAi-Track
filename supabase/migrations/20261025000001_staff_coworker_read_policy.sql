-- Fix: notifyBranchManager / notifyBranchStaff cannot query coworker rows.
--
-- The existing SELECT policies on the staff table only allow:
--   • owner_all_staff:        owner (auth.uid() = owner_id) can read all staff
--   • staff can read own:     staff can read the row where user_id = auth.uid()
--
-- When a cashier calls notifyBranchManager client-side, the Supabase client
-- is authenticated as the cashier. The function queries:
--   SELECT id, user_id FROM staff WHERE owner_id=? AND branch_id=? AND role='manager'
-- The cashier's auth.uid() matches neither owner_id nor user_id of the manager row,
-- so RLS returns empty → mgr = null → manager is never notified.
--
-- This policy grants staff the minimum read needed to discover coworkers under the
-- same owner — only id and user_id are selected by the notify helpers anyway.

CREATE POLICY "staff can read coworkers"
ON public.staff
FOR SELECT
TO authenticated
USING (
  owner_id IN (
    SELECT owner_id
    FROM   public.staff
    WHERE  user_id = auth.uid()
      AND  status  = 'active'
  )
);
