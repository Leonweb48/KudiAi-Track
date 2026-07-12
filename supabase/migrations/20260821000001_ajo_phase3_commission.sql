-- Phase 3 Part B: collector commission.
-- Commission is computed and displayed (ledger-honest); it is never silently
-- deducted. Execution is an explicit, PIN-gated action at cycle settlement.

-- ── Schema additions ───────────────────────────────────────────────────────────

ALTER TABLE aso_clients
  ADD COLUMN IF NOT EXISTS commission_model   TEXT    NOT NULL DEFAULT 'none'
    CHECK (commission_model IN ('none', 'first_period', 'percent')),
  ADD COLUMN IF NOT EXISTS commission_percent NUMERIC(5,2)
    CHECK (commission_percent IS NULL OR (commission_percent > 0 AND commission_percent <= 100));

-- Snapshot commission into the cycle at open time (immutable thereafter)
ALTER TABLE ajo_cycles
  ADD COLUMN IF NOT EXISTS commission_model   TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS commission_percent NUMERIC(5,2);

-- Track which cycle a commission execution belongs to (optional but clean)
ALTER TABLE ajo_contributions
  ADD COLUMN IF NOT EXISTS cycle_id UUID REFERENCES ajo_cycles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ajo_contributions_cycle_idx ON ajo_contributions(cycle_id);

-- ── Replace ajo_open_cycle — now snapshots commission and detects conflict ──────

CREATE OR REPLACE FUNCTION ajo_open_cycle(
  p_client_id        UUID,
  p_owner_id         UUID,
  p_start            DATE    DEFAULT NULL,
  p_length           INT     DEFAULT NULL,
  p_amount           NUMERIC DEFAULT NULL,
  p_label            TEXT    DEFAULT NULL,
  p_commission_model TEXT    DEFAULT NULL,
  p_commission_pct   NUMERIC DEFAULT NULL,
  p_force            BOOLEAN DEFAULT FALSE
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

  IF EXISTS (SELECT 1 FROM ajo_cycles WHERE client_id = p_client_id AND status = 'active') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Client already has an active cycle');
  END IF;

  v_start  := COALESCE(p_start, v_client.registration_date, CURRENT_DATE);
  v_length := COALESCE(p_length,
    CASE v_client.contribution_frequency
      WHEN 'daily'   THEN 31
      WHEN 'weekly'  THEN 5
      WHEN 'monthly' THEN 12
      ELSE 31
    END);
  v_amount           := COALESCE(p_amount,            v_client.contribution_amount);
  v_commission_model := COALESCE(p_commission_model,  v_client.commission_model, 'none');
  v_commission_pct   := COALESCE(p_commission_pct,    v_client.commission_percent);

  IF v_amount IS NULL OR v_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Expected amount per period is required');
  END IF;

  -- Conflict check: first_period commission + registration_charge = double charge
  IF v_commission_model = 'first_period'
     AND (v_client.registration_charge IS NOT NULL AND v_client.registration_charge > 0)
     AND NOT p_force
  THEN
    RETURN jsonb_build_object(
      'ok',           false,
      'conflict',     'REG_FEE_AND_FIRST_PERIOD',
      'reg_charge',   v_client.registration_charge,
      'commission',   v_commission_model,
      'expected',     v_amount,
      'error',        'Double-charge conflict: first_period commission and registration_charge are both set'
    );
  END IF;

  INSERT INTO ajo_cycles
    (client_id, owner_id, start_date, length_periods, expected_amount_per_period,
     status, label, commission_model, commission_percent)
  VALUES
    (p_client_id, p_owner_id, v_start, v_length, v_amount,
     'active', p_label, v_commission_model, v_commission_pct)
  RETURNING id INTO v_cycle_id;

  RETURN jsonb_build_object(
    'ok',                        true,
    'cycle_id',                  v_cycle_id,
    'start_date',                v_start,
    'length_periods',            v_length,
    'expected_amount_per_period', v_amount,
    'commission_model',          v_commission_model,
    'commission_percent',        v_commission_pct
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION ajo_open_cycle(UUID, UUID, DATE, INT, NUMERIC, TEXT, TEXT, NUMERIC, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION ajo_open_cycle(UUID, UUID, DATE, INT, NUMERIC, TEXT, TEXT, NUMERIC, BOOLEAN)
  TO service_role;

-- Drop old signature if it exists (5-arg and 6-arg variants from Part A migration)
DROP FUNCTION IF EXISTS ajo_open_cycle(UUID, UUID, DATE, INT, NUMERIC, TEXT);

-- ── RPC: execute commission at settlement ─────────────────────────────────────
-- Creates a 'commission' ledger entry — deducts from client balance.
-- Idempotent: one commission entry per cycle.

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

  -- Idempotency: reject if a commission entry already exists for this cycle
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

  -- Deduct from client balance
  v_new_bal := COALESCE(v_client.current_balance, 0) - p_amount;
  UPDATE aso_clients SET current_balance = v_new_bal WHERE id = v_cycle.client_id;

  -- Insert ledger entry
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
