-- Owner-level settlement account on profiles.
-- All Ajo/Aso Paystack contributions now route to the owner's verified settlement subaccount,
-- not to per-client or per-group subaccounts.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS settlement_bank_code        TEXT,
  ADD COLUMN IF NOT EXISTS settlement_account_number   TEXT,
  ADD COLUMN IF NOT EXISTS settlement_account_name     TEXT,
  ADD COLUMN IF NOT EXISTS settlement_bank_name        TEXT,
  ADD COLUMN IF NOT EXISTS paystack_subaccount_code    TEXT,
  ADD COLUMN IF NOT EXISTS paystack_subaccount_id      TEXT,
  ADD COLUMN IF NOT EXISTS settlement_verified_at      TIMESTAMPTZ;
