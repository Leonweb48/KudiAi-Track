-- Phase 4b: Track payment_method on member withdrawal requests.
-- The ₦-minimum in withdrawal_fee_min is a Paystack bank-transfer cost-recovery floor.
-- Cash withdrawals incur no per-transaction bank cost, so the minimum must not apply to them.
-- Storing payment_method on the request lets the edge function apply the correct fee formula
-- at both preview time (member selects method) and approval time (re-computes to match).

ALTER TABLE public.org_member_withdrawal_requests
  ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'cash'
  CHECK (payment_method IN ('cash', 'bank_transfer'));

-- Backfill: treat all existing rows as cash (dominant path in coop context)
UPDATE public.org_member_withdrawal_requests
  SET payment_method = 'cash'
  WHERE payment_method IS NULL;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('20260809000002', 'withdrawal_payment_method', ARRAY['-- see file'])
ON CONFLICT (version) DO NOTHING;
