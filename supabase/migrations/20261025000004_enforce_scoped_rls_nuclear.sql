-- Nuclear re-scope: drop EVERY SELECT policy on transactions/credits/aso_clients,
-- then recreate only the scoped ones. Idempotent — safe to run even if a prior
-- migration already created the scoped policies.

DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname, tablename
    FROM   pg_policies
    WHERE  schemaname = 'public'
      AND  tablename  IN ('transactions', 'credits', 'aso_clients')
      AND  cmd        = 'SELECT'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      pol.policyname,
      pol.tablename
    );
    RAISE NOTICE 'Dropped SELECT policy % on %', pol.policyname, pol.tablename;
  END LOOP;
END $$;

-- ── transactions ─────────────────────────────────────────────────────────────
CREATE POLICY "staff read scoped transactions"
ON public.transactions FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR (
    (public.staff_can(user_id, 'transactions', false)
     OR public.staff_can(user_id, 'bills', false))
    AND (
      staff_id = public.get_my_staff_id()
      OR (
        public.get_my_staff_role() = 'manager'
        AND public.get_my_branch_id() IS NOT NULL
        AND branch_id = public.get_my_branch_id()
      )
    )
  )
);

-- ── credits ──────────────────────────────────────────────────────────────────
CREATE POLICY "staff read scoped credits"
ON public.credits FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR (
    public.staff_can(user_id, 'credit', false)
    AND (
      staff_id = public.get_my_staff_id()
      OR (
        public.get_my_staff_role() = 'manager'
        AND public.get_my_branch_id() IS NOT NULL
        AND branch_id = public.get_my_branch_id()
      )
    )
  )
);

-- ── aso_clients ───────────────────────────────────────────────────────────────
-- Note: aso_clients has an existing scoped policy from 20260718000002 that uses
-- ajo_staff_client_visible(). Replace it with the same staff_id/branch_id pattern
-- as transactions and credits for consistent behaviour.
CREATE POLICY "staff read scoped aso clients"
ON public.aso_clients FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR (
    public.staff_can(user_id, 'aso', false)
    AND (
      staff_id = public.get_my_staff_id()
      OR (
        public.get_my_staff_role() = 'manager'
        AND public.get_my_branch_id() IS NOT NULL
        AND branch_id = public.get_my_branch_id()
      )
    )
  )
);
