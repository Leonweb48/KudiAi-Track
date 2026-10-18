-- The esusu payout block (aso_clients_balance_nonneg), part 2. Read-out 20270352: the member's ₦175 double charge was
-- NOT made inside one withdrawal (20270351 covers that case). On 14 Oct a ₦5,000 card withdrawal took the 3.5% fee
-- (₦175, 06:42); 17 minutes later "Take commission" on the same finished card (ajo_execute_commission) took 3.5% of
-- the card again (₦175, 06:59). That second step only checked current_balance, so it also ate esusu money.
--
-- Owner's decision 2026-10-18: refund the duplicate and never charge both.
--   1. ajo_execute_commission: commission on a card = its % of the card's contributions LESS the withdrawal fees
--      already taken on that card (nothing left → refused with a clear message); never takes money locked in an
--      esusu round or a savings group.
--   2. ajo_record_withdrawal's automatic commission sweep for finished cards gets the same offset (edited in place).
--   3. Refund the member's duplicate ₦175 (record-only 'reversal_commission'; the money already sits in the owner's
--      wallet). Other past cards charged both are only counted.

-- ── 1. manual card commission ────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ajo_execute_commission(
  p_cycle_id UUID,
  p_owner_id UUID,
  p_amount   NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cycle     ajo_cycles%ROWTYPE;
  v_client    aso_clients%ROWTYPE;
  v_entry_id  UUID;
  v_cur_bal   NUMERIC;
  v_new_bal   NUMERIC;
  v_fees      NUMERIC;
  v_charge    NUMERIC;
  v_locked    NUMERIC;
BEGIN
  SELECT * INTO v_cycle FROM ajo_cycles WHERE id = p_cycle_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Cycle not found');
  END IF;
  IF v_cycle.owner_id != p_owner_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized');
  END IF;
  IF v_cycle.status NOT IN ('completed', 'settled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Commission can only be executed on a completed or settled cycle');
  END IF;
  IF v_cycle.commission_model = 'none' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This cycle has no commission configured');
  END IF;
  IF v_cycle.commission_model = 'first_period' THEN
    RETURN jsonb_build_object(
      'ok',    false,
      'error', 'first_period commission is collected automatically at the client''s first deposit — no manual execution needed'
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM ajo_contributions
    WHERE cycle_id = p_cycle_id AND type = 'commission'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Commission already executed for this cycle');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Commission amount must be greater than zero');
  END IF;

  -- One fee, never both (2026-10-18): withdrawal fees already taken on this card count toward its commission.
  SELECT COALESCE(SUM(CASE WHEN type = 'withdrawal_fee' THEN amount
                           WHEN type = 'reversal_withdrawal_fee' THEN -amount ELSE 0 END), 0)
    INTO v_fees
    FROM ajo_contributions
   WHERE cycle_id = p_cycle_id AND status = 'completed';
  v_charge := ROUND(p_amount - GREATEST(v_fees, 0), 2);
  IF v_charge <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', format(
      'No commission left to take — ₦%s was already charged as withdrawal fees on this card.',
      to_char(v_fees, 'FM999,999,990.00')));
  END IF;

  SELECT * INTO v_client FROM aso_clients WHERE id = v_cycle.client_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Client not found');
  END IF;

  v_cur_bal := COALESCE(v_client.current_balance, 0);
  -- money the client has committed to an esusu round or a savings group is not the card's to take
  v_locked  := COALESCE(ajo_locked_esusu_amount(v_cycle.client_id), 0) + COALESCE(ajo_locked_group_amount(v_cycle.client_id), 0);

  IF v_cur_bal - v_locked < v_charge THEN
    RETURN jsonb_build_object(
      'ok',    false,
      'error', format(
        'Insufficient balance — commission of ₦%s exceeds the client''s free balance of ₦%s (₦%s is committed to esusu or a savings group)',
        to_char(v_charge, 'FM999,999,990.00'),
        to_char(GREATEST(v_cur_bal - v_locked, 0), 'FM999,999,990.00'),
        to_char(v_locked, 'FM999,999,990.00')
      )
    );
  END IF;

  v_new_bal := v_cur_bal - v_charge;
  UPDATE aso_clients SET current_balance = v_new_bal WHERE id = v_cycle.client_id;

  INSERT INTO ajo_contributions
    (aso_client_id, owner_id, amount, type, status, payment_method, notes, cycle_id)
  VALUES
    (v_cycle.client_id, p_owner_id, v_charge, 'commission', 'completed', 'commission',
     CASE WHEN v_fees > 0
       THEN 'Cycle commission (₦' || to_char(v_fees, 'FM999,999,990.00') || ' already taken as withdrawal fees)'
       ELSE 'Cycle commission' END,
     p_cycle_id)
  RETURNING id INTO v_entry_id;

  RETURN jsonb_build_object(
    'ok',             true,
    'entry_id',       v_entry_id,
    'amount',         v_charge,
    'fees_already',   v_fees,
    'balance_before', v_cur_bal,
    'balance_after',  v_new_bal
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ajo_execute_commission(UUID, UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ajo_execute_commission(UUID, UUID, NUMERIC) TO service_role;

-- ── 2. the automatic sweep at withdrawal gets the same offset ────────────────────────────────────────────────────
DO $mig$
DECLARE
  v_def  text;
  v_fees constant text := '(SELECT COALESCE(SUM(CASE WHEN wf.type = ''withdrawal_fee'' THEN wf.amount WHEN wf.type = ''reversal_withdrawal_fee'' THEN -wf.amount ELSE 0 END), 0) FROM ajo_contributions wf WHERE wf.cycle_id = cy.id AND wf.status = ''completed'')';
  v_pats text[] := ARRAY[
    'SELECT COALESCE\(SUM\([[:space:]]+ROUND\(',
    ', 2\)[[:space:]]+\), 0\)[[:space:]]+INTO v_total_commission_due',
    'SELECT cy\.id,[[:space:]]+ROUND\(',
    ', 2\) AS comm_amount'];
  v_reps text[];
  i int; n int;
BEGIN
  v_reps := ARRAY[
    'SELECT COALESCE(SUM(GREATEST(0, ROUND(',
    ', 2) - ' || v_fees || ')), 0) INTO v_total_commission_due',
    'SELECT cy.id, GREATEST(0, ROUND(',
    ', 2) - ' || v_fees || ') AS comm_amount'];

  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n2 ON n2.oid = p.pronamespace
   WHERE n2.nspname = 'public' AND p.proname = 'ajo_record_withdrawal';
  IF v_def IS NULL THEN RAISE EXCEPTION 'ajo_record_withdrawal not found'; END IF;
  IF position('wf.type = ''withdrawal_fee''' IN v_def) > 0 THEN
    RAISE NOTICE 'sweep-offset | already applied';
    RETURN;
  END IF;

  FOR i IN 1..array_length(v_pats, 1) LOOP
    SELECT count(*) INTO n FROM regexp_matches(v_def, v_pats[i], 'g');
    IF n <> 1 THEN
      RAISE EXCEPTION 'sweep-offset: pattern % found % times in ajo_record_withdrawal — refusing to guess', i, n;
    END IF;
    v_def := regexp_replace(v_def, v_pats[i], v_reps[i]);
  END LOOP;

  EXECUTE v_def;
  RAISE NOTICE 'sweep-offset | applied';
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

-- ── 3. refund the member's duplicate ₦175 (owner-approved); count other cards charged both ─────────────────────
DO $refund$
DECLARE r record; v_done int := 0; v_other int := 0; v_other_sum numeric := 0; v_dup numeric;
BEGIN
  FOR r IN
    SELECT cm.id, cm.aso_client_id, cm.owner_id, cm.amount, cm.cycle_id, cm.created_at,
           (SELECT COALESCE(SUM(CASE WHEN f.type = 'withdrawal_fee' THEN f.amount WHEN f.type = 'reversal_withdrawal_fee' THEN -f.amount ELSE 0 END), 0)
              FROM ajo_contributions f WHERE f.cycle_id = cm.cycle_id AND f.status = 'completed') AS fees,
           EXISTS (SELECT 1 FROM ajo_group_rounds gr
                    WHERE gr.status = 'active' AND left(gr.group_id::text, 8) = 'b77ae164'
                      AND (gr.group_id IN (SELECT group_id FROM aso_client_group_memberships WHERE client_id = cm.aso_client_id AND status = 'active')
                           OR gr.group_id IN (SELECT ajo_group_id FROM aso_clients WHERE id = cm.aso_client_id))) AS is_target
      FROM ajo_contributions cm
     WHERE cm.type = 'commission' AND cm.status = 'completed' AND cm.cycle_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM ajo_contributions rv WHERE rv.reverses_contribution_id = cm.id)
  LOOP
    CONTINUE WHEN r.fees <= 0;
    v_dup := LEAST(r.amount, r.fees);
    IF r.is_target AND left(r.id::text, 8) = 'e01cc3c7' AND r.amount = 175 THEN
      INSERT INTO ajo_contributions (
        aso_client_id, owner_id, amount, type, payment_method, status, notes,
        reverses_contribution_id, paystack_status, cycle_id, contribution_context
      ) VALUES (
        r.aso_client_id, r.owner_id, v_dup, 'reversal_commission', 'commission', 'completed',
        'Refund: card commission was taken after the withdrawal fee had already been charged on this card (14 Oct)',
        r.id, 'completed', r.cycle_id, 'personal_savings'
      );
      UPDATE aso_clients SET current_balance = COALESCE(current_balance, 0) + v_dup WHERE id = r.aso_client_id;
      v_done := v_done + 1;
    ELSE
      v_other := v_other + 1; v_other_sum := v_other_sum + v_dup;
    END IF;
  END LOOP;
  RAISE NOTICE 'card-double-fee refund | refunded=% (the esusu member) | other cards charged both NOT refunded: % totalling ₦%',
    v_done, v_other, v_other_sum;
END $refund$;

-- ── self-check: no active esusu member is still below their pot share ────────────────────────────────────────────
DO $check$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM ajo_group_rounds r
    JOIN LATERAL (
      SELECT c.id, COALESCE(c.current_balance, 0) bal
        FROM aso_clients c
       WHERE c.id IN (SELECT client_id FROM aso_client_group_memberships WHERE group_id = r.group_id AND status = 'active'
                      UNION SELECT id FROM aso_clients WHERE ajo_group_id = r.group_id)
    ) m ON true
   WHERE r.status = 'active'
     AND EXISTS (SELECT 1 FROM ajo_group_turns t WHERE t.round_id = r.id AND t.status = 'current')
     AND m.bal < (SELECT COALESCE(SUM(CASE WHEN type = 'contribution' THEN amount ELSE 0 END), 0)
                       - COALESCE(SUM(CASE WHEN type = 'esusu_pot_sweep' THEN amount ELSE 0 END), 0)
                    FROM ajo_contributions
                   WHERE aso_client_id = m.id AND contribution_context = 'esusu_rotation' AND group_id = r.group_id
                     AND status = 'completed' AND created_at >= r.created_at);
  RAISE NOTICE 'self-check | esusu members still below their pot share: %', n;
END $check$;
