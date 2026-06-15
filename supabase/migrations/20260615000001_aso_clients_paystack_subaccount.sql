-- Each Ajo client gets their own Paystack subaccount for direct contribution routing.
ALTER TABLE aso_clients
  ADD COLUMN IF NOT EXISTS bank_code                TEXT,
  ADD COLUMN IF NOT EXISTS account_number           TEXT,
  ADD COLUMN IF NOT EXISTS account_name             TEXT,
  ADD COLUMN IF NOT EXISTS paystack_subaccount_code TEXT,
  ADD COLUMN IF NOT EXISTS paystack_subaccount_id   TEXT;
