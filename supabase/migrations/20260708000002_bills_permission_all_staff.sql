-- Ensure every staff member with login credentials has bills enabled.
-- The previous restore only covered staff who had OTHER active permissions;
-- staff whose permissions were fully wiped still had no bills access.

INSERT INTO public.staff_permissions (staff_id, module, can_view, can_create)
SELECT id, 'bills', true, true
FROM public.staff
WHERE user_id IS NOT NULL
ON CONFLICT (staff_id, module)
DO UPDATE SET can_view = true, can_create = true;
