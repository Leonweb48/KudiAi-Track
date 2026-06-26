-- ══════════════════════════════════════════════════════════════════════════════
-- Grant admins full access to subscription_plans (SELECT all, INSERT, UPDATE,
-- DELETE). The existing authenticated/anon policies only allow SELECT on active
-- plans, so admin UPDATE and DELETE calls were silently blocked by RLS.
-- Uses the existing is_admin() SECURITY DEFINER helper.
-- ══════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "plans_admin_all" ON public.subscription_plans;

CREATE POLICY "plans_admin_all"
  ON public.subscription_plans
  FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());
