-- A 'completed' cycle (target reached) only auto-flips to 'settled' (fully
-- paid out, nothing left) when ajo_record_withdrawal's settle-check runs
-- against the SPECIFIC cycle_id a withdrawal was attributed to. Before the
-- owner-side Fund/Pay picker started passing cycle_id/group_id through,
-- every owner-recorded withdrawal was unattributed (p_cycle_id always NULL),
-- so a cycle that was fully drained via that path never got the chance to
-- settle — it stays stuck at 'completed' forever, still showing up as an
-- available withdrawal target even though there's genuinely nothing left in
-- it. Confirmed live: exactly one 'completed' cycle exists in the database
-- today, with a net balance of 0.
--
-- Fixes both the existing stuck row (one-time backfill) and the root cause
-- (ajo_record_withdrawal now scans ALL of the client's completed cycles for
-- zero balance after every withdrawal, not just the one it was attributed
-- to — robust regardless of whether attribution is present).

-- ── One-time backfill: settle already-stuck completed cycles ────────────────
UPDATE ajo_cycles
SET status = 'settled'
WHERE status = 'completed'
  AND ajo_cycle_net_balance(id) < 0.01;

-- ── ajo_record_withdrawal: broaden the settle-check to scan every completed
--    cycle for this client, not just the one this withdrawal was attributed to ──

CREATE OR REPLACE FUNCTION public.ajo_record_withdrawal(p_client_id uuid, p_owner_id uuid, p_gross_amount numeric, p_method text DEFAULT 'cash'::text, p_notes text DEFAULT NULL::text, p_recorded_by uuid DEFAULT NULL::uuid, p_request_id uuid DEFAULT NULL::uuid, p_cycle_id uuid DEFAULT NULL::uuid, p_group_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_client               RECORD;
  v_esusu_locked         NUMERIC;
  v_cycle_locked         NUMERIC;
  v_group_locked         NUMERIC;
  v_withdrawable         NUMERIC;
  v_pct_fee              NUMERIC;
  v_fee_amount           NUMERIC;
  v_net_amount           NUMERIC;
  v_net_id               UUID;
  v_fee_id               UUID;
  v_lock_msg             TEXT;
  v_lock_parts           TEXT[];
  v_attr_cycle_id        UUID;
  v_attr_group_id        UUID;
  v_cycle_just_closed    BOOLEAN := false;
  v_closed_label         TEXT;
  v_cyc_close            RECORD;
  v_cycle_net_bal        NUMERIC;
  -- wallet payout scheduling
  v_payout_scheduled     BOOLEAN := false;
  v_payout_date          DATE;
  -- instant commission sweep
  v_total_commission_due NUMERIC;
  v_working_balance      NUMERIC;
  v_comm_cycle           RECORD;
BEGIN
  SELECT * INTO v_client FROM aso_clients WHERE id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Client not found');
  END IF;

  IF v_client.user_id IS NOT NULL AND v_client.user_id != p_owner_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized');
  END IF;

  IF p_gross_amount IS NULL OR p_gross_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Amount must be greater than zero');
  END IF;

  -- ── Instant commission sweep: settle any owed percent-model commission
  --    across ALL eligible completed/settled cycles before this withdrawal
  --    is evaluated. Pass 1 computes the total due with NO mutation and
  --    validates it against the balance; pass 2 (only once confirmed
  --    affordable) actually books it. This keeps the whole thing atomic
  --    without needing an exception-driven rollback — nothing is written
  --    until we already know it can all be covered.
  SELECT COALESCE(SUM(
    ROUND(
      (SELECT COALESCE(SUM(amount), 0) FROM ajo_contributions
         WHERE cycle_id = cy.id AND type = 'contribution' AND status = 'completed')
      * COALESCE(cy.commission_percent, 0) / 100
    , 2)
  ), 0)
  INTO v_total_commission_due
  FROM ajo_cycles cy
  WHERE cy.client_id = p_client_id
    AND cy.commission_model = 'percent'
    AND cy.status IN ('completed', 'settled')
    AND NOT EXISTS (
      SELECT 1 FROM ajo_contributions fc
      WHERE fc.cycle_id = cy.id AND fc.type = 'commission' AND fc.status = 'completed'
    );

  v_working_balance := COALESCE(v_client.current_balance, 0);

  IF v_total_commission_due > 0 AND v_working_balance < v_total_commission_due THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', format(
        '₦%s in owed commission must be settled first, but the available balance (₦%s) is insufficient — this withdrawal cannot proceed',
        to_char(v_total_commission_due, 'FM999,999,990.00'), to_char(v_working_balance, 'FM999,999,990.00')
      )
    );
  END IF;

  IF v_total_commission_due > 0 THEN
    FOR v_comm_cycle IN
      SELECT cy.id,
        ROUND(
          (SELECT COALESCE(SUM(amount), 0) FROM ajo_contributions
             WHERE cycle_id = cy.id AND type = 'contribution' AND status = 'completed')
          * COALESCE(cy.commission_percent, 0) / 100
        , 2) AS comm_amount
      FROM ajo_cycles cy
      WHERE cy.client_id = p_client_id
        AND cy.commission_model = 'percent'
        AND cy.status IN ('completed', 'settled')
        AND NOT EXISTS (
          SELECT 1 FROM ajo_contributions fc
          WHERE fc.cycle_id = cy.id AND fc.type = 'commission' AND fc.status = 'completed'
        )
      ORDER BY cy.created_at ASC
    LOOP
      CONTINUE WHEN v_comm_cycle.comm_amount <= 0;
      INSERT INTO ajo_contributions
        (aso_client_id, owner_id, amount, type, status, payment_method, notes, cycle_id)
      VALUES
        (p_client_id, p_owner_id, v_comm_cycle.comm_amount, 'commission', 'completed', 'commission',
         'Cycle commission (auto-settled at withdrawal)', v_comm_cycle.id);
      v_working_balance := v_working_balance - v_comm_cycle.comm_amount;
    END LOOP;

    UPDATE aso_clients SET current_balance = current_balance - v_total_commission_due WHERE id = p_client_id;
  END IF;

  IF v_working_balance < p_gross_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Insufficient balance');
  END IF;

  v_esusu_locked := ajo_locked_esusu_amount(p_client_id);
  v_cycle_locked := ajo_locked_cycle_amount(p_client_id);
  v_group_locked := ajo_locked_group_amount(p_client_id);
  v_withdrawable := v_working_balance - v_esusu_locked - v_cycle_locked - v_group_locked;

  IF v_withdrawable < p_gross_amount THEN
    v_lock_parts := ARRAY[]::TEXT[];
    IF v_group_locked > 0 THEN
      v_lock_parts := v_lock_parts || ('₦' || ROUND(v_group_locked, 2) || ' committed to a savings group or esusu — available after your payout');
    END IF;
    IF v_esusu_locked > 0 THEN
      v_lock_parts := v_lock_parts || ('₦' || ROUND(v_esusu_locked, 2) || ' locked in an active esusu round');
    END IF;
    IF v_cycle_locked > 0 THEN
      v_lock_parts := v_lock_parts || ('₦' || ROUND(v_cycle_locked, 2) || ' locked in an active first-period savings cycle');
    END IF;
    v_lock_msg := CASE
      WHEN array_length(v_lock_parts, 1) > 0
        THEN 'Insufficient withdrawable balance — ' || array_to_string(v_lock_parts, ' and ')
      ELSE 'balance too low'
    END;
    RETURN jsonb_build_object(
      'ok',           false,
      'error',        v_lock_msg,
      'esusu_locked', v_esusu_locked,
      'cycle_locked', v_cycle_locked,
      'group_locked', v_group_locked,
      'withdrawable', GREATEST(v_withdrawable, 0)
    );
  END IF;

  IF p_request_id IS NOT NULL THEN
    SELECT cycle_id, group_id INTO v_attr_cycle_id, v_attr_group_id
    FROM ajo_withdrawal_requests WHERE id = p_request_id;
    v_attr_cycle_id := COALESCE(p_cycle_id, v_attr_cycle_id);
    v_attr_group_id := COALESCE(p_group_id, v_attr_group_id);
  ELSE
    v_attr_cycle_id := p_cycle_id;
    v_attr_group_id := p_group_id;
  END IF;

  SELECT COALESCE(commission_percent, 0) INTO v_pct_fee
  FROM ajo_cycles
  WHERE client_id = p_client_id
    AND status = 'active'
    AND commission_model = 'percent'
  ORDER BY created_at ASC
  LIMIT 1;

  v_fee_amount := CASE WHEN COALESCE(v_pct_fee, 0) > 0
    THEN ROUND(p_gross_amount * v_pct_fee / 100, 2)
    ELSE 0
  END;
  v_net_amount := p_gross_amount - v_fee_amount;

  IF v_net_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Amount too small after fee');
  END IF;

  INSERT INTO ajo_contributions (
    aso_client_id, owner_id, amount, type,
    payment_method, status, notes, recorded_by, paystack_status,
    cycle_id, group_id
  ) VALUES (
    p_client_id, p_owner_id, v_net_amount, 'withdrawal',
    p_method, 'completed', p_notes, p_recorded_by, 'completed',
    v_attr_cycle_id, v_attr_group_id
  )
  RETURNING id INTO v_net_id;

  IF v_fee_amount > 0 THEN
    INSERT INTO ajo_contributions (
      aso_client_id, owner_id, amount, type,
      payment_method, status, recorded_by,
      fee_for_contribution_id, paystack_status,
      cycle_id, group_id
    ) VALUES (
      p_client_id, p_owner_id, v_fee_amount, 'withdrawal_fee',
      p_method, 'completed', p_recorded_by,
      v_net_id, 'completed',
      v_attr_cycle_id, v_attr_group_id
    )
    RETURNING id INTO v_fee_id;
  END IF;

  UPDATE aso_clients SET
    current_balance = current_balance - p_gross_amount,
    total_withdrawn = COALESCE(total_withdrawn, 0) + v_net_amount
  WHERE id = p_client_id;

  IF p_request_id IS NOT NULL THEN
    UPDATE ajo_withdrawal_requests
    SET status = 'approved', approved_at = NOW()
    WHERE id = p_request_id;
  END IF;

  -- ── schedule a real wallet-to-wallet payout, next business working day ──
  IF v_client.client_user_id IS NOT NULL AND v_net_amount > 0 THEN
    v_payout_date := public.ajo_next_business_day(CURRENT_DATE);
    INSERT INTO public.ajo_wallet_payouts (
      withdrawal_id, request_id, client_id, owner_id, client_user_id,
      amount_kobo, scheduled_date
    ) VALUES (
      v_net_id, p_request_id, p_client_id, p_owner_id, v_client.client_user_id,
      ROUND(v_net_amount * 100)::BIGINT, v_payout_date
    );
    v_payout_scheduled := true;
  END IF;

  -- Settle EVERY one of this client's completed cycles that's now fully
  -- drained — not just the one this withdrawal happened to be attributed to.
  -- Broadened so a withdrawal that isn't attributed to a specific cycle_id
  -- (or any other path that doesn't) can't leave a zero-balance cycle
  -- permanently stuck at 'completed', still showing as an available
  -- withdrawal target with nothing actually left in it.
  FOR v_cyc_close IN
    SELECT id, label FROM ajo_cycles
    WHERE client_id = p_client_id AND status = 'completed'
  LOOP
    v_cycle_net_bal := ajo_cycle_net_balance(v_cyc_close.id);
    IF v_cycle_net_bal < 0.01 THEN
      UPDATE ajo_cycles SET status = 'settled' WHERE id = v_cyc_close.id;
      IF v_cyc_close.id = v_attr_cycle_id THEN
        v_cycle_just_closed := true;
        v_closed_label      := v_cyc_close.label;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok',                 true,
    'net_id',             v_net_id,
    'fee_id',              v_fee_id,
    'fee_amount',          v_fee_amount,
    'net_amount',          v_net_amount,
    'gross_amount',        p_gross_amount,
    'commission_collected', v_total_commission_due,
    'new_balance',         v_working_balance - p_gross_amount,
    'cycle_just_closed',   v_cycle_just_closed,
    'closed_cycle_id',     v_attr_cycle_id,
    'closed_cycle_label',  v_closed_label,
    'payout_scheduled',    v_payout_scheduled,
    'payout_date',         v_payout_date
  );
END;
$function$;
