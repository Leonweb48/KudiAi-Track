-- Ajo Trust Model v2 — Withdrawal Account (separate from Deposit Subaccount)
-- The existing bank_code/account_number/account_name/bank_name columns are the
-- DEPOSIT SUBACCOUNT (owner-set, Paystack contribution routing).
-- These four new columns are the CLIENT'S PAYOUT ACCOUNT (client-set, optional,
-- verified via Paystack at point of withdrawal).

ALTER TABLE public.aso_clients
  ADD COLUMN IF NOT EXISTS withdrawal_bank_code      TEXT,
  ADD COLUMN IF NOT EXISTS withdrawal_account_number TEXT,
  ADD COLUMN IF NOT EXISTS withdrawal_bank_name      TEXT,
  ADD COLUMN IF NOT EXISTS withdrawal_account_name   TEXT;

COMMENT ON COLUMN public.aso_clients.bank_code             IS 'Deposit subaccount — owner-set, routes Paystack contributions';
COMMENT ON COLUMN public.aso_clients.account_number        IS 'Deposit subaccount — owner-set, routes Paystack contributions';
COMMENT ON COLUMN public.aso_clients.account_name          IS 'Deposit subaccount — Paystack-verified account name';
COMMENT ON COLUMN public.aso_clients.bank_name             IS 'Deposit subaccount — display bank name';
COMMENT ON COLUMN public.aso_clients.withdrawal_bank_code  IS 'Payout account — client-set, where withdrawals are paid to';
COMMENT ON COLUMN public.aso_clients.withdrawal_account_number IS 'Payout account — client-set NUBAN';
COMMENT ON COLUMN public.aso_clients.withdrawal_bank_name  IS 'Payout account — display bank name';
COMMENT ON COLUMN public.aso_clients.withdrawal_account_name   IS 'Payout account — Paystack-verified name';
