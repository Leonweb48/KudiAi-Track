-- Ajo Trust Model v2 — Part 1 follow-up: staff SELECT access
--
-- ajo_contrib_owner_select and ajo_cycles_owner_select only allow owner_id = auth.uid().
-- Staff (auth.uid() = staff user) need to read contributions and cycles for their
-- owner's clients so the history modal and contribution card are not blank.
--
-- Both policies reuse the existing staff_can() SECURITY DEFINER helper which checks:
--   staff.owner_id = target_owner AND staff.status = 'active'
--   AND staff_permissions.module = 'aso' AND can_view = true
--   AND (staff.user_id = auth.uid() OR email match for passwordless staff)

CREATE POLICY "ajo_contrib_staff_select" ON public.ajo_contributions
  FOR SELECT
  USING (public.staff_can(owner_id, 'aso', false));

CREATE POLICY "ajo_cycles_staff_select" ON public.ajo_cycles
  FOR SELECT
  USING (public.staff_can(owner_id, 'aso', false));
