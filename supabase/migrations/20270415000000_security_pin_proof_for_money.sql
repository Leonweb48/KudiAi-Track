-- Security audit 2026-10-25: the PIN guarded money only in the app and the edge functions — the database functions that
-- actually move it (wallet bill charge, bank-transfer hold, scheduled transfer, Ajo and circle wallet payments, legacy
-- withdrawal) could be called straight from the API with just a logged-in session, so a stolen session moved money
-- with no PIN at all.
--
-- Now: when the transaction PIN is checked correctly on the server (pin-manager verify_txn_pin, or the client portal's
-- own PIN gate), the server records it here; each of those functions, called by a USER, requires a correct PIN within the
-- last 5 minutes. Server-run work (scheduled-transfer runs, sweeps, refunds — no user in the session) is unaffected.
-- This part: the record and the check function. The checks in the money functions follow in 20270416 (after the server
-- has started recording correct PINs — otherwise payments would fail in between).

CREATE TABLE IF NOT EXISTS public.txn_pin_verifications (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  verified_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.txn_pin_verifications ENABLE ROW LEVEL SECURITY;   -- no policies: only the server writes or reads it
REVOKE ALL ON TABLE public.txn_pin_verifications FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.txn_pin_verifications TO service_role;

CREATE OR REPLACE FUNCTION public.txn_pin_recently_verified()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NULL   -- the server itself
      OR EXISTS (SELECT 1 FROM public.txn_pin_verifications
                  WHERE user_id = auth.uid() AND verified_at > now() - interval '5 minutes');
$$;
REVOKE ALL ON FUNCTION public.txn_pin_recently_verified() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.txn_pin_recently_verified() TO authenticated, service_role;
