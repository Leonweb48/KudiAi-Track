-- ─────────────────────────────────────────────────────────────────────────────
-- First-period savings cycle lifecycle
--
-- active → completed (matured, lock lifts automatically)
--        → settled   (fully withdrawn, archived)
--
-- Maturity fires two ways:
--   A) Immediately: ajo_approve_contribution / ajo_confirm_manual_deposit detect
--      count(completed contributions for cycle) >= length_periods AND fee settled.
--   B) Nightly: ajo_run_cycle_maturity_scan() catches date-based maturity at 01:05 UTC.
--
-- Auto-close fires in ajo_record_withdrawal: if the attributed cycle is 'completed'
-- and its net balance drops to zero after a withdrawal → flip to 'settled'.
--
-- Lock is unchanged: ajo_locked_cycle_amount already filters cy.status = 'active',
-- so once a cycle becomes 'completed' the lock lifts with no balance write.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Maturity timestamp column
ALTER TABLE ajo_cycles ADD COLUMN IF NOT EXISTS matured_at TIMESTAMPTZ;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Net balance helper
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION ajo_cycle_net_balance(p_cycle_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(COALESCE(SUM(
    CASE type
      WHEN 'contribution'              THEN  amount
      WHEN 'commission'                THEN -amount
      WHEN 'registration_fee'          THEN -amount
      WHEN 'withdrawal'                THEN -amount
      WHEN 'withdrawal_fee'            THEN -amount
      WHEN 'reversal_contribution'     THEN -amount
      WHEN 'reversal_commission'       THEN  amount
      WHEN 'reversal_registration_fee' THEN  amount
      WHEN 'reversal_withdrawal'       THEN  amount
      WHEN 'reversal_withdrawal_fee'   THEN  amount
      ELSE 0
    END
  ), 0), 0)
  FROM  ajo_contributions
  WHERE cycle_id = p_cycle_id
    AND status   = 'completed'
$$;

REVOKE ALL ON FUNCTION ajo_cycle_net_balance(UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION ajo_cycle_net_balance(UUID) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ajo_approve_contribution  (overrides 20261015000002)
--    Additions vs prior version:
--      • DECLARE: v_contrib_count, v_cycle_just_matured, v_matured_label,
--                 v_matured_net_balance, v_cyc_mat
--      • After aso_clients UPDATE: maturity check block
--      • RETURN: cycle_just_matured, matured_cycle_id, matured_cycle_label,
--                matured_net_balance
-- ─────────────────────────────────────────────────────────────────────────────
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
  v_contrib             RECORD;
  v_client              RECORD;
  v_is_first            BOOLEAN;
  v_reg_fee             NUMERIC := 0;
  v_cycle_fee           NUMERIC := 0;
  v_net_add             NUMERIC;
  v_freq_days           INT;
  v_base_date           DATE;
  v_next_date           DATE;
  v_reg_fee_id          UUID;
  v_commission_id       UUID;
  v_cycle_id            UUID;
  v_cycle_expected      NUMERIC := 0;
  v_commission_acc      NUMERIC := 0;
  v_newly_acc           NUMERIC := 0;
  -- lifecycle additions
  v_contrib_count       INT;
  v_cycle_just_matured  BOOLEAN := false;
  v_matured_label       TEXT;
  v_matured_net_balance NUMERIC := 0;
  v_cyc_mat             RECORD;
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

  -- ── Maturity check: does this contribution complete the cycle? ────────────
  -- Re-resolve v_cycle_id: after commission insertion it may now have a value
  -- even when the contribution row's cycle_id was NULL on entry. But the
  -- commission guard above already nulled it if the fee was already settled,
  -- so we need to look at the contribution's current cycle_id for the maturity
  -- count. Use the latest cycle_id from the contribution row.
  IF v_cycle_id IS NULL THEN
    SELECT cycle_id INTO v_cycle_id
    FROM ajo_contributions WHERE id = p_contribution_id;
  END IF;

  IF v_cycle_id IS NOT NULL THEN
    SELECT length_periods, label, status
    INTO v_cyc_mat
    FROM ajo_cycles WHERE id = v_cycle_id;

    IF FOUND AND v_cyc_mat.status = 'active' THEN
      -- Fee must be settled (commission row exists OR commission_balance >= expected)
      IF EXISTS (
        SELECT 1 FROM ajo_contributions
        WHERE cycle_id = v_cycle_id AND type = 'commission' AND status = 'completed'
      ) THEN
        SELECT COUNT(*) INTO v_contrib_count
        FROM ajo_contributions
        WHERE cycle_id = v_cycle_id AND type = 'contribution' AND status = 'completed';

        IF v_contrib_count >= v_cyc_mat.length_periods THEN
          v_matured_net_balance := ajo_cycle_net_balance(v_cycle_id);
          UPDATE ajo_cycles
          SET status     = 'completed',
              matured_at = NOW(),
              closed_at  = NOW()
          WHERE id = v_cycle_id;
          v_cycle_just_matured := true;
          v_matured_label      := v_cyc_mat.label;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok',                  true,
    'contribution_id',     p_contribution_id,
    'client_id',           v_contrib.aso_client_id,
    'amount',              v_contrib.amount,
    'reg_fee',             v_reg_fee,
    'reg_fee_id',          v_reg_fee_id,
    'cycle_fee',           v_cycle_fee,
    'commission_id',       v_commission_id,
    'is_first_cycle',      v_commission_id IS NOT NULL,
    'new_balance',         COALESCE(v_client.current_balance, 0) + v_net_add,
    'next_date',           v_next_date,
    'cycle_just_matured',  v_cycle_just_matured,
    'matured_cycle_id',    v_cycle_id,
    'matured_cycle_label', v_matured_label,
    'matured_net_balance', v_matured_net_balance
  );
END;
$$;

REVOKE ALL ON FUNCTION ajo_approve_contribution(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION ajo_approve_contribution(UUID, UUID, UUID) TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. ajo_confirm_manual_deposit  (overrides 20261015000002)
--    Same maturity additions as ajo_approve_contribution above.
-- ─────────────────────────────────────────────────────────────────────────────
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
  v_claim               RECORD;
  v_client              RECORD;
  v_is_first            BOOLEAN;
  v_reg_fee             NUMERIC := 0;
  v_cycle_fee           NUMERIC := 0;
  v_net_add             NUMERIC;
  v_freq_days           INT;
  v_base_date           DATE;
  v_next_date           DATE;
  v_reg_fee_id          UUID;
  v_commission_id       UUID;
  v_cycle_id            UUID;
  v_cycle_expected      NUMERIC := 0;
  v_commission_acc      NUMERIC := 0;
  v_newly_acc           NUMERIC := 0;
  -- lifecycle additions
  v_contrib_count       INT;
  v_cycle_just_matured  BOOLEAN := false;
  v_matured_label       TEXT;
  v_matured_net_balance NUMERIC := 0;
  v_cyc_mat             RECORD;
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

  -- ── Maturity check ────────────────────────────────────────────────────────
  IF v_cycle_id IS NULL THEN
    SELECT cycle_id INTO v_cycle_id
    FROM ajo_contributions WHERE id = p_claim_id;
  END IF;

  IF v_cycle_id IS NOT NULL THEN
    SELECT length_periods, label, status
    INTO v_cyc_mat
    FROM ajo_cycles WHERE id = v_cycle_id;

    IF FOUND AND v_cyc_mat.status = 'active' THEN
      IF EXISTS (
        SELECT 1 FROM ajo_contributions
        WHERE cycle_id = v_cycle_id AND type = 'commission' AND status = 'completed'
      ) THEN
        SELECT COUNT(*) INTO v_contrib_count
        FROM ajo_contributions
        WHERE cycle_id = v_cycle_id AND type = 'contribution' AND status = 'completed';

        IF v_contrib_count >= v_cyc_mat.length_periods THEN
          v_matured_net_balance := ajo_cycle_net_balance(v_cycle_id);
          UPDATE ajo_cycles
          SET status     = 'completed',
              matured_at = NOW(),
              closed_at  = NOW()
          WHERE id = v_cycle_id;
          v_cycle_just_matured := true;
          v_matured_label      := v_cyc_mat.label;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok',                  true,
    'claim_id',            p_claim_id,
    'client_id',           v_claim.aso_client_id,
    'amount',              v_claim.amount,
    'reg_fee',             v_reg_fee,
    'reg_fee_id',          v_reg_fee_id,
    'cycle_fee',           v_cycle_fee,
    'commission_id',       v_commission_id,
    'is_first_cycle',      v_commission_id IS NOT NULL,
    'new_balance',         COALESCE(v_client.current_balance, 0) + v_net_add,
    'next_date',           v_next_date,
    'cycle_just_matured',  v_cycle_just_matured,
    'matured_cycle_id',    v_cycle_id,
    'matured_cycle_label', v_matured_label,
    'matured_net_balance', v_matured_net_balance
  );
END;
$$;

REVOKE ALL ON FUNCTION ajo_confirm_manual_deposit(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION ajo_confirm_manual_deposit(UUID, UUID, UUID) TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. ajo_record_withdrawal  (overrides 20261015000001)
--    Additions vs prior version:
--      • DECLARE: v_cycle_just_closed, v_closed_label, v_cyc_close
--      • After aso_clients UPDATE: auto-close check for completed cycles
--      • RETURN: cycle_just_closed, closed_cycle_id, closed_cycle_label
-- ─────────────────────────────────────────────────────────────────────────────
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
  v_client            RECORD;
  v_esusu_locked      NUMERIC;
  v_cycle_locked      NUMERIC;
  v_group_locked      NUMERIC;
  v_withdrawable      NUMERIC;
  v_pct_fee           NUMERIC;
  v_fee_amount        NUMERIC;
  v_net_amount        NUMERIC;
  v_net_id            UUID;
  v_fee_id            UUID;
  v_lock_msg          TEXT;
  v_lock_parts        TEXT[];
  v_attr_cycle_id     UUID;
  v_attr_group_id     UUID;
  -- lifecycle additions
  v_cycle_just_closed BOOLEAN := false;
  v_closed_label      TEXT;
  v_cyc_close         RECORD;
  v_cycle_net_bal     NUMERIC;
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

  -- ── Auto-close: if the attributed cycle is 'completed' and now empty ─────
  IF v_attr_cycle_id IS NOT NULL THEN
    SELECT status, label INTO v_cyc_close
    FROM ajo_cycles WHERE id = v_attr_cycle_id;

    IF FOUND AND v_cyc_close.status = 'completed' THEN
      v_cycle_net_bal := ajo_cycle_net_balance(v_attr_cycle_id);
      IF v_cycle_net_bal < 0.01 THEN
        UPDATE ajo_cycles
        SET status = 'settled'
        WHERE id = v_attr_cycle_id;
        v_cycle_just_closed := true;
        v_closed_label      := v_cyc_close.label;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok',                true,
    'net_id',            v_net_id,
    'fee_id',            v_fee_id,
    'fee_amount',        v_fee_amount,
    'net_amount',        v_net_amount,
    'gross_amount',      p_gross_amount,
    'new_balance',       COALESCE(v_client.current_balance, 0) - p_gross_amount,
    'cycle_just_closed', v_cycle_just_closed,
    'closed_cycle_id',   v_attr_cycle_id,
    'closed_cycle_label', v_closed_label
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ajo_record_withdrawal(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ajo_record_withdrawal(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, UUID, UUID, UUID)
  TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Nightly maturity scan
--    Catches cycles whose date-based maturity has passed but that were never
--    driven to completion by an approve_contribution call (e.g. a client paid
--    outside the system, or the contribution count fell behind due to reversals).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION ajo_run_cycle_maturity_scan()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cyc       RECORD;
  v_freq_days INT;
BEGIN
  FOR v_cyc IN
    SELECT cy.id, cy.length_periods, cy.label, cy.start_date,
           cy.commission_model, cy.commission_balance,
           cy.expected_amount_per_period,
           ac.contribution_frequency
    FROM   ajo_cycles cy
    JOIN   aso_clients ac ON ac.id = cy.client_id
    WHERE  cy.status = 'active'
      AND  cy.commission_model = 'first_period'
      AND  cy.start_date IS NOT NULL
      AND  cy.length_periods IS NOT NULL
  LOOP
    v_freq_days := CASE COALESCE(v_cyc.contribution_frequency, 'monthly')
      WHEN 'daily'  THEN 1
      WHEN 'weekly' THEN 7
      ELSE 30
    END;

    -- Date-based maturity: cycle should have ended by now
    IF CURRENT_DATE < v_cyc.start_date + (v_cyc.length_periods * v_freq_days) THEN
      CONTINUE;
    END IF;

    -- Fee must be settled
    IF NOT EXISTS (
      SELECT 1 FROM ajo_contributions
      WHERE cycle_id = v_cyc.id AND type = 'commission' AND status = 'completed'
    ) THEN
      CONTINUE;
    END IF;

    UPDATE ajo_cycles
    SET status     = 'completed',
        matured_at = NOW(),
        closed_at  = NOW()
    WHERE id = v_cyc.id AND status = 'active';
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION ajo_run_cycle_maturity_scan() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION ajo_run_cycle_maturity_scan() TO service_role;

-- Schedule nightly scan at 01:05 UTC (02:05 WAT) — 5 min after reconciliation
SELECT cron.schedule(
  'ajo-cycle-maturity',
  '5 1 * * *',
  'SELECT ajo_run_cycle_maturity_scan()'
);
