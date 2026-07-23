-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: total_saved must track gross deposit amount, not net-after-fees.
--
-- In 20261001000002 and 20261002000000 the field was changed to += v_net_add
-- so "the collector's fee never appears in the client's savings total".
-- The correct semantic is: total_saved = money the client has ever deposited
-- (gross), which matches ajo_confirm_payment (Paystack path, unchanged).
-- The v_is_first gate was already fixed in 20261001000002 to use an EXISTS
-- query on ajo_contributions — it no longer depends on total_saved — so no
-- double-charge risk from restoring gross tracking.
--
-- Functions fixed here:
--   1. ajo_approve_contribution  (manual cash path  — overrides 20261002000000)
--   2. ajo_confirm_manual_deposit (bank-transfer path — overrides 20261001000002)
--   3. ajo_reverse_contribution  (reversal must remove gross, not net)
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. ajo_approve_contribution ───────────────────────────────────────────────
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
  v_contrib        RECORD;
  v_client         RECORD;
  v_is_first       BOOLEAN;
  v_reg_fee        NUMERIC := 0;
  v_cycle_fee      NUMERIC := 0;
  v_net_add        NUMERIC;
  v_freq_days      INT;
  v_base_date      DATE;
  v_next_date      DATE;
  v_reg_fee_id     UUID;
  v_commission_id  UUID;
  v_cycle_id       UUID;
  v_cycle_expected NUMERIC := 0;
  v_commission_acc NUMERIC := 0;
  v_newly_acc      NUMERIC := 0;
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

  v_is_first := NOT EXISTS (
    SELECT 1 FROM ajo_contributions
    WHERE aso_client_id = v_contrib.aso_client_id
      AND status = 'completed'
      AND type   = 'contribution'
  );
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

  UPDATE ajo_contributions SET
    status          = 'completed',
    paystack_status = 'completed',
    approved_by     = p_approver_id,
    approved_at     = NOW()
  WHERE id = p_contribution_id;

  IF v_is_first AND v_reg_fee > 0 THEN
    INSERT INTO ajo_contributions (
      aso_client_id, owner_id, amount, type,
      payment_method, status, notes,
      fee_for_contribution_id, paystack_status, contribution_context, cycle_id, group_id
    ) VALUES (
      v_contrib.aso_client_id, v_contrib.owner_id, v_reg_fee, 'registration_fee',
      v_contrib.payment_method, 'completed', 'Registration fee on first deposit',
      p_contribution_id, 'completed', v_contrib.contribution_context,
      v_contrib.cycle_id, v_contrib.group_id
    )
    RETURNING id INTO v_reg_fee_id;
  END IF;

  IF COALESCE(v_contrib.contribution_context, 'personal_savings') = 'personal_savings' THEN
    v_cycle_id := v_contrib.cycle_id;

    IF v_cycle_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM ajo_cycles cy
        WHERE cy.id = v_cycle_id
          AND cy.status = 'active'
          AND cy.commission_model = 'first_period'
      ) OR EXISTS (
        SELECT 1 FROM ajo_contributions fc
        WHERE fc.cycle_id = v_cycle_id
          AND fc.type = 'commission'
          AND fc.status = 'completed'
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
          WHERE fc.cycle_id = c.id
            AND fc.type = 'commission'
            AND fc.status = 'completed'
        )
      ORDER BY c.created_at ASC
      LIMIT 1;

      IF v_cycle_id IS NOT NULL THEN
        UPDATE ajo_contributions SET cycle_id = v_cycle_id WHERE id = p_contribution_id;
      END IF;
    END IF;

    IF v_cycle_id IS NOT NULL THEN
      SELECT expected_amount_per_period, COALESCE(commission_balance, 0)
      INTO v_cycle_expected, v_commission_acc
      FROM ajo_cycles WHERE id = v_cycle_id;

      v_newly_acc := v_contrib.amount - v_reg_fee;

      IF v_commission_acc = 0 AND v_newly_acc > 0 THEN
        v_cycle_fee := LEAST(v_newly_acc, v_cycle_expected);
        UPDATE ajo_cycles SET commission_balance = v_cycle_expected WHERE id = v_cycle_id;
        INSERT INTO ajo_contributions (
          aso_client_id, owner_id, amount, type,
          payment_method, status, notes,
          fee_for_contribution_id, paystack_status, contribution_context, cycle_id, group_id
        ) VALUES (
          v_contrib.aso_client_id, v_contrib.owner_id, v_cycle_fee, 'commission',
          v_contrib.payment_method, 'completed', 'Collector''s fee — Day 1',
          p_contribution_id, 'completed', v_contrib.contribution_context,
          v_cycle_id, v_contrib.group_id
        )
        RETURNING id INTO v_commission_id;
      END IF;
    END IF;
  END IF;

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
    'is_first_cycle',  v_commission_id IS NOT NULL,
    'new_balance',     COALESCE(v_client.current_balance, 0) + v_net_add,
    'next_date',       v_next_date
  );
END;
$$;

REVOKE ALL ON FUNCTION ajo_approve_contribution(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION ajo_approve_contribution(UUID, UUID, UUID) TO service_role;


-- ── 2. ajo_confirm_manual_deposit ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION ajo_confirm_manual_deposit(
  p_claim_id     UUID,
  p_owner_id     UUID,
  p_confirmed_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim          RECORD;
  v_client         RECORD;
  v_is_first       BOOLEAN;
  v_reg_fee        NUMERIC := 0;
  v_cycle_fee      NUMERIC := 0;
  v_net_add        NUMERIC;
  v_freq_days      INT;
  v_base_date      DATE;
  v_next_date      DATE;
  v_reg_fee_id     UUID;
  v_commission_id  UUID;
  v_cycle_id       UUID;
  v_cycle_expected NUMERIC := 0;
  v_commission_acc NUMERIC := 0;
  v_newly_acc      NUMERIC := 0;
BEGIN
  SELECT * INTO v_claim
  FROM ajo_contributions
  WHERE id             = p_claim_id
    AND status         = 'pending'
    AND payment_method = 'manual_transfer'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Claim not found or already processed');
  END IF;

  IF v_claim.owner_id IS NOT NULL AND v_claim.owner_id != p_owner_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized');
  END IF;

  SELECT * INTO v_client FROM aso_clients WHERE id = v_claim.aso_client_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Client not found');
  END IF;

  v_is_first := NOT EXISTS (
    SELECT 1 FROM ajo_contributions
    WHERE aso_client_id = v_claim.aso_client_id
      AND status = 'completed'
      AND type   = 'contribution'
  );
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

  UPDATE ajo_contributions SET
    status          = 'completed',
    paystack_status = 'completed',
    confirmed_by    = p_confirmed_by,
    confirmed_at    = NOW()
  WHERE id = p_claim_id;

  IF v_is_first AND v_reg_fee > 0 THEN
    INSERT INTO ajo_contributions (
      aso_client_id, owner_id, amount, type,
      payment_method, status, notes,
      fee_for_contribution_id, paystack_status, initiated_by
    ) VALUES (
      v_claim.aso_client_id, v_claim.owner_id, v_reg_fee, 'registration_fee',
      'manual_transfer', 'completed', 'Registration fee on first deposit',
      p_claim_id, 'completed', 'staff'
    )
    RETURNING id INTO v_reg_fee_id;
  END IF;

  IF COALESCE(v_claim.contribution_context, 'personal_savings') = 'personal_savings' THEN
    v_cycle_id := v_claim.cycle_id;

    IF v_cycle_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM ajo_cycles cy
        WHERE cy.id = v_cycle_id
          AND cy.status = 'active'
          AND cy.commission_model = 'first_period'
      ) OR EXISTS (
        SELECT 1 FROM ajo_contributions fc
        WHERE fc.cycle_id = v_cycle_id
          AND fc.type = 'commission'
          AND fc.status = 'completed'
      ) THEN
        v_cycle_id := NULL;
      END IF;
    ELSE
      SELECT c.id INTO v_cycle_id
      FROM ajo_cycles c
      WHERE c.client_id = v_claim.aso_client_id
        AND c.status = 'active'
        AND c.commission_model = 'first_period'
        AND NOT EXISTS (
          SELECT 1 FROM ajo_contributions fc
          WHERE fc.cycle_id = c.id
            AND fc.type = 'commission'
            AND fc.status = 'completed'
        )
      ORDER BY c.created_at ASC
      LIMIT 1;

      IF v_cycle_id IS NOT NULL THEN
        UPDATE ajo_contributions SET cycle_id = v_cycle_id WHERE id = p_claim_id;
      END IF;
    END IF;

    IF v_cycle_id IS NOT NULL THEN
      SELECT expected_amount_per_period, COALESCE(commission_balance, 0)
      INTO v_cycle_expected, v_commission_acc
      FROM ajo_cycles WHERE id = v_cycle_id;

      v_newly_acc := v_claim.amount - v_reg_fee;

      IF v_commission_acc = 0 AND v_newly_acc > 0 THEN
        v_cycle_fee := LEAST(v_newly_acc, v_cycle_expected);
        UPDATE ajo_cycles SET commission_balance = v_cycle_expected WHERE id = v_cycle_id;
        INSERT INTO ajo_contributions (
          aso_client_id, owner_id, amount, type,
          payment_method, status, notes,
          fee_for_contribution_id, paystack_status, contribution_context, cycle_id
        ) VALUES (
          v_claim.aso_client_id, v_claim.owner_id, v_cycle_fee, 'commission',
          'manual_transfer', 'completed', 'Collector''s fee — Day 1',
          p_claim_id, 'completed',
          COALESCE(v_claim.contribution_context, 'personal_savings'), v_cycle_id
        )
        RETURNING id INTO v_commission_id;
      END IF;
    END IF;
  END IF;

  v_net_add := v_claim.amount - v_reg_fee - v_cycle_fee;

  UPDATE aso_clients SET
    total_saved            = COALESCE(total_saved, 0)     + v_claim.amount,
    current_balance        = COALESCE(current_balance, 0) + v_net_add,
    next_contribution_date = v_next_date
  WHERE id = v_claim.aso_client_id;

  RETURN jsonb_build_object(
    'ok',             true,
    'claim_id',       p_claim_id,
    'client_id',      v_claim.aso_client_id,
    'amount',         v_claim.amount,
    'reg_fee',        v_reg_fee,
    'reg_fee_id',     v_reg_fee_id,
    'cycle_fee',      v_cycle_fee,
    'commission_id',  v_commission_id,
    'is_first_cycle', v_commission_id IS NOT NULL,
    'new_balance',    COALESCE(v_client.current_balance, 0) + v_net_add,
    'next_date',      v_next_date
  );
END;
$$;

REVOKE ALL ON FUNCTION ajo_confirm_manual_deposit(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION ajo_confirm_manual_deposit(UUID, UUID, UUID) TO service_role;


-- ── 3. ajo_reverse_contribution ───────────────────────────────────────────────
-- total_saved must decrease by the gross deposit amount (v_original.amount),
-- not by the net amount after fees (v_original.amount - v_fee_sum), which was
-- the old formula that matched the previous net-tracking convention.
CREATE OR REPLACE FUNCTION ajo_reverse_contribution(
  p_original_id UUID,
  p_owner_id    UUID,
  p_reason      TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_original      RECORD;
  v_client        RECORD;
  v_fee_rows      RECORD;
  v_balance_delta NUMERIC := 0;
  v_fee_sum       NUMERIC := 0;
  v_reversal_ids  UUID[]  := '{}';
  v_rev_net_id    UUID;
  v_rev_type      TEXT;
  v_rev_fee_type  TEXT;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Reason must be at least 5 characters');
  END IF;

  SELECT * INTO v_original FROM ajo_contributions WHERE id = p_original_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Row not found');
  END IF;

  IF v_original.status != 'completed' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not completed — only completed rows can be reversed');
  END IF;

  IF v_original.reverses_contribution_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Is a reversal — cannot reverse a reversal row');
  END IF;

  IF v_original.owner_id IS NOT NULL AND v_original.owner_id != p_owner_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized');
  END IF;

  IF v_original.fee_for_contribution_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Is a fee row — reverse the parent transaction instead');
  END IF;

  IF EXISTS (
    SELECT 1 FROM ajo_contributions WHERE reverses_contribution_id = p_original_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Already reversed');
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_fee_sum
  FROM ajo_contributions
  WHERE fee_for_contribution_id = p_original_id AND status = 'completed';

  CASE v_original.type
    WHEN 'contribution' THEN
      v_rev_type      := 'reversal_contribution';
      v_balance_delta := -(v_original.amount - v_fee_sum);
    WHEN 'withdrawal' THEN
      v_rev_type      := 'reversal_withdrawal';
      v_balance_delta := v_original.amount + v_fee_sum;
    ELSE
      RETURN jsonb_build_object('ok', false, 'error', 'Unsupported type: ' || v_original.type);
  END CASE;

  SELECT * INTO v_client FROM aso_clients WHERE id = v_original.aso_client_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Client not found');
  END IF;

  IF COALESCE(v_client.current_balance, 0) + v_balance_delta < 0 THEN
    RETURN jsonb_build_object(
      'ok',    false,
      'error', 'Client balance insufficient to reverse this entry'
    );
  END IF;

  INSERT INTO ajo_contributions (
    aso_client_id, owner_id, amount, type, payment_method,
    status, notes, recorded_by, reverses_contribution_id, paystack_status, cycle_id
  ) VALUES (
    v_original.aso_client_id, v_original.owner_id,
    v_original.amount, v_rev_type, v_original.payment_method,
    'completed', 'Reversal: ' || p_reason, p_owner_id,
    v_original.id, 'completed', v_original.cycle_id
  )
  RETURNING id INTO v_rev_net_id;

  v_reversal_ids := array_append(v_reversal_ids, v_rev_net_id);

  FOR v_fee_rows IN
    SELECT * FROM ajo_contributions
    WHERE fee_for_contribution_id = p_original_id AND status = 'completed'
  LOOP
    v_rev_fee_type := CASE v_fee_rows.type
      WHEN 'withdrawal_fee'    THEN 'reversal_withdrawal_fee'
      WHEN 'registration_fee'  THEN 'reversal_registration_fee'
      ELSE 'reversal_' || v_fee_rows.type
    END;

    DECLARE v_rev_fee_id UUID;
    BEGIN
      INSERT INTO ajo_contributions (
        aso_client_id, owner_id, amount, type, payment_method,
        status, notes, recorded_by,
        reverses_contribution_id, fee_for_contribution_id, paystack_status, cycle_id
      ) VALUES (
        v_fee_rows.aso_client_id, v_fee_rows.owner_id,
        v_fee_rows.amount, v_rev_fee_type, v_fee_rows.payment_method,
        'completed', 'Fee reversal: ' || p_reason, p_owner_id,
        v_fee_rows.id, v_rev_net_id, 'completed', v_fee_rows.cycle_id
      )
      RETURNING id INTO v_rev_fee_id;
      v_reversal_ids := array_append(v_reversal_ids, v_rev_fee_id);

      IF v_fee_rows.type = 'commission' AND v_fee_rows.cycle_id IS NOT NULL THEN
        UPDATE ajo_cycles SET commission_balance = 0 WHERE id = v_fee_rows.cycle_id;
      END IF;
    END;
  END LOOP;

  UPDATE aso_clients SET
    current_balance = COALESCE(current_balance, 0) + v_balance_delta,
    total_saved = CASE
      WHEN v_original.type = 'contribution'
        THEN GREATEST(0, COALESCE(total_saved, 0) - v_original.amount)
      ELSE total_saved
    END,
    total_withdrawn = CASE
      WHEN v_original.type = 'withdrawal'
        THEN GREATEST(0, COALESCE(total_withdrawn, 0) - v_original.amount)
      ELSE total_withdrawn
    END
  WHERE id = v_original.aso_client_id;

  RETURN jsonb_build_object(
    'ok',           true,
    'reversal_ids', v_reversal_ids,
    'new_balance',  COALESCE(v_client.current_balance, 0) + v_balance_delta
  );
END;
$$;

REVOKE ALL ON FUNCTION ajo_reverse_contribution(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION ajo_reverse_contribution(UUID, UUID, TEXT) TO service_role;
