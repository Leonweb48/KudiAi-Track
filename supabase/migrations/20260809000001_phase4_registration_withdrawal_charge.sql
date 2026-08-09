-- Phase 4: org registration fee (pending_payment status) + withdrawal transaction charge
-- Applied via: supabase db query --linked --file supabase/migrations/20260809000001_phase4_registration_withdrawal_charge.sql

BEGIN;

-- ── 1. Extend organizations.status to include pending_payment ────────────────
ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_status_check;
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_status_check
  CHECK (status IN ('active', 'suspended', 'inactive', 'archived', 'pending_payment'));

-- ── 2. New columns on organizations ─────────────────────────────────────────
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS registration_fee_paid_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS platform_reg_fee_amount   NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS withdrawal_fee_pct        NUMERIC(6,4)  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS withdrawal_fee_min        NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS withdrawal_fee_cap        NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS platform_fees_accrued     NUMERIC(12,2) DEFAULT 0;

-- ── 3. New columns on org_member_withdrawal_requests ────────────────────────
ALTER TABLE public.org_member_withdrawal_requests
  ADD COLUMN IF NOT EXISTS gross_amount       NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS transaction_charge NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount        NUMERIC(12,2);

-- Backfill existing rows: no fee was ever charged, so gross = amount, charge = 0, net = amount
UPDATE public.org_member_withdrawal_requests
SET gross_amount = amount, transaction_charge = 0, net_amount = amount
WHERE gross_amount IS NULL;

-- ── 4. New columns on org_withdrawals ───────────────────────────────────────
ALTER TABLE public.org_withdrawals
  ADD COLUMN IF NOT EXISTS gross_amount       NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS transaction_charge NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount        NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS per_member_gross  NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS per_member_fee    NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS per_member_net    NUMERIC(12,2);

-- Backfill existing rows
UPDATE public.org_withdrawals
SET gross_amount = total_amount, transaction_charge = 0, net_amount = total_amount
WHERE gross_amount IS NULL;

-- ── 5. schema_migrations record (workaround — supabase db push fails on this project) ──
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('20260809000001', 'phase4_registration_withdrawal_charge', ARRAY['-- see file'])
ON CONFLICT (version) DO NOTHING;

COMMIT;
