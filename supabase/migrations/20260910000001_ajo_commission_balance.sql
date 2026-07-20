-- ── Ajo first-period commission balance: partial accumulation across deposits ──
--
-- Problem: ajo_approve_contribution immediately inserts a completed commission row
-- for whatever net amount is available (deposit − reg_fee), regardless of whether
-- that amount meets the cycle's expected_amount_per_period. This marks period 0 as
-- "collector" prematurely and never carries the shortfall to the next deposit.
--
-- Fix (three changes):
--   1. Add commission_balance NUMERIC(12,2) to ajo_cycles to track accumulation.
--   2. Rewrite ajo_approve_contribution: accumulate commission_balance instead of
--      inserting the commission row until the full expected amount is reached.
--      When the threshold is met, insert one completed commission row for the full
--      expected_amount_per_period and credit any excess to current_balance.
--   3. Rewrite ajo_confirm_payment (Paystack path): same accumulation logic.
--   4. Rewrite ajo_locked_cycle_amount: return 0 while commission is still
--      accumulating (nothing is credited to current_balance during that phase),
--      and correctly net out registration_fee rows when commission is complete.


-- ── 1. New column ─────────────────────────────────────────────────────────────
ALTER TABLE ajo_cycles
  ADD COLUMN IF NOT EXISTS commission_balance NUMERIC(12,2) NOT NULL DEFAULT 0;


-- ── 2. ajo_approve_contribution (staff / owner cash path) ─────────────────────
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
  v_contrib         RECORD;
  v_client          RECORD;
  v_is_first        BOOLEAN;
  v_reg_fee         NUMERIC := 0;
  v_cycle_fee       NUMERIC := 0;
  v_net_add         NUMERIC;
  v_freq_days       INT;
  v_base_date       DATE;
  v_next_date       DATE;
  v_reg_fee_id      UUID;
  v_commission_id   UUID;
  v_cycle_id        UUID;
  v_cycle_expected  NUMERIC := 0;
  v_commission_acc  NUMERIC := 0;
  v_newly_acc       NUMERIC := 0;
  v_total_acc       NUMERIC := 0;
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

  -- ── first_period cycle fee ────────────────────────────────────────────────
  -- Accumulate in commission_balance until the full expected_amount_per_period
  -- is reached, then insert one completed commission row. Personal savings only.
  IF COALESCE(v_contrib.contribution_context, 'personal_savings') = 'personal_savings' THEN
    v_cycle_id := v_contrib.cycle_id;
    IF v_cycle_id IS NOT NULL THEN
      -- Explicit cycle on the row: must be active, first_period, fee not yet taken
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
      -- Auto-detect: oldest active first_period cycle with no completed commission yet
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
      SELECT expected_amount_per_period, COALESCE(commission_balance, 0)
      INTO v_cycle_expected, v_commission_acc
      FROM ajo_cycles WHERE id = v_cycle_id;

      -- Net amount from this deposit available toward the commission
      v_newly_acc := v_contrib.amount - v_reg_fee;

      IF v_newly_acc > 0 THEN
        v_total_acc := v_commission_acc + v_newly_acc;

        IF v_total_acc >= v_cycle_expected THEN
          -- Threshold met: take only the remaining amount needed; credit excess to savings
          v_cycle_fee := v_cycle_expected - v_commission_acc;
          UPDATE ajo_cycles SET commission_balance = v_cycle_expected WHERE id = v_cycle_id;
          INSERT INTO ajo_contributions (
            aso_client_id, owner_id, amount, type,
            payment_method, status, notes,
            fee_for_contribution_id, paystack_status, contribution_context, cycle_id
          ) VALUES (
            v_contrib.aso_client_id, v_contrib.owner_id, v_cycle_expected, 'commission',
            v_contrib.payment_method, 'completed', 'Cycle fee — period 1 complete',
            p_contribution_id, 'completed', v_contrib.contribution_context, v_cycle_id
          )
          RETURNING id INTO v_commission_id;
        ELSE
          -- Still accumulating: all net goes to the cycle; nothing credited to savings yet
          v_cycle_fee := v_newly_acc;
          UPDATE ajo_cycles SET commission_balance = v_total_acc WHERE id = v_cycle_id;
        END IF;
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
    'is_first_cycle',  v_commission_id IS NOT NULL,
    'new_balance',     COALESCE(v_client.current_balance, 0) + v_net_add,
    'next_date',       v_next_date
  );
END;
$$;

REVOKE ALL ON FUNCTION ajo_approve_contribution(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION ajo_approve_contribution(UUID, UUID, UUID) TO service_role;


-- ── 3. ajo_confirm_payment (Paystack online path) ─────────────────────────────
-- No registration fee in this path; full deposit amount accumulates toward the
-- first_period cycle fee using the same commission_balance tracking.
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
  v_contrib         RECORD;
  v_client          RECORD;
  v_freq_days       INT;
  v_base_date       DATE;
  v_next_date       DATE;
  v_cycle_fee       NUMERIC := 0;
  v_cycle_id        UUID;
  v_commission_id   UUID;
  v_cycle_expected  NUMERIC := 0;
  v_commission_acc  NUMERIC := 0;
  v_total_acc       NUMERIC := 0;
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

  -- first_period cycle fee: same accumulation logic as the cash path.
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
      SELECT expected_amount_per_period, COALESCE(commission_balance, 0)
      INTO v_cycle_expected, v_commission_acc
      FROM ajo_cycles WHERE id = v_cycle_id;

      v_total_acc := v_commission_acc + v_contrib.amount;

      IF v_total_acc >= v_cycle_expected THEN
        v_cycle_fee := v_cycle_expected - v_commission_acc;
        UPDATE ajo_cycles SET commission_balance = v_cycle_expected WHERE id = v_cycle_id;
        INSERT INTO ajo_contributions (
          aso_client_id, owner_id, amount, type,
          payment_method, status, notes,
          fee_for_contribution_id, paystack_status, contribution_context, cycle_id
        ) VALUES (
          v_contrib.aso_client_id, v_contrib.owner_id, v_cycle_expected, 'commission',
          p_channel, 'completed', 'Cycle fee — period 1 complete',
          v_contrib.id, 'completed',
          COALESCE(v_contrib.contribution_context, 'personal_savings'), v_cycle_id
        )
        RETURNING id INTO v_commission_id;
      ELSE
        v_cycle_fee := v_contrib.amount;
        UPDATE ajo_cycles SET commission_balance = v_total_acc WHERE id = v_cycle_id;
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


-- ── 4. ajo_locked_cycle_amount — corrected lock calculation ───────────────────
-- While commission is still accumulating (commission_balance < expected_amount_per_period),
-- nothing has been credited to current_balance, so there is nothing to lock.
-- Once commission is complete, the lock = contributions − commission − registration_fee
-- rows, which equals the actual excess credited to current_balance.
CREATE OR REPLACE FUNCTION public.ajo_locked_cycle_amount(p_client_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    SUM(
      CASE
        WHEN cy.commission_balance >= cy.expected_amount_per_period THEN
          -- Commission complete: only the net excess is in current_balance
          CASE c.type
            WHEN 'contribution'    THEN  c.amount
            WHEN 'commission'      THEN -c.amount
            WHEN 'registration_fee' THEN -c.amount
            ELSE 0
          END
        ELSE
          -- Still accumulating: nothing credited to current_balance yet
          0
      END
    ),
    0
  )
  FROM ajo_contributions c
  JOIN ajo_cycles cy ON cy.id = c.cycle_id
  WHERE c.aso_client_id = p_client_id
    AND c.status = 'completed'
    AND c.type IN ('contribution', 'commission', 'registration_fee')
    AND cy.status = 'active'
    AND cy.commission_model = 'first_period';
$$;

REVOKE EXECUTE ON FUNCTION public.ajo_locked_cycle_amount(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ajo_locked_cycle_amount(UUID)
  TO service_role, authenticated;
