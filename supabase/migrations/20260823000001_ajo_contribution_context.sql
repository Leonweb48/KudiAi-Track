-- Add contribution_context to ajo_contributions so each entry is clearly tagged
-- as personal_savings | group_savings | esusu_rotation.
-- Both RPCs are dropped and recreated with the new param (default = 'personal_savings'
-- so existing callers are unaffected during the deployment window).

-- ── 1. Column ────────────────────────────────────────────────────────────────
ALTER TABLE ajo_contributions
  ADD COLUMN IF NOT EXISTS contribution_context TEXT NOT NULL DEFAULT 'personal_savings'
    CONSTRAINT ajo_contributions_context_chk
      CHECK (contribution_context IN ('personal_savings', 'group_savings', 'esusu_rotation'));

-- ── 2. ajo_record_contribution (owner / staff manual cash recording) ─────────
DROP FUNCTION IF EXISTS ajo_record_contribution(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, UUID);

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
  v_is_first        BOOLEAN;
  v_reg_fee         NUMERIC := 0;
  v_net_balance_add NUMERIC;
  v_freq_days       INT;
  v_base_date       DATE;
  v_next_date       DATE;
  v_contribution_id UUID;
  v_reg_fee_id      UUID;
BEGIN
  SELECT * INTO v_client FROM aso_clients WHERE id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Client not found');
  END IF;

  IF v_client.user_id IS NOT NULL AND v_client.user_id != p_owner_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Amount must be greater than zero');
  END IF;

  v_is_first := (COALESCE(v_client.total_saved, 0) = 0);
  IF v_is_first THEN
    v_reg_fee := COALESCE(v_client.registration_charge, 0);
  END IF;
  v_net_balance_add := p_amount - v_reg_fee;

  v_freq_days := CASE COALESCE(v_client.contribution_frequency, 'monthly')
    WHEN 'daily'   THEN 1
    WHEN 'weekly'  THEN 7
    ELSE 30
  END;
  v_base_date := COALESCE(v_client.next_contribution_date, CURRENT_DATE);
  v_next_date := v_base_date + v_freq_days;

  INSERT INTO ajo_contributions (
    aso_client_id, owner_id, amount, type,
    payment_method, paystack_ref, status, notes,
    recorded_by, paystack_status, contribution_context
  ) VALUES (
    p_client_id, p_owner_id, p_amount, 'contribution',
    p_method, p_ref, 'completed', p_notes,
    p_recorded_by, 'completed', p_contribution_context
  )
  RETURNING id INTO v_contribution_id;

  IF v_is_first AND v_reg_fee > 0 THEN
    INSERT INTO ajo_contributions (
      aso_client_id, owner_id, amount, type,
      payment_method, status, notes, recorded_by,
      fee_for_contribution_id, paystack_status, contribution_context
    ) VALUES (
      p_client_id, p_owner_id, v_reg_fee, 'registration_fee',
      p_method, 'completed', 'Registration fee on first deposit', p_recorded_by,
      v_contribution_id, 'completed', p_contribution_context
    )
    RETURNING id INTO v_reg_fee_id;
  END IF;

  UPDATE aso_clients SET
    total_saved            = COALESCE(total_saved, 0)     + p_amount,
    current_balance        = COALESCE(current_balance, 0) + v_net_balance_add,
    next_contribution_date = v_next_date
  WHERE id = p_client_id;

  RETURN jsonb_build_object(
    'ok',              true,
    'contribution_id', v_contribution_id,
    'reg_fee_id',      v_reg_fee_id,
    'reg_fee',         v_reg_fee,
    'new_balance',     COALESCE(v_client.current_balance, 0) + v_net_balance_add,
    'next_date',       v_next_date
  );
END;
$$;

REVOKE ALL ON FUNCTION ajo_record_contribution(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ajo_record_contribution(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, UUID, TEXT) TO service_role;

-- ── 3. ajo_submit_manual_claim (client self-service bank-transfer claim) ─────
DROP FUNCTION IF EXISTS ajo_submit_manual_claim(uuid, uuid, numeric, text, text, text);

CREATE OR REPLACE FUNCTION ajo_submit_manual_claim(
  p_client_id            uuid,
  p_owner_id             uuid,
  p_amount               numeric,
  p_payer_name           text    DEFAULT NULL,
  p_notes                text    DEFAULT NULL,
  p_proof_url            text    DEFAULT NULL,
  p_contribution_context text    DEFAULT 'personal_savings'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client      record;
  v_pending_cnt int;
  v_claim_id    uuid;
BEGIN
  SELECT * INTO v_client FROM aso_clients WHERE id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Client not found');
  END IF;

  IF v_client.user_id IS NOT NULL AND v_client.user_id != p_owner_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Amount must be greater than zero');
  END IF;

  SELECT COUNT(*) INTO v_pending_cnt
  FROM ajo_contributions
  WHERE aso_client_id = p_client_id
    AND status         = 'pending'
    AND payment_method = 'manual_transfer';

  IF v_pending_cnt >= 3 THEN
    RETURN jsonb_build_object(
      'ok',    false,
      'error', 'You have 3 unconfirmed deposit claims. Wait for your savings agent to confirm them before submitting more.'
    );
  END IF;

  INSERT INTO ajo_contributions (
    aso_client_id, owner_id, amount, type,
    payment_method, status, initiated_by,
    payer_name, claim_notes, proof_url,
    paystack_status, contribution_context
  ) VALUES (
    p_client_id, p_owner_id, p_amount, 'contribution',
    'manual_transfer', 'pending', 'client',
    p_payer_name, p_notes, p_proof_url,
    'pending', p_contribution_context
  )
  RETURNING id INTO v_claim_id;

  RETURN jsonb_build_object('ok', true, 'claim_id', v_claim_id, 'amount', p_amount);
END;
$$;

REVOKE ALL ON FUNCTION ajo_submit_manual_claim(uuid, uuid, numeric, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ajo_submit_manual_claim(uuid, uuid, numeric, text, text, text, text) TO service_role;
