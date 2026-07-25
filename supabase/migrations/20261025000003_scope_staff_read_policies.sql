-- Data-scope fix: staff and managers were able to read the full owner dataset.
-- Root cause: RLS on transactions/credits/aso_clients only checked "is this user
-- an active staff member of the owner?" with no column-level restriction on
-- staff_id or branch_id.  Any staff JWT could query the entire transaction history.
--
-- Fix: three SECURITY DEFINER helpers read the caller's staff row without RLS,
-- then the new policies gate reads to:
--   • Owner       → all their rows (user_id = auth.uid())
--   • Manager     → branch rows only (branch_id = their branch)
--   • Staff       → own records only (staff_id = their staff.id)

-- ── Helper functions ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_my_staff_id()
RETURNS UUID LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT id FROM public.staff
  WHERE  user_id = auth.uid() AND status = 'active'
  LIMIT  1;
$$;

CREATE OR REPLACE FUNCTION public.get_my_staff_role()
RETURNS TEXT LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT role FROM public.staff
  WHERE  user_id = auth.uid() AND status = 'active'
  LIMIT  1;
$$;

CREATE OR REPLACE FUNCTION public.get_my_branch_id()
RETURNS UUID LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT branch_id FROM public.staff
  WHERE  user_id = auth.uid() AND status = 'active'
  LIMIT  1;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_staff_id()   TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_staff_role()  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_branch_id()   TO authenticated;

-- ── transactions ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "staff can read transactions" ON public.transactions;

CREATE POLICY "staff read scoped transactions"
ON public.transactions FOR SELECT TO authenticated
USING (
  -- Owner sees all their transactions
  user_id = auth.uid()
  OR (
    -- Active staff with transactions or bills permission
    (public.staff_can(user_id, 'transactions', false)
     OR public.staff_can(user_id, 'bills', false))
    AND (
      -- Regular staff: own records only
      staff_id = public.get_my_staff_id()
      -- Manager: all records for their branch
      OR (
        public.get_my_staff_role() = 'manager'
        AND public.get_my_branch_id() IS NOT NULL
        AND branch_id = public.get_my_branch_id()
      )
    )
  )
);

-- ── credits ──────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "staff can read credits" ON public.credits;

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

DROP POLICY IF EXISTS "staff can read aso clients" ON public.aso_clients;

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
