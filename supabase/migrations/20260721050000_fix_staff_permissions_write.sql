-- Fix: staff_permissions had no owner write policies and no unique constraint,
-- so updatePermissions upsert was failing silently and changes never persisted.

-- 1. Unique constraint so upsert onConflict works
ALTER TABLE public.staff_permissions
  DROP CONSTRAINT IF EXISTS staff_permissions_staff_id_module_key;
ALTER TABLE public.staff_permissions
  ADD CONSTRAINT staff_permissions_staff_id_module_key UNIQUE (staff_id, module);

-- 2. Helper function — bypasses RLS so policy subquery doesn't recurse
CREATE OR REPLACE FUNCTION public.is_owner_of_staff(p_staff_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff s
    WHERE s.id = p_staff_id AND s.owner_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_owner_of_staff(uuid) TO authenticated;

-- 3. Owner write policies (all operations)
DROP POLICY IF EXISTS "owner can manage staff permissions" ON public.staff_permissions;
CREATE POLICY "owner can manage staff permissions"
ON public.staff_permissions
FOR ALL
TO authenticated
USING  (public.is_owner_of_staff(staff_id))
WITH CHECK (public.is_owner_of_staff(staff_id));
