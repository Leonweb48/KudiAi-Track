-- Ajo Trust Model v2 — Part 1b: Corrective fixes
--
-- Fixes three issues introduced by 20260718000001:
--
-- A. NULL-handling for legacy clients (live regression):
--    aso_clients rows created before Part 1 have staff_id=NULL and created_by=NULL.
--    The original ajo_staff_client_visible uses s.id = NULL which is always false,
--    so non-manager staff see an empty client list. Fix: NULL-NULL rows (no scope
--    assignment yet) are readable by any active can_view staff for that owner.
--
-- B. Manager scope was owner-wide instead of branch-scoped:
--    The spec is: managers read/act on their branch's clients only.
--    Fix: manager condition becomes branch_id = s.branch_id.
--    Backward compat: a manager with no branch assigned (branch_id IS NULL on staff)
--    retains owner-wide access until the owner assigns them to a branch.
--
-- C. Function signature change (3-arg → 4-arg, adding p_branch_id):
--    PostgreSQL cannot add parameters to an existing function; drop then recreate.
--    The RLS policy is also dropped and recreated to pass aso_clients.branch_id.

-- Must drop the dependent policy BEFORE dropping the function,
-- otherwise PostgreSQL raises "cannot drop function because other objects depend on it".
DROP POLICY IF EXISTS "staff scoped read aso_clients" ON public.aso_clients;

-- Drop old 3-arg function (replacing with 4-arg below)
DROP FUNCTION IF EXISTS public.ajo_staff_client_visible(uuid, uuid, uuid);

-- Recreate with NULL-handling + branch-scoped managers
CREATE OR REPLACE FUNCTION public.ajo_staff_client_visible(
  p_owner_id    uuid,
  p_staff_id    uuid,   -- aso_clients.staff_id (assigned staff — changeable)
  p_created_by  uuid,   -- aso_clients.created_by (immutable creator)
  p_branch_id   uuid    -- aso_clients.branch_id (client's branch)
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
    WHERE s.owner_id  = p_owner_id
      AND s.status    = 'active'
      AND sp.can_view = true
      AND (
        -- Manager scope: branch-scoped. Null branch_id on the staff row = owner-wide fallback
        -- (managers set up before the branch feature existed).
        (s.role = 'manager' AND (s.branch_id IS NULL OR s.branch_id = p_branch_id))

        -- Assigned staff
        OR s.id = p_staff_id

        -- Creator staff (immutable; can see their own registrations even if reassigned)
        OR s.id = p_created_by

        -- Legacy: client has no scope assignment yet — visible to all active can_view staff.
        -- Once an owner assigns staff_id or a client is created through a staff flow
        -- (setting created_by), this clause no longer fires for that client.
        OR (p_staff_id IS NULL AND p_created_by IS NULL)
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

GRANT EXECUTE ON FUNCTION public.ajo_staff_client_visible(uuid, uuid, uuid, uuid) TO authenticated;

-- Recreate policy calling the new 4-arg function
CREATE POLICY "staff scoped read aso_clients"
ON public.aso_clients
FOR SELECT
USING (
  user_id = auth.uid()
  OR ajo_staff_client_visible(user_id, staff_id, created_by, branch_id)
);
