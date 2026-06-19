-- Restore bills permission for staff who lost it after the delete+insert
-- permission fix. Any staff who still have other active modules (can_view=true)
-- should also have bills enabled. ON CONFLICT updates disabled rows too.

INSERT INTO public.staff_permissions (staff_id, module, can_view, can_create)
SELECT DISTINCT staff_id, 'bills', true, true
FROM public.staff_permissions
WHERE can_view = true
  AND module NOT IN ('bills', 'print-airtime', 'print-data')
ON CONFLICT (staff_id, module)
DO UPDATE SET can_view = true, can_create = true;
