-- Add p_cycle_id parameter to ajo_submit_manual_claim so the pending row
-- carries cycle attribution through to ajo_approve_contribution.
DROP FUNCTION IF EXISTS ajo_submit_manual_claim(UUID,UUID,NUMERIC,TEXT,TEXT,TEXT,TEXT);

CREATE OR REPLACE FUNCTION ajo_submit_manual_claim(
  p_client_id            UUID,
  p_owner_id             UUID,
  p_amount               NUMERIC,
  p_payer_name           TEXT    DEFAULT NULL,
  p_notes                TEXT    DEFAULT NULL,
  p_proof_url            TEXT    DEFAULT NULL,
  p_contribution_context TEXT    DEFAULT 'personal_savings',
  p_cycle_id             UUID    DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
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
    paystack_status, contribution_context, cycle_id
  ) VALUES (
    p_client_id, p_owner_id, p_amount, 'contribution',
    'manual_transfer', 'pending', 'client',
    p_payer_name, p_notes, p_proof_url,
    'pending', p_contribution_context, p_cycle_id
  )
  RETURNING id INTO v_claim_id;

  RETURN jsonb_build_object('ok', true, 'claim_id', v_claim_id, 'amount', p_amount);
END;
$$;