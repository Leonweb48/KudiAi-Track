-- Ajo Trust Model v2 — Part 1: Permission Tightening
--
-- Changes:
--   1. aso_clients.created_by — immutable record of which staff registered the client
--      (aso_clients.staff_id remains the changeable "assigned" field)
--   2. ajo_contributions.reject_reason — for per-row owner rejection of staff collections
--   3. Revoke money-out permissions (ajo_record_withdrawals, ajo_confirm_deposits) from
--      all existing staff_permissions rows — these actions are now owner-only server-side
--      regardless of any flag value. Columns are kept (DB schema is additive); the edge
--      function rejects these actions unconditionally for non-owners.
--   4. Update aso_clients SELECT RLS to scope staff reads to their assigned/created clients

-- 1. Immutable creator tracking on aso_clients
ALTER TABLE public.aso_clients
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL;

-- 2. Rejection reason for staff-collection pending contributions
ALTER TABLE public.ajo_contributions
  ADD COLUMN IF NOT EXISTS reject_reason text;

-- 3. Revoke money-out grants — defence in depth alongside server-side enforcement
--    After this migration, ajo_record_withdrawals and ajo_confirm_deposits are always false.
--    The UI no longer exposes these toggles. The edge function rejects these actions
--    for non-owners regardless of what the DB says.
UPDATE public.staff_permissions
  SET ajo_record_withdrawals = false,
      ajo_confirm_deposits   = false
  WHERE module = 'aso';

-- 4. Scoped staff reads for aso_clients
--    Staff can only SELECT clients they registered (created_by) or are assigned to (staff_id).
--    Managers (role='manager') can select all clients for their owner.
--    Owner sees all (user_id = auth.uid()).
--    This replaces the permissive "any active staff with can_view" read.

CREATE OR REPLACE FUNCTION public.ajo_staff_client_visible(
  p_owner_id    uuid,
  p_staff_id    uuid,   -- aso_clients.staff_id (assigned)
  p_created_by  uuid    -- aso_clients.created_by (creator)
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff s
    JOIN public.staff_permissions sp
      ON sp.staff_id = s.id AND sp.module = 'aso'
    WHERE s.owner_id = p_owner_id
      AND s.status   = 'active'
      AND sp.can_view = true
      AND (
        s.role = 'manager'          -- managers see all clients for this owner
        OR s.id = p_staff_id        -- assigned staff
        OR s.id = p_created_by      -- creating staff
      )
      AND (
        s.user_id = auth.uid()
        OR (
          s.user_id IS NULL
          AND lower(s.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.ajo_staff_client_visible(uuid, uuid, uuid) TO authenticated;

-- Drop the old permissive staff SELECT policy on aso_clients and replace with scoped one.
-- The policy name was set in migration 20260608170000_staff_access.sql.
-- We use IF EXISTS on candidate names to be safe against any name variation.
DO $$
BEGIN
  -- Try common candidate names for the staff read policy
  EXECUTE 'DROP POLICY IF EXISTS "Staff can view aso_clients" ON public.aso_clients';
  EXECUTE 'DROP POLICY IF EXISTS "staff can view aso_clients" ON public.aso_clients';
  EXECUTE 'DROP POLICY IF EXISTS "Staff view aso_clients" ON public.aso_clients';
  EXECUTE 'DROP POLICY IF EXISTS "staff_view_aso_clients" ON public.aso_clients';
  -- Drop any policy using staff_can for aso_clients select (belt-and-suspenders)
  EXECUTE $p$
    DO $inner$
    DECLARE
      pol_name text;
    BEGIN
      FOR pol_name IN
        SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'aso_clients' AND cmd = 'SELECT'
          AND policyname NOT IN ('Enable read access for all users', 'owner read aso_clients', 'Owner can view own aso_clients', 'Owner view aso_clients')
          AND policyname ILIKE '%staff%'
      LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.aso_clients', pol_name);
      END LOOP;
    END;
    $inner$
  $p$;
END;
$$;

-- Create the new scoped staff SELECT policy
CREATE POLICY "staff scoped read aso_clients"
ON public.aso_clients
FOR SELECT
USING (
  user_id = auth.uid()
  OR ajo_staff_client_visible(user_id, staff_id, created_by)
);
