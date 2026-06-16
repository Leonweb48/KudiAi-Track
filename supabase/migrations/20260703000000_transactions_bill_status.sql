-- Add bill_status column to track success/failure for bill_payment transactions
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS bill_status TEXT DEFAULT NULL;
