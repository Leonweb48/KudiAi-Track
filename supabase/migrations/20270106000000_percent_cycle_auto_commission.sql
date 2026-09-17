-- ═════════════════════════════════════════════════════════════════════════════
-- Percent-model Ajo cycles had NO automatic maturity trigger at all. The
-- capacity guard blocks further deposits once a cycle's target is reached,
-- but nothing ever flipped its status from 'active' to 'completed' — so the
-- only two things that can execute its commission (ajo_execute_commission,
-- staff-only; ajo_record_withdrawal's instant sweep) both require
-- status IN ('completed','settled') first, which previously only ever
-- happened via a staff member manually calling close_cycle. A client who
-- never explicitly withdraws could carry an indefinitely overstated
-- current_balance (the full uncollected commission) with no system-driven
-- correction, ever. By contrast, first_period cycles are safe by
-- construction — their maturity flip is gated on a commission row that
-- always already exists, inserted earlier in the same function call.
--
-- Fix: one new function, ajo_maybe_mature_percent_cycle, is the single
-- source of truth for "has this percent cycle hit its target, and if so,
-- execute its commission right now" — called from every contribution path
-- immediately after a deposit completes (so the fee executes the moment the
-- cycle's transaction stream completes, per the owner's request), from the
-- nightly maturity scan as a safety net (mirroring the exact dual-mechanism
-- first_period already relies on), and once here as a one-time backfill for
-- any cycle that's already sitting full today.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── ajo_maybe_mature_percent_cycle — single source of truth ──────────────────
CREATE OR REPLACE FUNCTION ajo_maybe_mature_percent_cycle(p_cycle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cycle   RECORD;
  v_saved   NUMERIC;
  v_target  NUMERIC;
  v_comm    NUMERIC;
  v_comm_id UUID;
  v_balance NUMERIC;
BEGIN
  IF p_cycle_id IS NULL THEN
    RETURN jsonb_build_object('matured', false);
  END IF;

  SELECT * INTO v_cycle FROM ajo_cycles WHERE id = p_cycle_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('matured', false);
  END IF;

  IF v_cycle.status <> 'active' OR v_cycle.commission_model <> 'percent' THEN
    RETURN jsonb_build_object('matured', false);
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_saved
  FROM ajo_contributions
  WHERE cycle_id = p_cycle_id AND type = 'contribution' AND status = 'completed';

  v_target := COALESCE(v_cycle.length_periods, 0) * COALESCE(v_cycle.expected_amount_per_period, 0);
  IF v_target <= 0 OR v_saved < v_target THEN
    RETURN jsonb_build_object('matured', false);
  END IF;

  -- Idempotency — mirrors every other commission-insert site. Never double-charge.
  IF EXISTS (
    SELECT 1 FROM ajo_contributions
    WHERE cycle_id = p_cycle_id AND type = 'commission' AND status = 'completed'
  ) THEN
    UPDATE ajo_cycles
    SET status     = 'completed',
        matured_at = COALESCE(matured_at, NOW()),
        closed_at  = COALESCE(closed_at, NOW())
    WHERE id = p_cycle_id;
    RETURN jsonb_build_object('matured', true, 'commission_amount', 0, 'already_commissioned', true);
  END IF;

  v_comm := ROUND(v_saved * COALESCE(v_cycle.commission_percent, 0) / 100, 2);

  -- Never drive current_balance negative — matches the guard
  -- ajo_record_withdrawal's own sweep already enforces. If the client has
  -- since withdrawn from elsewhere and can't currently cover it, defer:
  -- leave the cycle active, retry on the next nightly scan / next deposit /
  -- eventual withdrawal sweep, rather than force a negative balance now.
  SELECT current_balance INTO v_balance FROM aso_clients WHERE id = v_cycle.client_id FOR UPDATE;
  IF COALESCE(v_balance, 0) < v_comm THEN
    RETURN jsonb_build_object('matured', false, 'reason', 'insufficient_balance_deferred', 'commission_due', v_comm);
  END IF;

  IF v_comm > 0 THEN
    INSERT INTO ajo_contributions (
      aso_client_id, owner_id, amount, type,
      payment_method, status, notes, paystack_status,
      contribution_context, cycle_id
    ) VALUES (
      v_cycle.client_id, v_cycle.owner_id, v_comm, 'commission',
      'system', 'completed', 'Percent-model commission — cycle target reached', 'completed',
      'personal_savings', p_cycle_id
    )
    RETURNING id INTO v_comm_id;

    UPDATE aso_clients SET current_balance = COALESCE(current_balance, 0) - v_comm WHERE id = v_cycle.client_id;
  END IF;

  UPDATE ajo_cycles
  SET status = 'completed', matured_at = NOW(), closed_at = NOW()
  WHERE id = p_cycle_id;

  RETURN jsonb_build_object('matured', true, 'commission_amount', v_comm, 'commission_id', v_comm_id);
END;
$$;

REVOKE ALL ON FUNCTION ajo_maybe_mature_percent_cycle(UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION ajo_maybe_mature_percent_cycle(UUID) TO service_role;


-- ── ajo_approve_contribution — call site 1 ────────────────────────────────────
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
  -- capacity guard
  v_guard_cycle_id UUID;
  v_guard_cycle    RECORD;
  v_guard_sum      NUMERIC;
  v_guard_target   NUMERIC;
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

  -- ── Cycle-capacity guard (Layer 2) ────────────────────────────────────────
  v_guard_cycle_id := v_contrib.cycle_id;
  IF v_guard_cycle_id IS NOT NULL THEN
    SELECT * INTO v_guard_cycle FROM ajo_cycles WHERE id = v_guard_cycle_id;
    IF FOUND THEN
      IF v_guard_cycle.status IN ('completed', 'settled') THEN
        RETURN jsonb_build_object(
          'ok',    false,
          'error', format(
            'The savings cycle "%s" is already complete — this deposit cannot be approved.',
            COALESCE(v_guard_cycle.label, 'this cycle')
          )
        );
      END IF;

      SELECT COALESCE(SUM(amount), 0) INTO v_guard_sum
      FROM ajo_contributions
      WHERE cycle_id = v_guard_cycle_id
        AND type     = 'contribution'
        AND status   = 'completed';

      v_guard_target := v_guard_cycle.length_periods * v_guard_cycle.expected_amount_per_period;

      IF v_guard_sum >= v_guard_target THEN
        RETURN jsonb_build_object(
          'ok',    false,
          'error', format(
            'The savings cycle "%s" is full — ₦%s target already reached. This deposit cannot be approved.',
            COALESCE(v_guard_cycle.label, 'this cycle'),
            to_char(v_guard_target, 'FM999,999,990.00')
          )
        );
      END IF;
    END IF;
  END IF;
  -- ── End guard ──────────────────────────────────────────────────────────────

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
  IF v_cycle_id IS NULL THEN
    SELECT cycle_id INTO v_cycle_id
    FROM ajo_contributions WHERE id = p_contribution_id;
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

  -- Percent-model maturity — its own trigger, independent of the
  -- first_period-only block above. v_contrib.cycle_id (not v_cycle_id,
  -- which gets repurposed/cleared for first_period matching above) is the
  -- original, untouched cycle this contribution was actually made against.
  PERFORM ajo_maybe_mature_percent_cycle(v_contrib.cycle_id);

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


-- ── ajo_confirm_payment (Paystack) — call site 2 ──────────────────────────────
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
  -- capacity guard
  v_guard_cycle  RECORD;
  v_guard_sum    NUMERIC;
  v_guard_target NUMERIC;
BEGIN
  SELECT * INTO v_contrib
  FROM ajo_contributions
  WHERE paystack_ref = p_paystack_ref AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not found or already confirmed');
  END IF;

  -- ── Cycle-capacity guard (Layer 3) ────────────────────────────────────────
  IF v_contrib.cycle_id IS NOT NULL THEN
    SELECT * INTO v_guard_cycle FROM ajo_cycles WHERE id = v_contrib.cycle_id;
    IF FOUND THEN
      IF v_guard_cycle.status IN ('completed', 'settled') THEN
        RETURN jsonb_build_object(
          'ok',    false,
          'error', format(
            'The savings cycle "%s" is already complete — this Paystack payment cannot be credited. Contact support for a refund.',
            COALESCE(v_guard_cycle.label, 'this cycle')
          )
        );
      END IF;

      SELECT COALESCE(SUM(amount), 0) INTO v_guard_sum
      FROM ajo_contributions
      WHERE cycle_id = v_contrib.cycle_id
        AND type     = 'contribution'
        AND status   = 'completed';

      v_guard_target := v_guard_cycle.length_periods * v_guard_cycle.expected_amount_per_period;

      IF v_guard_sum >= v_guard_target THEN
        RETURN jsonb_build_object(
          'ok',    false,
          'error', format(
            'The savings cycle "%s" is full — ₦%s target already reached. This Paystack payment cannot be credited. Contact support for a refund.',
            COALESCE(v_guard_cycle.label, 'this cycle'),
            to_char(v_guard_target, 'FM999,999,990.00')
          )
        );
      END IF;
    END IF;
  END IF;
  -- ── End guard ──────────────────────────────────────────────────────────────

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

  -- Percent-model maturity — original cycle_id, not the first_period-scoped
  -- v_cycle_id which may have been cleared above.
  PERFORM ajo_maybe_mature_percent_cycle(v_contrib.cycle_id);

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


-- ── ajo_confirm_manual_deposit — call site 3 ──────────────────────────────────
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
  -- capacity guard
  v_guard_cycle_id UUID;
  v_guard_cycle    RECORD;
  v_guard_sum      NUMERIC;
  v_guard_target   NUMERIC;
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

  -- ── Cycle-capacity guard (Layer 4) ────────────────────────────────────────
  v_guard_cycle_id := v_claim.cycle_id;
  IF v_guard_cycle_id IS NOT NULL THEN
    SELECT * INTO v_guard_cycle FROM ajo_cycles WHERE id = v_guard_cycle_id;
    IF FOUND THEN
      IF v_guard_cycle.status IN ('completed', 'settled') THEN
        RETURN jsonb_build_object(
          'ok',    false,
          'error', format(
            'The savings cycle "%s" is already complete — this manual deposit cannot be confirmed.',
            COALESCE(v_guard_cycle.label, 'this cycle')
          )
        );
      END IF;

      SELECT COALESCE(SUM(amount), 0) INTO v_guard_sum
      FROM ajo_contributions
      WHERE cycle_id = v_guard_cycle_id
        AND type     = 'contribution'
        AND status   = 'completed';

      v_guard_target := v_guard_cycle.length_periods * v_guard_cycle.expected_amount_per_period;

      IF v_guard_sum >= v_guard_target THEN
        RETURN jsonb_build_object(
          'ok',    false,
          'error', format(
            'The savings cycle "%s" is full — ₦%s of ₦%s target reached. This manual deposit cannot be confirmed.',
            COALESCE(v_guard_cycle.label, 'this cycle'),
            to_char(v_guard_target, 'FM999,999,990.00')
          )
        );
      END IF;
    END IF;
  END IF;
  -- ── End guard ──────────────────────────────────────────────────────────────

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
      fee_for_contribution_id, paystack_status, initiated_by,
      contribution_context, cycle_id, group_id
    ) VALUES (
      v_claim.aso_client_id, v_claim.owner_id, v_reg_fee, 'registration_fee',
      'manual_transfer', 'completed', 'Registration fee on first deposit',
      p_claim_id, 'completed', 'staff',
      COALESCE(v_claim.contribution_context, 'personal_savings'), v_claim.cycle_id, v_claim.group_id
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

  -- Percent-model maturity — original claim cycle_id, not the
  -- first_period-scoped v_cycle_id which may have been cleared above.
  PERFORM ajo_maybe_mature_percent_cycle(v_claim.cycle_id);

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


-- ── wallet_pay_ajo_contribution — call site 4 ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.wallet_pay_ajo_contribution(p_aso_client_id uuid, p_amount_kobo bigint, p_contribution_context text DEFAULT 'personal_savings'::text, p_group_id uuid DEFAULT NULL::uuid, p_cycle_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid            UUID := auth.uid();
  v_client         RECORD;
  v_wallet         public.wallets;
  v_owner_wallet   public.wallets;
  v_new            BIGINT;
  v_owner_new      BIGINT;
  v_contrib_id     UUID;
  v_amount         NUMERIC;
  v_cycle_id       UUID := p_cycle_id;
  v_cycle_fee      NUMERIC := 0;
  v_commission_id  UUID;
  v_cycle_expected NUMERIC := 0;
  v_commission_acc NUMERIC := 0;
  v_freq_days      INT;
  v_base_date      DATE;
  v_next_date      DATE;
  v_guard_cycle    RECORD;
  v_guard_sum      NUMERIC;
  v_guard_target   NUMERIC;
  -- daily-free-transfer fee
  v_wfee           BIGINT;
  v_wfee_new       BIGINT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_amount_kobo IS NULL OR p_amount_kobo <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Enter an amount to contribute');
  END IF;

  SELECT * INTO v_client FROM public.aso_clients WHERE id = p_aso_client_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Client not found'); END IF;
  IF v_client.client_user_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Forbidden');
  END IF;

  v_amount := p_amount_kobo::numeric / 100;

  -- ── cycle-capacity guard — mirrors ajo_confirm_payment ────────────────────
  IF v_cycle_id IS NOT NULL THEN
    SELECT * INTO v_guard_cycle FROM public.ajo_cycles WHERE id = v_cycle_id;
    IF FOUND THEN
      IF v_guard_cycle.status IN ('completed', 'settled') THEN
        RETURN jsonb_build_object('ok', false, 'error', format(
          'The savings cycle "%s" is already complete.', COALESCE(v_guard_cycle.label, 'this cycle')));
      END IF;
      SELECT COALESCE(SUM(amount), 0) INTO v_guard_sum FROM public.ajo_contributions
       WHERE cycle_id = v_cycle_id AND type = 'contribution' AND status = 'completed';
      v_guard_target := v_guard_cycle.length_periods * v_guard_cycle.expected_amount_per_period;
      IF v_guard_target > 0 AND v_guard_sum >= v_guard_target THEN
        RETURN jsonb_build_object('ok', false, 'error', format(
          'The savings cycle "%s" is full — ₦%s target already reached.',
          COALESCE(v_guard_cycle.label, 'this cycle'), to_char(v_guard_target, 'FM999,999,990.00')));
      END IF;
    END IF;
  END IF;

  -- ── debit the client's own wallet ─────────────────────────────────────────
  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Activate your wallet first'); END IF;
  IF v_wallet.status <> 'active' THEN RETURN jsonb_build_object('ok', false, 'error', 'Wallet is not active'); END IF;
  IF v_wallet.balance_kobo < p_amount_kobo THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Insufficient wallet balance', 'code', 'insufficient_balance');
  END IF;

  PERFORM set_config('kudi.allow_wallet_write', '1', true);

  v_new := v_wallet.balance_kobo - p_amount_kobo;
  UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_wallet.id;

  -- ── credit the owner's wallet — real money, same collection account every
  --    client pays into by default. Provisioned if the owner somehow doesn't
  --    have one yet. ──
  SELECT * INTO v_owner_wallet FROM public.wallets WHERE user_id = v_client.user_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.wallets (user_id) VALUES (v_client.user_id)
    ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
    RETURNING * INTO v_owner_wallet;
  END IF;
  v_owner_new := v_owner_wallet.balance_kobo + p_amount_kobo;
  UPDATE public.wallets SET balance_kobo = v_owner_new WHERE id = v_owner_wallet.id;

  -- ── book the contribution ──────────────────────────────────────────────────
  INSERT INTO public.ajo_contributions (
    aso_client_id, owner_id, amount, type, payment_method, status,
    notes, contribution_context, cycle_id, group_id, initiated_by, paid_at,
    payment_channel
  ) VALUES (
    p_aso_client_id, v_client.user_id, v_amount, 'contribution', 'wallet', 'completed',
    'Paid from KudiAI Wallet', p_contribution_context, v_cycle_id,
    CASE WHEN p_contribution_context <> 'personal_savings' THEN p_group_id ELSE NULL END,
    'client', now(), 'wallet'
  ) RETURNING id INTO v_contrib_id;

  INSERT INTO public.wallet_ledger (
    wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
    source, status, reference, narration, related_txn_id
  ) VALUES (
    v_wallet.id, v_uid, 'debit', p_amount_kobo, v_new,
    'ajo_contribution', 'completed', v_contrib_id::text, 'Ajo contribution', v_contrib_id
  );

  INSERT INTO public.wallet_ledger (
    wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
    source, status, reference, narration, related_txn_id
  ) VALUES (
    v_owner_wallet.id, v_client.user_id, 'credit', p_amount_kobo, v_owner_new,
    'ajo_collection', 'completed', v_contrib_id::text,
    'Ajo contribution — ' || COALESCE(NULLIF(v_client.full_name, ''), 'a client'), v_contrib_id
  );

  -- ── daily-free-transfer wallet fee — first 3 qualifying transfers/day
  --    (shared with external transfers) are free; from the 4th, a flat ₦10
  --    (under ₦10,000) or ₦50 (at/above), booked as a platform 'wallet_fee'
  --    (not a real bank cost — this transfer never touches a bank). ──
  IF public.wallet_daily_transfer_count(v_uid) > 3 THEN
    v_wfee := public.wallet_transfer_fee_kobo(p_amount_kobo);
    IF v_wfee > 0 THEN
      SELECT * INTO v_wallet FROM public.wallets WHERE id = v_wallet.id FOR UPDATE;
      IF v_wallet.balance_kobo >= v_wfee THEN
        v_wfee_new := v_wallet.balance_kobo - v_wfee;
        UPDATE public.wallets SET balance_kobo = v_wfee_new WHERE id = v_wallet.id;
        INSERT INTO public.wallet_ledger (
          wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
          source, status, reference, narration, related_txn_id
        ) VALUES (
          v_wallet.id, v_uid, 'debit', v_wfee, v_wfee_new,
          'wallet_fee', 'completed', v_contrib_id::text,
          'Wallet transfer fee (daily free transfers used)', v_contrib_id
        );
        PERFORM public.wallet_credit_settlement(v_wfee, 'wallet_fee',
          'Wallet fee — contribution ' || v_contrib_id::text, v_contrib_id);
      END IF;
    END IF;
  END IF;

  -- ── first-period commission fee (personal_savings only) — mirrors ajo_confirm_payment ──
  IF p_contribution_context = 'personal_savings' AND v_cycle_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.ajo_cycles cy
      WHERE cy.id = v_cycle_id AND cy.status = 'active' AND cy.commission_model = 'first_period'
    ) OR EXISTS (
      SELECT 1 FROM public.ajo_contributions fc
      WHERE fc.cycle_id = v_cycle_id AND fc.type = 'commission' AND fc.status = 'completed'
    ) THEN
      v_cycle_id := NULL;
    END IF;

    IF v_cycle_id IS NOT NULL THEN
      SELECT expected_amount_per_period, COALESCE(commission_balance, 0)
      INTO v_cycle_expected, v_commission_acc
      FROM public.ajo_cycles WHERE id = v_cycle_id;

      IF v_commission_acc = 0 AND v_amount > 0 THEN
        v_cycle_fee := LEAST(v_amount, v_cycle_expected);
        UPDATE public.ajo_cycles SET commission_balance = v_cycle_expected WHERE id = v_cycle_id;
        INSERT INTO public.ajo_contributions (
          aso_client_id, owner_id, amount, type,
          payment_method, status, notes,
          fee_for_contribution_id, paystack_status, contribution_context, cycle_id
        ) VALUES (
          p_aso_client_id, v_client.user_id, v_cycle_fee, 'commission',
          'wallet', 'completed', 'Collector''s fee — Day 1',
          v_contrib_id, 'completed', p_contribution_context, v_cycle_id
        )
        RETURNING id INTO v_commission_id;
      END IF;
    END IF;
  END IF;

  -- ── update the client's savings tally ───────────────────────────────────────
  v_freq_days := CASE COALESCE(v_client.contribution_frequency, 'monthly')
    WHEN 'daily'  THEN 1
    WHEN 'weekly' THEN 7
    ELSE 30
  END;
  v_base_date := COALESCE(v_client.next_contribution_date, CURRENT_DATE);
  v_next_date := v_base_date + v_freq_days;

  UPDATE public.aso_clients SET
    current_balance        = COALESCE(current_balance, 0) + v_amount - v_cycle_fee,
    total_saved             = COALESCE(total_saved, 0)     + v_amount,
    next_contribution_date = v_next_date
  WHERE id = p_aso_client_id;

  -- Percent-model maturity — original p_cycle_id, not v_cycle_id which may
  -- have been cleared above for first_period matching.
  PERFORM ajo_maybe_mature_percent_cycle(p_cycle_id);

  RETURN jsonb_build_object(
    'ok',                 true,
    'contribution_id',    v_contrib_id,
    'amount',             v_amount,
    'cycle_fee',          v_cycle_fee,
    'commission_id',      v_commission_id,
    'new_wallet_balance', v_new,
    'new_client_balance', COALESCE(v_client.current_balance, 0) + v_amount - v_cycle_fee
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.wallet_pay_ajo_contribution(UUID, BIGINT, TEXT, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wallet_pay_ajo_contribution(UUID, BIGINT, TEXT, UUID, UUID) TO authenticated;


-- ── ajo_run_cycle_maturity_scan — nightly safety net, both models ────────────
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

  -- percent-model catch-all — no date/fee preconditions of its own;
  -- ajo_maybe_mature_percent_cycle applies its own target/balance checks.
  FOR v_cyc IN
    SELECT id FROM ajo_cycles WHERE status = 'active' AND commission_model = 'percent'
  LOOP
    PERFORM ajo_maybe_mature_percent_cycle(v_cyc.id);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION ajo_run_cycle_maturity_scan() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION ajo_run_cycle_maturity_scan() TO service_role;


-- ── One-time backfill: settle any percent cycle already sitting full today ──
DO $$
DECLARE
  v_cyc      RECORD;
  v_matured  INT := 0;
  v_deferred INT := 0;
  v_result   JSONB;
BEGIN
  FOR v_cyc IN SELECT id FROM ajo_cycles WHERE status = 'active' AND commission_model = 'percent' LOOP
    v_result := ajo_maybe_mature_percent_cycle(v_cyc.id);
    IF (v_result->>'matured')::boolean THEN
      v_matured := v_matured + 1;
    ELSIF v_result->>'reason' = 'insufficient_balance_deferred' THEN
      v_deferred := v_deferred + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'percent-cycle maturity backfill: % cycle(s) matured/commissioned, % deferred (insufficient balance, will retry nightly)', v_matured, v_deferred;
END $$;
