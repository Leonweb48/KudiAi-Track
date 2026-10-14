-- Owner-recorded Ajo withdrawals are CASH: no wallet money moves (owner's rule 2026-10-14).
--
-- "If savings are withdrawn from the owner side, cash was paid to the client. The savings money must then end up in
-- the owner's wallet, not move to the client's wallet."
--
-- Until now ajo_record_withdrawal created an instant business-wallet → client-wallet payout for EVERY withdrawal of a
-- client who has an app login — including one the owner recorded after handing over cash. The client was paid twice
-- (cash + wallet) and the owner's wallet went down instead of keeping the savings money that covers the cash.
--
-- Now the wallet payout happens only for a withdrawal the CLIENT requested and the owner approved (p_request_id set) —
-- unchanged since 2026-10-13. A withdrawal the owner records directly moves no wallet money: savings paid from the
-- client's wallet already sit in the owner's wallet, so they stay there to cover the cash.
--
-- Only that one condition changes. The live function definition is read and edited in place, so nothing else in it
-- (fees, commission sweep, cycle settlement) can drift; if the expected text isn't found exactly once, this stops.
-- Past cases are only counted (no money is moved back without the owner's decision).

DO $mig$
DECLARE
  v_def  text;
  v_old  constant text := 'IF v_client.client_user_id IS NOT NULL AND v_net_amount > 0 THEN';
  v_new  constant text := 'IF p_request_id IS NOT NULL AND v_client.client_user_id IS NOT NULL AND v_net_amount > 0 THEN';
  v_hits int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'ajo_record_withdrawal';
  IF v_def IS NULL THEN RAISE EXCEPTION 'ajo_record_withdrawal not found'; END IF;

  IF position(v_new IN v_def) > 0 THEN
    RAISE NOTICE 'owner-cash-withdrawal | already applied';
    RETURN;
  END IF;

  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'expected the wallet-payout condition exactly once in ajo_record_withdrawal, found % — refusing to guess', v_hits;
  END IF;

  EXECUTE replace(v_def, v_old, v_new);
  RAISE NOTICE 'owner-cash-withdrawal | wallet payout now only for client-requested withdrawals';
END $mig$;

-- pg_get_functiondef output is CREATE OR REPLACE, which keeps the existing grants; make sure nobody but the server can call it.
DO $grants$
DECLARE v_sig text;
BEGIN
  SELECT p.oid::regprocedure::text INTO v_sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'ajo_record_withdrawal';
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_sig);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_sig);
END $grants$;

-- Read-out: owner-recorded withdrawals that already paid a client's wallet (counts and totals only).
DO $readout$
DECLARE n int; s numeric; c int;
BEGIN
  SELECT count(*), COALESCE(sum(amount_kobo), 0) / 100.0, count(DISTINCT owner_id)
    INTO n, s, c
    FROM public.ajo_wallet_payouts
   WHERE request_id IS NULL AND status = 'paid';
  RAISE NOTICE 'owner-cash-withdrawal readout | past owner-recorded withdrawals paid to client wallets: % payout(s), N%, across % business(es)', n, s, c;
END $readout$;
