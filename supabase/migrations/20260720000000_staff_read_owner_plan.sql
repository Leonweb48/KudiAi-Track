-- Staff portals need to read the business owner's subscription plan to know
-- which features to unlock. The subscriptions table only allows each user to
-- read their own row (RLS: user_id = auth.uid()), so a staff member can never
-- query their owner's plan directly.
--
-- Fix 1: SECURITY DEFINER function — always works, bypasses RLS.
--         Called on initial mount via supabase.rpc("get_owner_plan").
--
-- Fix 2: RLS SELECT policy — lets staff read their owner's subscription row
--         directly, which also enables Postgres realtime for live plan updates.

-- ── SECURITY DEFINER helper ─────────────────────────────────────────────────
-- Works for both business owners (returns their own plan) and staff members
-- (returns their owner's plan).  Returns 'starter' when no active subscription
-- is found (covers free / trial / missing rows gracefully).

CREATE OR REPLACE FUNCTION public.get_owner_plan()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_plan TEXT;
BEGIN
  -- Business owner path: caller has their own active subscription
  SELECT COALESCE(s.plan, 'starter') INTO v_plan
  FROM   subscriptions s
  WHERE  s.user_id = auth.uid()
    AND  s.status  = 'active'
  LIMIT 1;

  IF v_plan IS NOT NULL THEN
    RETURN v_plan;
  END IF;

  -- Staff path: caller is a staff member — return their owner's plan
  SELECT COALESCE(s.plan, 'starter') INTO v_plan
  FROM   staff        st
  JOIN   subscriptions s ON s.user_id = st.owner_id
                         AND s.status = 'active'
  WHERE  st.user_id = auth.uid()
  LIMIT 1;

  RETURN COALESCE(v_plan, 'starter');
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_owner_plan() TO authenticated;

-- ── RLS SELECT policy on subscriptions ─────────────────────────────────────
-- Extends existing access so staff members can SELECT their owner's subscription
-- row.  This enables Postgres realtime (which also obeys RLS) to push plan
-- changes to the staff portal without a full page reload.
-- The policy is additive — existing owner-only policies continue to work.

DROP POLICY IF EXISTS "staff_read_owner_subscription" ON public.subscriptions;

CREATE POLICY "staff_read_owner_subscription"
ON public.subscriptions
FOR SELECT
TO authenticated
USING (
  -- owner reads their own row (belt-and-suspenders alongside existing policy)
  user_id = auth.uid()
  OR
  -- staff reads their business owner's row
  EXISTS (
    SELECT 1
    FROM   public.staff
    WHERE  staff.owner_id  = subscriptions.user_id
      AND  staff.user_id   = auth.uid()
  )
);
