-- Fix cashback_transactions RLS.
-- The original fix in 20260630200000_fix_security_warnings.sql ran before
-- the table existed (migration timestamps were out of order), leaving the
-- USING (true) open policy in place. This migration applies the correct
-- user-scoped policy after the table is confirmed to exist.

DROP POLICY IF EXISTS "cashback_all" ON public.cashback_transactions;
DROP POLICY IF EXISTS "cashback_own" ON public.cashback_transactions;

CREATE POLICY "cashback_own" ON public.cashback_transactions
  FOR ALL
  USING  (user_email = auth.email())
  WITH CHECK (user_email = auth.email());
