-- Ajo staff read policies — idempotent re-apply at correct sequence position.
--
-- Migration 20260718000003 created these policies when first written; this file
-- ensures they exist at the correct ordering point (after all 20260829000001
-- migrations) regardless of whether the DB already has them.
--
-- Using DROP … IF EXISTS + CREATE rather than CREATE … IF NOT EXISTS (which
-- Postgres does not support for policies) so this is safe to run on any state.

DROP POLICY IF EXISTS "ajo_contrib_staff_select" ON public.ajo_contributions;
DROP POLICY IF EXISTS "ajo_cycles_staff_select"  ON public.ajo_cycles;

CREATE POLICY "ajo_contrib_staff_select"
  ON public.ajo_contributions
  FOR SELECT
  USING (public.staff_can(owner_id, 'aso', false));

CREATE POLICY "ajo_cycles_staff_select"
  ON public.ajo_cycles
  FOR SELECT
  USING (public.staff_can(owner_id, 'aso', false));
