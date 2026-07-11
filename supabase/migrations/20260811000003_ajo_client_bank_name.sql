-- Store the human-readable bank name alongside bank_code on each Ajo client.
-- bank_code is the Paystack machine code (e.g. "011"); bank_name is what we
-- display to the client ("First Bank of Nigeria") without needing another API call.

ALTER TABLE public.aso_clients
  ADD COLUMN IF NOT EXISTS bank_name TEXT;
