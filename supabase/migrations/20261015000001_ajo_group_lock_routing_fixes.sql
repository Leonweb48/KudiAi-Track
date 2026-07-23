-- ─────────────────────────────────────────────────────────────────────────────
-- Fix 1A  ajo_locked_group_amount — new lock for committed group/esusu money
-- Fix 1B  ajo_record_withdrawal   — add group lock as third stack
-- Fix 5   Verify first_period lock releases on cycle close (proof via SAVEPOINT)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Fix 1A: ajo_locked_group_amount ──────────────────────────────────────────
-- Returns the net amount the client has committed to savings groups and esusu
-- rotations that has not yet been returned via payout/disbursement/withdrawal.
-- Contributions tagged group_savings or esusu_rotation → locked.
-- Withdrawals or disbursements from those groups (group_id IS NOT NULL) → unlocked.
-- Reversals flip the sign so the ledger stays balanced.

CREATE OR REPLACE FUNCTION public.ajo_locked_group_amount(p_client_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(COALESCE(
    SUM(
      CASE c.type
        WHEN 'contribution'           THEN  c.amount
        WHEN 'reversal_contribution'  THEN -c.amount
        WHEN 'disbursement'           THEN -c.amount
        WHEN 'withdrawal'             THEN -c.amount
        WHEN 'reversal_withdrawal'    THEN  c.amount
        ELSE 0
      END
    ),
    0
  ), 0)
  FROM ajo_contributions c
  WHERE c.aso_client_id = p_client_id
    AND c.status        = 'completed'
    AND (
      -- Group deposits/reversals: identified by contribution_context
      (c.type IN ('contribution', 'reversal_contribution')
       AND c.contribution_context IN ('group_savings', 'esusu_rotation'))
      OR
      -- Money returned from a group (payout, formal withdrawal, reversed withdrawal)
      (c.type IN ('disbursement', 'withdrawal', 'reversal_withdrawal')
       AND c.group_id IS NOT NULL)
    );
$$;

REVOKE ALL ON FUNCTION public.ajo_locked_group_amount(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ajo_locked_group_amount(UUID) TO service_role, authenticated;

-- ── Fix 1B: ajo_record_withdrawal — add group lock as third stack ─────────────
-- Full replacement of the 9-arg function. Only change: add v_group_locked,
-- include it in v_withdrawable, and extend the rejection message to name it.

DROP FUNCTION IF EXISTS public.ajo_record_withdrawal(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, UUID, UUID, UUID);

CREATE FUNCTION public.ajo_record_withdrawal(
  p_client_id    UUID,
  p_owner_id     UUID,
  p_gross_amount NUMERIC,
  p_method       TEXT    DEFAULT 'cash',
  p_notes        TEXT    DEFAULT NULL,
  p_recorded_by  UUID    DEFAULT NULL,
  p_request_id   UUID    DEFAULT NULL,
  p_cycle_id     UUID    DEFAULT NULL,
  p_group_id     UUID    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client        RECORD;
  v_esusu_locked  NUMERIC;
  v_cycle_locked  NUMERIC;
  v_group_locked  NUMERIC;
  v_withdrawable  NUMERIC;
  v_pct_fee       NUMERIC;
  v_fee_amount    NUMERIC;
  v_net_amount    NUMERIC;
  v_net_id        UUID;
  v_fee_id        UUID;
  v_lock_msg      TEXT;
  v_lock_parts    TEXT[];
  v_attr_cycle_id UUID;
  v_attr_group_id UUID;
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

  IF COALESCE(v_client.current_balance, 0) < p_gross_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Insufficient balance');
  END IF;

  -- Three-way lock: esusu round + first_period cycle + committed group/esusu
  v_esusu_locked := ajo_locked_esusu_amount(p_client_id);
  v_cycle_locked := ajo_locked_cycle_amount(p_client_id);
  v_group_locked := ajo_locked_group_amount(p_client_id);
  v_withdrawable := COALESCE(v_client.current_balance, 0)
                    - v_esusu_locked - v_cycle_locked - v_group_locked;

  IF v_withdrawable < p_gross_amount THEN
    -- Build rejection message naming each non-zero lock
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

  -- Resolve attribution: request row wins, then explicit params
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

  RETURN jsonb_build_object(
    'ok',           true,
    'net_id',       v_net_id,
    'fee_id',       v_fee_id,
    'fee_amount',   v_fee_amount,
    'net_amount',   v_net_amount,
    'gross_amount', p_gross_amount,
    'new_balance',  COALESCE(v_client.current_balance, 0) - p_gross_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ajo_record_withdrawal(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ajo_record_withdrawal(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, UUID, UUID, UUID)
  TO service_role;

-- ── Fix 5: Verify first_period lock releases on cycle close ───────────────────
-- Uses SAVEPOINT so the test UPDATE is rolled back — cycle status unchanged.
-- Evidence appears as NOTICE output in migration logs.

DO $$
DECLARE
  v_client_id     UUID;
  v_cycle_id      UUID;
  v_locked_before NUMERIC;
  v_locked_after  NUMERIC;
BEGIN
  -- Find an active first_period cycle that has had its commission collected
  SELECT cy.client_id, cy.id
  INTO   v_client_id, v_cycle_id
  FROM   ajo_cycles cy
  WHERE  cy.commission_model = 'first_period'
    AND  cy.status           = 'active'
    AND  EXISTS (
           SELECT 1 FROM ajo_contributions fc
           WHERE fc.cycle_id = cy.id
             AND fc.type     = 'commission'
             AND fc.status   = 'completed'
         )
  LIMIT 1;

  IF v_client_id IS NULL THEN
    RAISE NOTICE 'Fix 5: No qualifying first_period cycle found — lock release is structural (WHERE cy.status = ''active'' in ajo_locked_cycle_amount).';
    RETURN;
  END IF;

  v_locked_before := ajo_locked_cycle_amount(v_client_id);
  RAISE NOTICE 'Fix 5 PRE-CLOSE : client=%, cycle=%, ajo_locked_cycle_amount=₦%',
    v_client_id, v_cycle_id, v_locked_before;

  SAVEPOINT sp_fix5_verify;
  UPDATE ajo_cycles SET status = 'completed', closed_at = NOW() WHERE id = v_cycle_id;
  v_locked_after := ajo_locked_cycle_amount(v_client_id);
  RAISE NOTICE 'Fix 5 POST-CLOSE: ajo_locked_cycle_amount=₦% (expected 0)', v_locked_after;
  ROLLBACK TO SAVEPOINT sp_fix5_verify;

  IF v_locked_after = 0 THEN
    RAISE NOTICE 'Fix 5 PASS: withdrawable increases by ₦% across cycle closure', v_locked_before;
  ELSE
    RAISE EXCEPTION 'Fix 5 FAIL: lock did not release on close — expected 0, got %', v_locked_after;
  END IF;
END;
$$;
