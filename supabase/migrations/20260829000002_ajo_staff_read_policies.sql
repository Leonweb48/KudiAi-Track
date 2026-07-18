-- Ajo Trust Model v2 — Staff read access for ajo_contributions and ajo_cycles
--
-- Existing policies only allow owner_id = auth.uid() (owner SELECT).
-- Staff cannot query these tables at all under the current RLS, so
-- ContributionCard and AsoClientHistoryModal show blank for staff even when
-- active cycles and contributions exist.
--
-- These policies use the existing staff_can() SECURITY DEFINER helper
-- (checks: active staff, aso can_view, auth.uid() match).

CREATE POLICY "ajo_contrib_staff_select"
  ON public.ajo_contributions
  FOR SELECT
  USING (public.staff_can(owner_id, 'aso', false));

CREATE POLICY "ajo_cycles_staff_select"
  ON public.ajo_cycles
  FOR SELECT
  USING (public.staff_can(owner_id, 'aso', false));
