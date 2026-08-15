-- ─────────────────────────────────────────────────────────────────────────────
-- Cycle capacity guard: once a cycle's contribution target is met, all four
-- deposit paths (record_contribution, approve_contribution, confirm_payment,
-- confirm_manual_deposit) reject further deposits with a clear message.
--
-- Prior behaviour: the first_period maturity check fired AFTER crediting the
-- balance and only for first_period cycles.  none/percent cycles had no
-- automatic gate at all.
--
-- New enforcement layers:
--   Layer 1 — ajo_record_contribution:   blocks the pending row from being
--     created (Paystack URL never returned, manual claim never opened,
--     staff/owner record never created).
--   Layer 2 — ajo_approve_contribution:  blocks approval of any pending row
--     that would credit into a full or already-completed cycle (race-condition
--     safety — e.g. two staff records submitted concurrently).
--   Layer 3 — ajo_confirm_payment:       blocks Paystack webhook from crediting
--     a payment into a full/completed cycle.  The pending row is left in
--     'pending' state so the owner can issue a Paystack refund.
--   Layer 4 — ajo_confirm_manual_deposit: same as layer 3 for manual transfers.
--
-- Cycle-full condition: total amount of 'completed' contributions for cycle_id
-- >= length_periods × expected_amount_per_period.
-- Also blocks if cycle.status is already 'completed' or 'settled'.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─────────────────────────────────────────────────────────────────────────────
-- Layer 1: ajo_record_contribution  (overrides 20261002000000)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION ajo_record_contribution(
  p_client_id            UUID,
  p_owner_id             UUID,
  p_amount               NUMERIC,
  p_method               TEXT    DEFAULT 'cash',
  p_ref                  TEXT    DEFAULT NULL,
  p_notes                TEXT    DEFAULT NULL,
  p_recorded_by          UUID    DEFAULT NULL,
  p_contribution_context TEXT    DEFAULT 'personal_savings',
  p_source               TEXT    DEFAULT NULL,
  p_cycle_id             UUID    DEFAULT NULL,
  p_group_id             UUID    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client          RECORD;
  v_contribution_id UUID;
  v_guard_cycle     RECORD;
  v_guard_sum       NUMERIC;
  v_guard_target    NUMERIC;
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

  -- ── Cycle-capacity guard (Layer 1) ────────────────────────────────────────
  IF p_cycle_id IS NOT NULL THEN
    SELECT * INTO v_guard_cycle FROM ajo_cycles WHERE id = p_cycle_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Savings cycle not found');
    END IF;

    IF v_guard_cycle.status IN ('completed', 'settled') THEN
      RETURN jsonb_build_object(
        'ok',    false,
        'error', format(
          'The savings cycle "%s" is already complete — no further deposits are accepted. Open a new cycle to continue.',
          COALESCE(v_guard_cycle.label, 'this cycle')
        )
      );
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_guard_sum
    FROM ajo_contributions
    WHERE cycle_id = p_cycle_id
      AND type     = 'contribution'
      AND status   = 'completed';

    v_guard_target := v_guard_cycle.length_periods * v_guard_cycle.expected_amount_per_period;

    IF v_guard_sum >= v_guard_target THEN
      RETURN jsonb_build_object(
        'ok',    false,
        'error', format(
          'The savings cycle "%s" is full — ₦%s of ₦%s target reached. Open a new cycle to continue saving.',
          COALESCE(v_guard_cycle.label, 'this cycle'),
          to_char(v_guard_sum,    'FM999,999,990.00'),
          to_char(v_guard_target, 'FM999,999,990.00')
        )
      );
    END IF;
  END IF;
  -- ── End guard ──────────────────────────────────────────────────────────────

  INSERT INTO ajo_contributions (
    aso_client_id, owner_id, amount, type,
    payment_method, paystack_ref, status, notes,
    recorded_by, paystack_status, contribution_context, contribution_source,
    cycle_id, group_id
  ) VALUES (
    p_client_id, p_owner_id, p_amount, 'contribution',
    p_method, p_ref, 'pending', p_notes,
    p_recorded_by, 'pending', p_contribution_context, p_source,
    p_cycle_id, p_group_id
  )
  RETURNING id INTO v_contribution_id;

  RETURN jsonb_build_object(
    'ok',              true,
    'contribution_id', v_contribution_id,
    'status',          'pending'
  );
END;
$$;

REVOKE ALL ON FUNCTION ajo_record_contribution(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ajo_record_contribution(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, UUID, UUID)
  TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- Layer 2: ajo_approve_contribution  (overrides 20261026000001)
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
  -- Run before any balance write. v_contrib.cycle_id may be NULL for
  -- unlinked contributions — guard only fires when cycle is present.
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
-- Layer 3: ajo_confirm_payment  (overrides 20261001000001)
-- The pending row was already created by ajo_record_contribution (Layer 1
-- guards the init step).  This layer blocks the rare race where two Paystack
-- payments were initiated before either was confirmed — the second webhook
-- call cannot credit a full cycle.  The pending row stays 'pending' so the
-- owner can issue a refund via the admin portal.
-- ─────────────────────────────────────────────────────────────────────────────
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


-- ─────────────────────────────────────────────────────────────────────────────
-- Layer 4: ajo_confirm_manual_deposit  (overrides 20261026000001)
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
            'The savings cycle "%s" is full — ₦%s target already reached. This manual deposit cannot be confirmed.',
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


INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  '20261104000002',
  'ajo_cycle_capacity_guard',
  ARRAY[
    'CREATE OR REPLACE FUNCTION ajo_record_contribution(...)',
    'CREATE OR REPLACE FUNCTION ajo_approve_contribution(...)',
    'CREATE OR REPLACE FUNCTION ajo_confirm_payment(...)',
    'CREATE OR REPLACE FUNCTION ajo_confirm_manual_deposit(...)'
  ]
)
ON CONFLICT (version) DO NOTHING;
