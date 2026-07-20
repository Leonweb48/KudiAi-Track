-- Add bank_code column to invoice_settings so the Paystack bank selection persists
ALTER TABLE invoice_settings
  ADD COLUMN IF NOT EXISTS bank_code TEXT DEFAULT '';
