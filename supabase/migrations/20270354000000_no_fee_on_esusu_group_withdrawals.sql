-- Owner's rule 2026-10-18: "If the owner didn't add a withdrawal fee, no charge should be added when withdrawing from
-- the esusu." Esusu rounds and savings groups have no fee setting of their own; until now ajo_record_withdrawal
-- charged the client's savings-CARD fee % on every withdrawal, esusu and group included (20270110 had made that the
-- rule), and settled any commission still owed on finished cards at the same time.
--
-- Now a withdrawal attributed to an esusu / savings group (p_group_id, or the client's request's group_id):
--   - takes no withdrawal fee;
--   - doesn't settle card commission (that stays owed on the card and is taken at the next card withdrawal or with
--     "Take commission").
-- Card withdrawals are unchanged. Edited in place (the rest of the function can't drift); stops if the expected
-- text isn't there exactly once. Past esusu/group withdrawal fees are only counted (no money moved).

DO $mig$
DECLARE
  v_def  text;
  v_old1 constant text := 'v_working_balance := COALESCE(v_client.current_balance, 0);';
  v_new1 constant text := '-- No card commission is settled on an esusu / savings-group withdrawal (owner''s rule 2026-10-18)
  IF COALESCE(p_group_id, (SELECT wr.group_id FROM ajo_withdrawal_requests wr WHERE wr.id = p_request_id)) IS NOT NULL THEN
    v_total_commission_due := 0;
  END IF;
  v_working_balance := COALESCE(v_client.current_balance, 0);';
  v_old2 constant text := 'v_fee_amount := CASE WHEN COALESCE(v_pct_fee, 0) > 0';
  v_new2 constant text := '-- Esusu / savings-group withdrawals carry no fee (owner''s rule 2026-10-18): a card''s % is for that card only
  IF v_attr_group_id IS NOT NULL THEN v_pct_fee := 0; END IF;
  v_fee_amount := CASE WHEN COALESCE(v_pct_fee, 0) > 0';
  n int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'ajo_record_withdrawal';
  IF v_def IS NULL THEN RAISE EXCEPTION 'ajo_record_withdrawal not found'; END IF;
  IF position('No card commission is settled on an esusu' IN v_def) > 0 THEN
    RAISE NOTICE 'no-fee-esusu | already applied';
    RETURN;
  END IF;

  n := (length(v_def) - length(replace(v_def, v_old1, ''))) / length(v_old1);
  IF n <> 1 THEN RAISE EXCEPTION 'no-fee-esusu: working-balance line found % times — refusing to guess', n; END IF;
  n := (length(v_def) - length(replace(v_def, v_old2, ''))) / length(v_old2);
  IF n <> 1 THEN RAISE EXCEPTION 'no-fee-esusu: fee line found % times — refusing to guess', n; END IF;
  -- the commission sweep's two IF blocks must come after the working-balance line for the guard to work
  IF position(v_old1 IN v_def) > position('IF v_total_commission_due > 0 AND v_working_balance' IN v_def) THEN
    RAISE EXCEPTION 'no-fee-esusu: unexpected statement order — refusing to guess';
  END IF;

  EXECUTE replace(replace(v_def, v_old1, v_new1), v_old2, v_new2);
  RAISE NOTICE 'no-fee-esusu | applied';
END $mig$;

DO $grants$
DECLARE v_sig text;
BEGIN
  SELECT p.oid::regprocedure::text INTO v_sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'ajo_record_withdrawal';
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_sig);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_sig);
END $grants$;

-- pending client requests for an esusu / group withdrawal: show the right (fee-free) amount
DO $pending$
DECLARE n int;
BEGIN
  UPDATE ajo_withdrawal_requests SET fee_amount = 0, net_amount = amount
   WHERE group_id IS NOT NULL AND status IN ('pending', 'held_24h') AND COALESCE(fee_amount, 0) > 0;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'no-fee-esusu | pending group/esusu requests corrected: %', n;
END $pending$;

-- read-out: past withdrawal fees taken on esusu / group withdrawals (counts and totals only, nothing moved)
DO $readout$
DECLARE r record;
BEGIN
  FOR r IN SELECT f.contribution_context ctx, count(*) n, sum(f.amount) total, count(DISTINCT f.aso_client_id) clients,
                  count(DISTINCT f.owner_id) owners, min(f.created_at)::date first_at, max(f.created_at)::date last_at
             FROM ajo_contributions f
            WHERE f.type = 'withdrawal_fee' AND f.status = 'completed' AND f.group_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM ajo_contributions rv WHERE rv.reverses_contribution_id = f.id)
            GROUP BY 1 LOOP
    RAISE NOTICE 'no-fee-esusu | past fees ctx=% n=% total=₦% clients=% owners=% from % to %',
      r.ctx, r.n, r.total, r.clients, r.owners, r.first_at, r.last_at;
  END LOOP;
END $readout$;
