-- 20261025000001 added "staff can read coworkers" with a self-referential USING clause:
--   owner_id IN (SELECT owner_id FROM staff WHERE user_id = auth.uid() ...)
-- The inner SELECT re-triggers RLS on the staff table → "infinite recursion detected in
-- policy" error → every hook that queries staff fails → owner portal loses all data,
-- staff portal becomes inaccessible.
--
-- Fix: replace the recursive subquery with a SECURITY DEFINER function that reads the
-- staff table with row security disabled (runs as the function owner), then use its
-- return value for a plain equality check in the policy.

DROP POLICY IF EXISTS "staff can read coworkers" ON public.staff;

-- Looks up the caller's staff.owner_id without going through RLS.
-- SECURITY DEFINER + fixed search_path prevents privilege escalation.
CREATE OR REPLACE FUNCTION public.get_my_staff_owner_id()
RETURNS UUID
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT owner_id
  FROM   public.staff
  WHERE  user_id = auth.uid()
    AND  status  = 'active'
  LIMIT  1;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_staff_owner_id() TO authenticated;

-- No recursion: policy body is a single equality check against a UUID scalar.
CREATE POLICY "staff can read coworkers"
ON public.staff
FOR SELECT
TO authenticated
USING (
  owner_id = public.get_my_staff_owner_id()
);
