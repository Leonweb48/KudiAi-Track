-- Migration: 20261103000007_fix_marketer_payouts_rls
-- H4 fix: the marketer_own_payouts policy was FOR ALL with no WITH CHECK clause
-- and no column restriction — any authenticated caller with a matching Supabase JWT
-- could UPDATE status to 'paid'. Replace with granular SELECT + INSERT policies.
-- UPDATE/DELETE remain service-role-only (no policy = blocked by RLS).

-- Drop the overly permissive blanket policy
DROP POLICY IF EXISTS marketer_own_payouts ON public.marketer_payouts;

-- Marketers can read their own payout rows
CREATE POLICY marketer_payouts_select
  ON public.marketer_payouts
  FOR SELECT
  USING (
    marketer_id IN (
      SELECT id FROM public.brm_marketers WHERE owner_id = auth.uid()
    )
  );

-- Marketers can submit new payout requests (status must be 'pending')
CREATE POLICY marketer_payouts_insert
  ON public.marketer_payouts
  FOR INSERT
  WITH CHECK (
    marketer_id IN (
      SELECT id FROM public.brm_marketers WHERE owner_id = auth.uid()
    )
    AND status = 'pending'
  );

-- No UPDATE or DELETE policies for marketers.
-- Only service_role (admin API routes) can change status to approved/paid.

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  '20261103000007',
  'fix_marketer_payouts_rls',
  ARRAY[
    'DROP POLICY IF EXISTS marketer_own_payouts ON public.marketer_payouts',
    'CREATE POLICY marketer_payouts_select ON public.marketer_payouts FOR SELECT',
    'CREATE POLICY marketer_payouts_insert ON public.marketer_payouts FOR INSERT WITH CHECK (status = ''pending'')'
  ]
)
ON CONFLICT (version) DO NOTHING;
