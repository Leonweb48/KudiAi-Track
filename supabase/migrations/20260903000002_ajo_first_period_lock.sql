-- Cycles v2 Part 2: first_period lock + cycle-based fee reads
--
-- Three functions rewritten:
--   1. ajo_approve_contribution — commission_model read from cycle, not client
--   2. ajo_confirm_payment      — same: cycle's model, not client's
--   3. ajo_record_withdrawal    — stacks esusu + first_period locks; fee from
--                                 active percent cycle (not client row)
--
-- Invariant: ledger immutability, request→approve rails, server-side enforcement.
-- esusu solvency machinery (ajo_execute_payout, ajo_locked_esusu_amount) untouched.
-- Registration fee remains client-level, first-deposit-ever, never per-cycle.


-- ── 1. ajo_approve_contribution — cycle-based first_period check ────────────────
CREATE OR REPLACE FUNCTION ajo_approve_contribution(
  p_contribution_id UUID,
  p_owner_id        UUID,
  p_approver_id     UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contrib       RECORD;
  v_client        RECORD;
  v_is_first      BOOLEAN;
  v_reg_fee       NUMERIC := 0;
  v_cycle_fee     NUMERIC := 0;
  v_net_add       NUMERIC;
  v_freq_days     INT;
  v_base_date     DATE;
  v_next_date     DATE;
  v_reg_fee_id    UUID;
  v_commission_id UUID;
  v_cycle_id      UUID;
BEGIN
  SELECT * INTO v_contrib
  FROM ajo_contributions
  WHERE id = p_contribution_id AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Contribution not found or already processed');
  END IF;

  IF v_contrib.owner_id IS NOT NULL AND v_contrib.owner_id != p_owner_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized');
  END IF;

  SELECT * INTO v_client FROM aso_clients WHERE id = v_contrib.aso_client_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Client not found');
  END IF;

  -- Registration fee: first-ever deposit only (client-level, one-time)
  v_is_first := (COALESCE(v_client.total_saved, 0) = 0);
  IF v_is_first THEN
    v_reg_fee := COALESCE(v_client.registration_charge, 0);
  END IF;

  v_freq_days := CASE COALESCE(v_client.contribution_frequency, 'monthly')
    WHEN 'daily'  THEN 1
    WHEN 'weekly' THEN 7
    ELSE 30
  END;
  v_base_date := COALESCE(v_client.next_contribution_date, CURRENT_DATE);
  v_next_date := v_base_date + v_freq_days;

  -- Flip contribution to completed
  UPDATE ajo_contributions SET
    status          = 'completed',
    paystack_status = 'completed',
    approved_by     = p_approver_id,
    approved_at     = NOW()
  WHERE id = p_contribution_id;

  -- Registration fee row (first deposit only)
  IF v_is_first AND v_reg_fee > 0 THEN
    INSERT INTO ajo_contributions (
      aso_client_id, owner_id, amount, type,
      payment_method, status, notes,
      fee_for_contribution_id, paystack_status, contribution_context, cycle_id
    ) VALUES (
      v_contrib.aso_client_id, v_contrib.owner_id, v_reg_fee, 'registration_fee',
      v_contrib.payment_method, 'completed', 'Registration fee on first deposit',
      p_contribution_id, 'completed', v_contrib.contribution_context, v_contrib.cycle_id
    )
    RETURNING id INTO v_reg_fee_id;
  END IF;

  -- first_period cycle fee: read from THE CYCLE'S commission_model, not the client row.
  -- Personal_savings contributions only (esusu rotation contributions are excluded).
  IF COALESCE(v_contrib.contribution_context, 'personal_savings') = 'personal_savings' THEN
    v_cycle_id := v_contrib.cycle_id;
    IF v_cycle_id IS NOT NULL THEN
      -- Explicit cycle on the pending row: must be active, first_period, and fee not yet taken
      IF NOT EXISTS (
        SELECT 1 FROM ajo_cycles cy
        WHERE cy.id = v_cycle_id AND cy.status = 'active' AND cy.commission_model = 'first_period'
      ) OR EXISTS (
        SELECT 1 FROM ajo_contributions fc
        WHERE fc.cycle_id = v_cycle_id AND fc.type = 'commission' AND fc.status = 'completed'
      ) THEN
        v_cycle_id := NULL;
      END IF;
    ELSE
      -- Auto-detect: oldest active first_period cycle for this client with no fee row yet
      SELECT c.id INTO v_cycle_id
      FROM ajo_cycles c
      WHERE c.client_id = v_contrib.aso_client_id
        AND c.status = 'active'
        AND c.commission_model = 'first_period'
        AND NOT EXISTS (
          SELECT 1 FROM ajo_contributions fc
          WHERE fc.cycle_id = c.id AND fc.type = 'commission' AND fc.status = 'completed'
        )
      ORDER BY c.created_at ASC
      LIMIT 1;
    END IF;

    IF v_cycle_id IS NOT NULL THEN
      -- Cycle fee = deposit minus reg fee (net portion that would go to savings)
      v_cycle_fee := v_contrib.amount - v_reg_fee;
      IF v_cycle_fee > 0 THEN
        INSERT INTO ajo_contributions (
          aso_client_id, owner_id, amount, type,
          payment_method, status, notes,
          fee_for_contribution_id, paystack_status, contribution_context, cycle_id
        ) VALUES (
          v_contrib.aso_client_id, v_contrib.owner_id, v_cycle_fee, 'commission',
          v_contrib.payment_method, 'completed', 'Cycle fee — first deposit',
          p_contribution_id, 'completed', v_contrib.contribution_context, v_cycle_id
        )
        RETURNING id INTO v_commission_id;
      END IF;
    END IF;
  END IF;

  -- Net balance credit: full deposit minus reg fee minus cycle fee
  v_net_add := v_contrib.amount - v_reg_fee - v_cycle_fee;

  UPDATE aso_clients SET
    total_saved            = COALESCE(total_saved, 0)     + v_contrib.amount,
    current_balance        = COALESCE(current_balance, 0) + v_net_add,
    next_contribution_date = v_next_date
  WHERE id = v_contrib.aso_client_id;

  RETURN jsonb_build_object(
    'ok',              true,
    'contribution_id', p_contribution_id,
    'client_id',       v_contrib.aso_client_id,
    'amount',          v_contrib.amount,
    'reg_fee',         v_reg_fee,
    'reg_fee_id',      v_reg_fee_id,
    'cycle_fee',       v_cycle_fee,
    'commission_id',   v_commission_id,
    'is_first_cycle',  v_cycle_id IS NOT NULL AND v_cycle_fee > 0,
    'new_balance',     COALESCE(v_client.current_balance, 0) + v_net_add,
    'next_date',       v_next_date
  );
END;
$$;

REVOKE ALL ON FUNCTION ajo_approve_contribution(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION ajo_approve_contribution(UUID, UUID, UUID) TO service_role;


-- ── 2. ajo_confirm_payment — cycle-based first_period check ────────────────────
CREATE OR REPLACE FUNCTION ajo_confirm_payment(
  p_paystack_ref TEXT,
  p_paid_at      TIMESTAMPTZ DEFAULT NOW(),
  p_channel      TEXT        DEFAULT 'card'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contrib       RECORD;
  v_client        RECORD;
  v_freq_days     INT;
  v_base_date     DATE;
  v_next_date     DATE;
  v_cycle_fee     NUMERIC := 0;
  v_cycle_id      UUID;
  v_commission_id UUID;
BEGIN
  SELECT * INTO v_contrib
  FROM ajo_contributions
  WHERE paystack_ref = p_paystack_ref AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not found or already confirmed');
  END IF;

  UPDATE ajo_contributions SET
    status          = 'completed',
    paystack_status = 'success',
    paid_at         = p_paid_at,
    payment_channel = p_channel
  WHERE id = v_contrib.id;

  SELECT * INTO v_client FROM aso_clients WHERE id = v_contrib.aso_client_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Client not found');
  END IF;

  v_freq_days := CASE COALESCE(v_client.contribution_frequency, 'monthly')
    WHEN 'daily'   THEN 1
    WHEN 'weekly'  THEN 7
    ELSE 30
  END;
  v_base_date := COALESCE(v_client.next_contribution_date, CURRENT_DATE);
  v_next_date := v_base_date + v_freq_days;

  -- first_period cycle fee: read from THE CYCLE'S commission_model.
  -- Paystack path: no reg fee collected here; full deposit amount → collector on first deposit.
  IF COALESCE(v_contrib.contribution_context, 'personal_savings') = 'personal_savings' THEN
    v_cycle_id := v_contrib.cycle_id;
    IF v_cycle_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM ajo_cycles cy
        WHERE cy.id = v_cycle_id AND cy.status = 'active' AND cy.commission_model = 'first_period'
      ) OR EXISTS (
        SELECT 1 FROM ajo_contributions fc
        WHERE fc.cycle_id = v_cycle_id AND fc.type = 'commission' AND fc.status = 'completed'
      ) THEN
        v_cycle_id := NULL;
      END IF;
    ELSE
      SELECT c.id INTO v_cycle_id
      FROM ajo_cycles c
      WHERE c.client_id = v_contrib.aso_client_id
        AND c.status = 'active'
        AND c.commission_model = 'first_period'
        AND NOT EXISTS (
          SELECT 1 FROM ajo_contributions fc
          WHERE fc.cycle_id = c.id AND fc.type = 'commission' AND fc.status = 'completed'
        )
      ORDER BY c.created_at ASC
      LIMIT 1;
    END IF;

    IF v_cycle_id IS NOT NULL THEN
      v_cycle_fee := v_contrib.amount;
      INSERT INTO ajo_contributions (
        aso_client_id, owner_id, amount, type,
        payment_method, status, notes,
        fee_for_contribution_id, paystack_status, contribution_context, cycle_id
      ) VALUES (
        v_contrib.aso_client_id, v_contrib.owner_id, v_cycle_fee, 'commission',
        p_channel, 'completed', 'Cycle fee — first deposit',
        v_contrib.id, 'completed',
        COALESCE(v_contrib.contribution_context, 'personal_savings'), v_cycle_id
      )
      RETURNING id INTO v_commission_id;
    END IF;
  END IF;

  -- Credit balance: contribution amount minus cycle fee (0 for non-first-period deposits)
  UPDATE aso_clients SET
    current_balance        = COALESCE(current_balance, 0) + v_contrib.amount - v_cycle_fee,
    total_saved            = COALESCE(total_saved, 0)     + v_contrib.amount,
    next_contribution_date = v_next_date
  WHERE id = v_contrib.aso_client_id;

  RETURN jsonb_build_object(
    'ok',             true,
    'client_id',      v_contrib.aso_client_id,
    'amount',         v_contrib.amount,
    'cycle_fee',      v_cycle_fee,
    'commission_id',  v_commission_id,
    'is_first_cycle', v_cycle_id IS NOT NULL AND v_cycle_fee > 0,
    'new_balance',    COALESCE(v_client.current_balance, 0) + v_contrib.amount - v_cycle_fee
  );
END;
$$;

REVOKE ALL ON FUNCTION ajo_confirm_payment(TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION ajo_confirm_payment(TEXT, TIMESTAMPTZ, TEXT) TO service_role;


-- ── 3. ajo_record_withdrawal — stack both locks; fee from active percent cycle ──
-- Stacks: withdrawable = balance − ajo_locked_esusu_amount − ajo_locked_cycle_amount
-- Fee:    from the active percent cycle (if any), NOT from the client row.
-- Error:  names both lock amounts separately so the client knows what's held and why.
CREATE OR REPLACE FUNCTION public.ajo_record_withdrawal(
  p_client_id    UUID,
  p_owner_id     UUID,
  p_gross_amount NUMERIC,
  p_method       TEXT    DEFAULT 'cash',
  p_notes        TEXT    DEFAULT NULL,
  p_recorded_by  UUID    DEFAULT NULL,
  p_request_id   UUID    DEFAULT NULL
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
  v_withdrawable  NUMERIC;
  v_pct_fee       NUMERIC;
  v_fee_amount    NUMERIC;
  v_net_amount    NUMERIC;
  v_net_id        UUID;
  v_fee_id        UUID;
  v_lock_msg      TEXT;
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

  -- Basic balance check
  IF COALESCE(v_client.current_balance, 0) < p_gross_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Insufficient balance');
  END IF;

  -- Stack: esusu lock + first_period cycle lock
  v_esusu_locked := ajo_locked_esusu_amount(p_client_id);
  v_cycle_locked := ajo_locked_cycle_amount(p_client_id);
  v_withdrawable := COALESCE(v_client.current_balance, 0) - v_esusu_locked - v_cycle_locked;

  IF v_withdrawable < p_gross_amount THEN
    -- Build a human-readable lock breakdown naming each non-zero component
    v_lock_msg := CASE
      WHEN v_esusu_locked > 0 AND v_cycle_locked > 0
        THEN '₦' || ROUND(v_esusu_locked, 2) || ' locked in an active esusu round and ₦' || ROUND(v_cycle_locked, 2) || ' locked in an active first-period savings cycle'
      WHEN v_esusu_locked > 0
        THEN '₦' || ROUND(v_esusu_locked, 2) || ' is locked in an active esusu round'
      WHEN v_cycle_locked > 0
        THEN '₦' || ROUND(v_cycle_locked, 2) || ' is locked in an active first-period savings cycle'
      ELSE 'balance too low'
    END;
    RETURN jsonb_build_object(
      'ok',           false,
      'error',        'Insufficient withdrawable balance — ' || v_lock_msg,
      'esusu_locked', v_esusu_locked,
      'cycle_locked', v_cycle_locked,
      'withdrawable', GREATEST(v_withdrawable, 0)
    );
  END IF;

  -- Withdrawal fee: from the active percent cycle (not the client row)
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
    payment_method, status, notes, recorded_by, paystack_status
  ) VALUES (
    p_client_id, p_owner_id, v_net_amount, 'withdrawal',
    p_method, 'completed', p_notes, p_recorded_by, 'completed'
  )
  RETURNING id INTO v_net_id;

  IF v_fee_amount > 0 THEN
    INSERT INTO ajo_contributions (
      aso_client_id, owner_id, amount, type,
      payment_method, status, recorded_by,
      fee_for_contribution_id, paystack_status
    ) VALUES (
      p_client_id, p_owner_id, v_fee_amount, 'withdrawal_fee',
      p_method, 'completed', p_recorded_by,
      v_net_id, 'completed'
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

REVOKE ALL ON FUNCTION public.ajo_record_withdrawal(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ajo_record_withdrawal(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, UUID)
  TO service_role;
