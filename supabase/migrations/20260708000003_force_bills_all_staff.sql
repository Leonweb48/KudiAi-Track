-- Force-enable bills for every staff member regardless of user_id or current state.
-- Previous migration only covered staff with user_id IS NOT NULL; this one covers all.
-- ON CONFLICT DO UPDATE handles rows that exist with can_view=false (e.g. owner saved with it off).

INSERT INTO public.staff_permissions (staff_id, module, can_view, can_create)
SELECT id, 'bills', true, true
FROM public.staff
ON CONFLICT (staff_id, module)
DO UPDATE SET can_view = true, can_create = true
WHERE public.staff_permissions.module = 'bills';
