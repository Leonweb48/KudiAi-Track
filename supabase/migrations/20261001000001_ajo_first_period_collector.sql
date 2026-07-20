-- ─────────────────────────────────────────────────────────────────────────────
-- Ajo first-period: immediate collector fee + full-balance withdrawal lock
-- ─────────────────────────────────────────────────────────────────────────────
-- Changes from 20260910000001_ajo_commission_balance:
--
--   1. ajo_approve_contribution:  take the collector's fee on the FIRST deposit
--      immediately, not accumulated across multiple deposits.
--      • commission_balance is set to expected_amount_per_period so the
--        "is fee settled?" check (commission_balance >= expected) remains valid.
--      • The contribution row's cycle_id is back-filled if it was NULL so every
--        deposit in a first_period cycle is properly attributed.
--
--   2. ajo_confirm_payment:  same change for the Paystack (online) path.
--
--   3. ajo_locked_cycle_amount:  when an active first_period cycle has its
--      collector's fee settled (commission_balance >= expected_amount_per_period),
--      lock the client's ENTIRE current_balance until the cycle closes.
--      The previous per-row SUM was unreliable when later deposits were tagged to
--      a different (e.g. percent) cycle and therefore escaped the lock.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. ajo_approve_contribution (cash / staff path) ───────────────────────────
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

  -- ── Collector's fee (first_period cycles, personal savings only) ─────────────
  -- The FIRST deposit to a first_period cycle goes entirely to the owner as the
  -- collector's fee.  We detect this by commission_balance = 0 (no fee taken yet).
  -- Subsequent deposits (commission_balance > 0) are free and go fully to savings.
  IF COALESCE(v_contrib.contribution_context, 'personal_savings') = 'personal_savings' THEN
    v_cycle_id := v_contrib.cycle_id;

    IF v_cycle_id IS NOT NULL THEN
      -- Verify the cycle is still active, first_period, and fee not yet taken
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
      -- Auto-detect: oldest active first_period cycle with no fee taken yet
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

      -- Back-fill cycle_id on the contribution row so it is attributed correctly
      IF v_cycle_id IS NOT NULL THEN
        UPDATE ajo_contributions SET cycle_id = v_cycle_id WHERE id = p_contribution_id;
      END IF;
    END IF;

    IF v_cycle_id IS NOT NULL THEN
      SELECT expected_amount_per_period, COALESCE(commission_balance, 0)
      INTO v_cycle_expected, v_commission_acc
      FROM ajo_cycles WHERE id = v_cycle_id;

      -- Net amount available from this deposit after the registration fee
      v_newly_acc := v_contrib.amount - v_reg_fee;

      -- Take the fee on the FIRST deposit only (commission_acc = 0 = never taken)
      IF v_commission_acc = 0 AND v_newly_acc > 0 THEN
        -- Fee = deposit net, capped at expected_amount_per_period.
        -- Any excess above the cap credits to savings below.
        v_cycle_fee := LEAST(v_newly_acc, v_cycle_expected);

        -- Set commission_balance = expected to signal "fee fully settled",
        -- regardless of whether the actual fee < expected (partial first deposit).
        UPDATE ajo_cycles SET commission_balance = v_cycle_expected WHERE id = v_cycle_id;

        INSERT INTO ajo_contributions (
          aso_client_id, owner_id, amount, type,
          payment_method, status, notes,
          fee_for_contribution_id, paystack_status, contribution_context, cycle_id
        ) VALUES (
          v_contrib.aso_client_id, v_contrib.owner_id, v_cycle_fee, 'commission',
          v_contrib.payment_method, 'completed', 'Collector''s fee — Day 1',
          p_contribution_id, 'completed', v_contrib.contribution_context, v_cycle_id
        )
        RETURNING id INTO v_commission_id;
      END IF;
      -- If commission_acc > 0: fee already taken on a previous deposit — no further fee.
    END IF;
  END IF;

  -- Net balance credit: full deposit minus reg fee minus collector's fee
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


-- ── 2. ajo_confirm_payment (Paystack online path) ─────────────────────────────
-- Same collector-fee-on-first-deposit logic as the cash path above.
-- No registration fee in this path.
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
  v_contrib        RECORD;
  v_client         RECORD;
  v_freq_days      INT;
  v_base_date      DATE;
  v_next_date      DATE;
  v_cycle_fee      NUMERIC := 0;
  v_cycle_id       UUID;
  v_commission_id  UUID;
  v_cycle_expected NUMERIC := 0;
  v_commission_acc NUMERIC := 0;
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

  -- Collector's fee on first deposit (Paystack path)
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
        UPDATE ajo_contributions SET cycle_id = v_cycle_id WHERE id = v_contrib.id;
      END IF;
    END IF;

    IF v_cycle_id IS NOT NULL THEN
      SELECT expected_amount_per_period, COALESCE(commission_balance, 0)
      INTO v_cycle_expected, v_commission_acc
      FROM ajo_cycles WHERE id = v_cycle_id;

      -- First deposit only: commission_balance = 0 means no fee taken yet
      IF v_commission_acc = 0 AND v_contrib.amount > 0 THEN
        v_cycle_fee := LEAST(v_contrib.amount, v_cycle_expected);
        UPDATE ajo_cycles SET commission_balance = v_cycle_expected WHERE id = v_cycle_id;
        INSERT INTO ajo_contributions (
          aso_client_id, owner_id, amount, type,
          payment_method, status, notes,
          fee_for_contribution_id, paystack_status, contribution_context, cycle_id
        ) VALUES (
          v_contrib.aso_client_id, v_contrib.owner_id, v_cycle_fee, 'commission',
          p_channel, 'completed', 'Collector''s fee — Day 1',
          v_contrib.id, 'completed',
          COALESCE(v_contrib.contribution_context, 'personal_savings'), v_cycle_id
        )
        RETURNING id INTO v_commission_id;
      END IF;
    END IF;
  END IF;

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
    'is_first_cycle', v_commission_id IS NOT NULL,
    'new_balance',    COALESCE(v_client.current_balance, 0) + v_contrib.amount - v_cycle_fee
  );
END;
$$;

REVOKE ALL ON FUNCTION ajo_confirm_payment(TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION ajo_confirm_payment(TEXT, TIMESTAMPTZ, TEXT) TO service_role;


-- ── 3. ajo_locked_cycle_amount — lock full balance during first_period cycles ──
-- Previous implementation: SUM contributions by cycle_id.  Unreliable because
-- deposits after Day 1 could be tagged to a different (e.g. percent) cycle if
-- that cycle was created first, leaving those deposits unlocked.
--
-- New implementation: if the client has ANY active first_period cycle whose
-- collector's fee is settled (commission_balance >= expected_amount_per_period),
-- the client's ENTIRE current_balance is locked until the cycle closes.
-- This matches the business rule: after the collector's Day 1 take, all
-- subsequent savings belong to the cycle and cannot be withdrawn early.
CREATE OR REPLACE FUNCTION public.ajo_locked_cycle_amount(p_client_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM ajo_cycles cy
      WHERE cy.client_id = p_client_id
        AND cy.status = 'active'
        AND cy.commission_model = 'first_period'
        AND cy.expected_amount_per_period > 0
        AND cy.commission_balance >= cy.expected_amount_per_period
    )
    THEN (SELECT COALESCE(current_balance, 0) FROM aso_clients WHERE id = p_client_id)
    ELSE 0
  END
$$;

REVOKE EXECUTE ON FUNCTION public.ajo_locked_cycle_amount(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ajo_locked_cycle_amount(UUID)
  TO service_role, authenticated;
