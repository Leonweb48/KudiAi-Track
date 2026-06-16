ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS paystack_customer_code  TEXT,
  ADD COLUMN IF NOT EXISTS virtual_account_bank    TEXT,
  ADD COLUMN IF NOT EXISTS virtual_account_number  TEXT,
  ADD COLUMN IF NOT EXISTS virtual_account_name    TEXT,
  ADD COLUMN IF NOT EXISTS virtual_account_ref     TEXT;
