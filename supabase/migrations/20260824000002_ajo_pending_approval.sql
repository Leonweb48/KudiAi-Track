-- ── Manual contribution pending-approval flow ────────────────────────────────
-- ajo_record_contribution now creates a 'pending' entry (no immediate balance credit).
-- A new ajo_approve_contribution RPC does the balance credit when the owner confirms.
-- Client portal shows the pending entry until approval; approved_by / approved_at track who confirmed.

-- 1. Add approved_by / approved_at columns for audit trail
ALTER TABLE ajo_contributions
  ADD COLUMN IF NOT EXISTS approved_by  UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at  TIMESTAMPTZ;

-- 2. Updated ajo_record_contribution — creates pending entry, defers balance credit
DROP FUNCTION IF EXISTS ajo_record_contribution(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, UUID, TEXT);

CREATE OR REPLACE FUNCTION ajo_record_contribution(
  p_client_id            UUID,
  p_owner_id             UUID,
  p_amount               NUMERIC,
  p_method               TEXT    DEFAULT 'cash',
  p_ref                  TEXT    DEFAULT NULL,
  p_notes                TEXT    DEFAULT NULL,
  p_recorded_by          UUID    DEFAULT NULL,
  p_contribution_context TEXT    DEFAULT 'personal_savings'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client          RECORD;
  v_contribution_id UUID;
BEGIN
  SELECT * INTO v_client FROM aso_clients WHERE id = p_client_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Client not found');
  END IF;

  IF v_client.user_id IS NOT NULL AND v_client.user_id != p_owner_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Amount must be greater than zero');
  END IF;

  -- Insert as pending — balance credit and next_contribution_date update happen on approval
  INSERT INTO ajo_contributions (
    aso_client_id, owner_id, amount, type,
    payment_method, paystack_ref, status, notes,
    recorded_by, paystack_status, contribution_context
  ) VALUES (
    p_client_id, p_owner_id, p_amount, 'contribution',
    p_method, p_ref, 'pending', p_notes,
    p_recorded_by, 'pending', p_contribution_context
  )
  RETURNING id INTO v_contribution_id;

  RETURN jsonb_build_object(
    'ok',              true,
    'contribution_id', v_contribution_id,
    'status',          'pending'
  );
END;
$$;

REVOKE ALL ON FUNCTION ajo_record_contribution(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION ajo_record_contribution(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, UUID, TEXT) TO service_role;


-- 3. New ajo_approve_contribution — works on any pending contribution (any payment_method)
--    Mirrors ajo_confirm_manual_deposit: first-deposit reg fee, balance credit, date advance.
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
  v_contrib    RECORD;
  v_client     RECORD;
  v_is_first   BOOLEAN;
  v_reg_fee    NUMERIC := 0;
  v_net_add    NUMERIC;
  v_freq_days  INT;
  v_base_date  DATE;
  v_next_date  DATE;
  v_reg_fee_id UUID;
BEGIN
  -- Lock the pending contribution (idempotent: second call returns not-found)
  SELECT * INTO v_contrib
  FROM ajo_contributions
  WHERE id     = p_contribution_id
    AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Contribution not found or already processed');
  END IF;

  IF v_contrib.owner_id IS NOT NULL AND v_contrib.owner_id != p_owner_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized');
  END IF;

  -- Lock client row
  SELECT * INTO v_client FROM aso_clients WHERE id = v_contrib.aso_client_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Client not found');
  END IF;

  -- First-deposit reg fee (identical logic to ajo_confirm_manual_deposit)
  v_is_first := (COALESCE(v_client.total_saved, 0) = 0);
  IF v_is_first THEN
    v_reg_fee := COALESCE(v_client.registration_charge, 0);
  END IF;
  v_net_add := v_contrib.amount - v_reg_fee;

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
      fee_for_contribution_id, paystack_status, contribution_context
    ) VALUES (
      v_contrib.aso_client_id, v_contrib.owner_id, v_reg_fee, 'registration_fee',
      v_contrib.payment_method, 'completed',
      'Registration fee on first deposit',
      p_contribution_id, 'completed', v_contrib.contribution_context
    )
    RETURNING id INTO v_reg_fee_id;
  END IF;

  -- Credit balance
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
    'new_balance',     COALESCE(v_client.current_balance, 0) + v_net_add,
    'next_date',       v_next_date
  );
END;
$$;

REVOKE ALL ON FUNCTION ajo_approve_contribution(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION ajo_approve_contribution(UUID, UUID, UUID) TO service_role;
