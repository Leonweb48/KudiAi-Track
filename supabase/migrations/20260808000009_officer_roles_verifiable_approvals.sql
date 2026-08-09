-- Phase 3: Officer role gates + verifiable approval audit trail
-- ─────────────────────────────────────────────────────────────────────────────
-- Part A: Rename free-text attribution columns to *_display (history preserved)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.org_loans
  RENAME COLUMN approved_by_name TO approved_by_display;

ALTER TABLE public.org_withdrawals
  RENAME COLUMN authorized_by TO authorized_by_display;

ALTER TABLE public.org_member_withdrawal_requests
  RENAME COLUMN reviewed_by TO reviewed_by_display;

-- ─────────────────────────────────────────────────────────────────────────────
-- Part B: Verifiable FK + role columns (null for historical rows — never backfilled)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.org_loans
  ADD COLUMN IF NOT EXISTS approved_by_member_id UUID REFERENCES public.org_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approver_role          TEXT;

ALTER TABLE public.org_withdrawals
  ADD COLUMN IF NOT EXISTS authorized_by_member_id UUID REFERENCES public.org_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS authorizer_role          TEXT;

ALTER TABLE public.org_member_withdrawal_requests
  ADD COLUMN IF NOT EXISTS reviewed_by_member_id UUID REFERENCES public.org_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewer_role          TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Part C: Auditor SELECT-only RLS policies
-- The edge function uses service_role (bypasses RLS). These policies cover
-- any future direct-client queries and satisfy the spec requirement.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.org_loans                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_savings                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_withdrawals                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_member_withdrawal_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auditor_select_org_loans" ON public.org_loans;
CREATE POLICY "auditor_select_org_loans" ON public.org_loans
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.org_members om
      WHERE om.user_id = auth.uid()
        AND om.org_id  = org_loans.org_id
        AND om.role    = 'auditor'
        AND om.status  = 'active'
    )
  );

DROP POLICY IF EXISTS "auditor_select_org_savings" ON public.org_savings;
CREATE POLICY "auditor_select_org_savings" ON public.org_savings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.org_members om
      WHERE om.user_id = auth.uid()
        AND om.org_id  = org_savings.org_id
        AND om.role    = 'auditor'
        AND om.status  = 'active'
    )
  );

DROP POLICY IF EXISTS "auditor_select_org_withdrawals" ON public.org_withdrawals;
CREATE POLICY "auditor_select_org_withdrawals" ON public.org_withdrawals
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.org_members om
      WHERE om.user_id = auth.uid()
        AND om.org_id  = org_withdrawals.org_id
        AND om.role    = 'auditor'
        AND om.status  = 'active'
    )
  );

DROP POLICY IF EXISTS "auditor_select_withdrawal_requests" ON public.org_member_withdrawal_requests;
CREATE POLICY "auditor_select_withdrawal_requests" ON public.org_member_withdrawal_requests
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.org_members om
      WHERE om.user_id = auth.uid()
        AND om.org_id  = org_member_withdrawal_requests.org_id
        AND om.role    = 'auditor'
        AND om.status  = 'active'
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Record in schema_migrations (workaround: db push / migration repair fail on this project)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  '20260808000009',
  'officer_roles_verifiable_approvals',
  ARRAY['Phase 3 — role gates and verifiable approval trail']
)
ON CONFLICT DO NOTHING;
