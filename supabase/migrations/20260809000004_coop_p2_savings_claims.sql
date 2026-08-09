-- P2: Manual savings claims + member bank account details

-- Table for member-submitted manual deposit claims (cash/bank evidence)
CREATE TABLE IF NOT EXISTS public.org_manual_savings_claims (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  member_id      UUID NOT NULL REFERENCES public.org_members(id)   ON DELETE CASCADE,
  amount         NUMERIC(15,2) NOT NULL,
  payer_name     TEXT,
  notes          TEXT,
  proof_url      TEXT,
  program_id     UUID REFERENCES public.org_contribution_programs(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
  decided_by     UUID REFERENCES public.org_members(id),
  decided_at     TIMESTAMPTZ,
  decision_notes TEXT,
  savings_id     UUID REFERENCES public.org_savings(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_omsc_member ON public.org_manual_savings_claims(member_id);
CREATE INDEX IF NOT EXISTS idx_omsc_org    ON public.org_manual_savings_claims(org_id, status);

-- Member payout bank details for withdrawal transfers
ALTER TABLE public.org_members
  ADD COLUMN IF NOT EXISTS withdrawal_bank_code      TEXT,
  ADD COLUMN IF NOT EXISTS withdrawal_bank_name      TEXT,
  ADD COLUMN IF NOT EXISTS withdrawal_account_number TEXT,
  ADD COLUMN IF NOT EXISTS withdrawal_account_name   TEXT;

-- Temporary portal PIN reset tokens (for forgot-PIN OTP flow)
ALTER TABLE public.org_members
  ADD COLUMN IF NOT EXISTS pin_reset_otp_hash TEXT,
  ADD COLUMN IF NOT EXISTS pin_reset_otp_exp  TIMESTAMPTZ;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('20260809000004', 'coop_p2_savings_claims', ARRAY['-- see file'])
ON CONFLICT (version) DO NOTHING;
