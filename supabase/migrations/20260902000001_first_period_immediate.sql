-- first_period mechanic — immediate cycle-fee collection (day-1 belongs to the collector)
-- Supersedes settlement-time framing; folded into Part A build 2026-07-18.
--
-- Changes:
--   1. ajo_open_cycle — conflict guard downgraded from block to informational notice
--   2. ajo_record_contribution — add p_cycle_id param; store on pending row
--   3. ajo_approve_contribution — first_period cycle fee at approval time
--   4. ajo_confirm_payment — first_period cycle fee at Paystack confirmation
--   5. ajo_execute_commission — block on first_period cycles (auto-collected already)

-- ── 1. ajo_open_cycle — non-blocking conflict notice ─────────────────────────
-- Was: returns {ok:false, conflict:'REG_FEE_AND_FIRST_PERIOD'} when both are set.
-- Now: always opens; returns {ok:true, …, conflict_notice:'REG_FEE_AND_FIRST_PERIOD'}
--      when applicable so the owner can display an informational message.

DROP FUNCTION IF EXISTS ajo_open_cycle(UUID, UUID, DATE, INT, NUMERIC, TEXT, TEXT, NUMERIC, BOOLEAN);

CREATE OR REPLACE FUNCTION ajo_open_cycle(
  p_client_id        UUID,
  p_owner_id         UUID,
  p_start            DATE    DEFAULT NULL,
  p_length           INT     DEFAULT NULL,
  p_amount           NUMERIC DEFAULT NULL,
  p_label            TEXT    DEFAULT NULL,
  p_commission_model TEXT    DEFAULT NULL,
  p_commission_pct   NUMERIC DEFAULT NULL,
  p_force            BOOLEAN DEFAULT FALSE   -- kept for call-site compatibility; no longer changes behaviour
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_client            aso_clients%ROWTYPE;
  v_start             DATE;
  v_length            INT;
  v_amount            NUMERIC;
  v_commission_model  TEXT;
  v_commission_pct    NUMERIC;
  v_cycle_id          UUID;
  v_conflict_notice   TEXT := NULL;
BEGIN
  SELECT * INTO v_client FROM aso_clients WHERE id = p_client_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Client not found');
  END IF;
  IF v_client.user_id != p_owner_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized');
  END IF;
  IF v_client.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Client is archived');
  END IF;

  v_start  := COALESCE(p_start, v_client.registration_date, CURRENT_DATE);
  v_length := COALESCE(p_length,
    CASE v_client.contribution_frequency
      WHEN 'daily'   THEN 31
      WHEN 'weekly'  THEN 5
      WHEN 'monthly' THEN 12
      ELSE 31
    END);
  v_amount           := COALESCE(p_amount,           v_client.contribution_amount);
  v_commission_model := COALESCE(p_commission_model, v_client.commission_model, 'none');
  v_commission_pct   := COALESCE(p_commission_pct,   v_client.commission_percent);

  IF v_amount IS NULL OR v_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Expected amount per period is required');
  END IF;

  -- Informational notice: both first_period + reg_charge set means first deposit carries both
  IF v_commission_model = 'first_period'
     AND COALESCE(v_client.registration_charge, 0) > 0
  THEN
    v_conflict_notice := 'REG_FEE_AND_FIRST_PERIOD';
  END IF;

  INSERT INTO ajo_cycles
    (client_id, owner_id, start_date, length_periods, expected_amount_per_period,
     status, label, commission_model, commission_percent)
  VALUES
    (p_client_id, p_owner_id, v_start, v_length, v_amount,
     'active', p_label, v_commission_model, v_commission_pct)
  RETURNING id INTO v_cycle_id;

  RETURN jsonb_build_object(
    'ok',                         true,
    'cycle_id',                   v_cycle_id,
    'start_date',                 v_start,
    'length_periods',             v_length,
    'expected_amount_per_period', v_amount,
    'commission_model',           v_commission_model,
    'commission_percent',         v_commission_pct,
    'conflict_notice',            v_conflict_notice
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION ajo_open_cycle(UUID, UUID, DATE, INT, NUMERIC, TEXT, TEXT, NUMERIC, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION ajo_open_cycle(UUID, UUID, DATE, INT, NUMERIC, TEXT, TEXT, NUMERIC, BOOLEAN)
  TO service_role;


-- ── 2. ajo_record_contribution — add p_cycle_id, store on pending row ─────────

DROP FUNCTION IF EXISTS ajo_record_contribution(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, UUID, TEXT, TEXT);

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
  p_cycle_id             UUID    DEFAULT NULL
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

  -- Insert as pending; balance credit and first_period cycle fee happen on approval.
  INSERT INTO ajo_contributions (
    aso_client_id, owner_id, amount, type,
    payment_method, paystack_ref, status, notes,
    recorded_by, paystack_status, contribution_context, contribution_source, cycle_id
  ) VALUES (
    p_client_id, p_owner_id, p_amount, 'contribution',
    p_method, p_ref, 'pending', p_notes,
    p_recorded_by, 'pending', p_contribution_context, p_source, p_cycle_id
  )
  RETURNING id INTO v_contribution_id;

  RETURN jsonb_build_object(
    'ok',              true,
    'contribution_id', v_contribution_id,
    'status',          'pending'
  );
END;
$$;

REVOKE ALL ON FUNCTION ajo_record_contribution(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ajo_record_contribution(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, UUID)
  TO service_role;


-- ── 3. ajo_approve_contribution — first_period cycle fee at approval ───────────

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

  -- Registration fee: first-ever deposit only
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

  -- first_period: collect cycle fee on the first contribution of each active cycle
  IF v_client.commission_model = 'first_period'
     AND v_contrib.contribution_context = 'personal_savings'
  THEN
    -- Use cycle_id stored on the pending row, or auto-detect
    v_cycle_id := v_contrib.cycle_id;
    IF v_cycle_id IS NOT NULL THEN
      -- Verify this cycle hasn't already had its fee collected
      IF EXISTS (
        SELECT 1 FROM ajo_contributions
        WHERE cycle_id = v_cycle_id AND type = 'commission' AND status = 'completed'
      ) THEN
        v_cycle_id := NULL;
      END IF;
    ELSE
      -- Auto-detect: oldest active cycle with no commission row yet
      SELECT c.id INTO v_cycle_id
      FROM ajo_cycles c
      WHERE c.client_id = v_contrib.aso_client_id AND c.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM ajo_contributions fc
          WHERE fc.cycle_id = c.id AND fc.type = 'commission' AND fc.status = 'completed'
        )
      ORDER BY c.created_at ASC
      LIMIT 1;
    END IF;

    IF v_cycle_id IS NOT NULL THEN
      -- Cycle fee = deposit minus reg fee (the net portion that would normally go to savings)
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


-- ── 4. ajo_confirm_payment — first_period cycle fee at Paystack confirmation ───

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

  -- first_period: collect cycle fee if this is the first contribution of an active cycle
  IF v_client.commission_model = 'first_period'
     AND COALESCE(v_contrib.contribution_context, 'personal_savings') = 'personal_savings'
  THEN
    v_cycle_id := v_contrib.cycle_id;
    IF v_cycle_id IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM ajo_contributions
        WHERE cycle_id = v_cycle_id AND type = 'commission' AND status = 'completed'
      ) THEN
        v_cycle_id := NULL;
      END IF;
    ELSE
      SELECT c.id INTO v_cycle_id
      FROM ajo_cycles c
      WHERE c.client_id = v_contrib.aso_client_id AND c.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM ajo_contributions fc
          WHERE fc.cycle_id = c.id AND fc.type = 'commission' AND fc.status = 'completed'
        )
      ORDER BY c.created_at ASC
      LIMIT 1;
    END IF;

    IF v_cycle_id IS NOT NULL THEN
      -- Paystack path: no reg fee is collected here; full amount → collector
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

  -- Credit balance: contribution amount minus cycle fee (0 for first_period first deposit)
  UPDATE aso_clients SET
    current_balance        = COALESCE(current_balance, 0) + v_contrib.amount - v_cycle_fee,
    total_saved            = COALESCE(total_saved, 0)     + v_contrib.amount,
    next_contribution_date = v_next_date
  WHERE id = v_contrib.aso_client_id;

  RETURN jsonb_build_object(
    'ok',            true,
    'client_id',     v_contrib.aso_client_id,
    'amount',        v_contrib.amount,
    'cycle_fee',     v_cycle_fee,
    'commission_id', v_commission_id,
    'is_first_cycle', v_cycle_id IS NOT NULL AND v_cycle_fee > 0,
    'new_balance',   COALESCE(v_client.current_balance, 0) + v_contrib.amount - v_cycle_fee
  );
END;
$$;

REVOKE ALL ON FUNCTION ajo_confirm_payment(TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION ajo_confirm_payment(TEXT, TIMESTAMPTZ, TEXT) TO service_role;


-- ── 5. ajo_execute_commission — block on first_period cycles ──────────────────
-- first_period commission is collected automatically at first deposit;
-- manual execution via this RPC is not needed and would double-count.

CREATE OR REPLACE FUNCTION ajo_execute_commission(
  p_cycle_id UUID,
  p_owner_id UUID,
  p_amount   NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cycle     ajo_cycles%ROWTYPE;
  v_client    aso_clients%ROWTYPE;
  v_entry_id  UUID;
  v_new_bal   NUMERIC;
BEGIN
  SELECT * INTO v_cycle FROM ajo_cycles WHERE id = p_cycle_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Cycle not found');
  END IF;
  IF v_cycle.owner_id != p_owner_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized');
  END IF;
  IF v_cycle.status NOT IN ('completed', 'settled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Commission can only be executed on a completed or settled cycle');
  END IF;
  IF v_cycle.commission_model = 'none' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This cycle has no commission configured');
  END IF;
  -- first_period: auto-collected at first deposit — manual execution is not applicable
  IF v_cycle.commission_model = 'first_period' THEN
    RETURN jsonb_build_object(
      'ok',    false,
      'error', 'first_period commission is collected automatically at the client''s first deposit — no manual execution needed'
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM ajo_contributions
    WHERE cycle_id = p_cycle_id AND type = 'commission'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Commission already executed for this cycle');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Commission amount must be greater than zero');
  END IF;

  SELECT * INTO v_client FROM aso_clients WHERE id = v_cycle.client_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Client not found');
  END IF;

  v_new_bal := COALESCE(v_client.current_balance, 0) - p_amount;
  UPDATE aso_clients SET current_balance = v_new_bal WHERE id = v_cycle.client_id;

  INSERT INTO ajo_contributions
    (aso_client_id, owner_id, amount, type, status, payment_method, notes, cycle_id)
  VALUES
    (v_cycle.client_id, p_owner_id, p_amount, 'commission', 'completed', 'commission',
     'Cycle commission', p_cycle_id)
  RETURNING id INTO v_entry_id;

  RETURN jsonb_build_object(
    'ok',           true,
    'entry_id',     v_entry_id,
    'amount',       p_amount,
    'balance_after', v_new_bal
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION ajo_execute_commission(UUID, UUID, NUMERIC)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION ajo_execute_commission(UUID, UUID, NUMERIC)
  TO service_role;
