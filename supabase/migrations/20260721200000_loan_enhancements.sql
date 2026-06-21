-- ═══════════════════════════════════════════════════
--  LOAN SYSTEM ENHANCEMENTS
-- ═══════════════════════════════════════════════════

-- Org-level loan settings
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS default_loan_interest_rate numeric DEFAULT 10,
  ADD COLUMN IF NOT EXISTS interest_earned            numeric DEFAULT 0;

-- Loan record: pre-computed installment breakdown
ALTER TABLE public.org_loans
  ADD COLUMN IF NOT EXISTS total_repayable    numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_interest     numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monthly_installment numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS applied_by         text DEFAULT 'admin';

-- Repayment: principal / interest split for profit tracking
ALTER TABLE public.org_loan_repayments
  ADD COLUMN IF NOT EXISTS principal_portion numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS interest_portion  numeric DEFAULT 0;

-- RLS: members can insert their own loan applications
DROP POLICY IF EXISTS "coop_loans_member_apply" ON public.org_loans;
CREATE POLICY "coop_loans_member_apply" ON public.org_loans
  FOR INSERT
  WITH CHECK (
    member_id IN (
      SELECT id FROM public.org_members WHERE user_id = auth.uid()
    )
  );

-- RLS: members can read their own loans
DROP POLICY IF EXISTS "coop_loans_member_read" ON public.org_loans;
CREATE POLICY "coop_loans_member_read" ON public.org_loans
  FOR SELECT
  USING (
    member_id IN (SELECT id FROM public.org_members WHERE user_id = auth.uid())
    OR org_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid())
  );
