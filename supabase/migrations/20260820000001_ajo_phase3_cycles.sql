-- Phase 3 Part A: per-client contribution cycles (digital card).
-- Each client has at most one active cycle at a time.
-- The card view is a pure computation over ajo_contributions + cycle definition;
-- no separate "box state" table exists.

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ajo_cycles (
  id                         UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                  UUID          NOT NULL REFERENCES aso_clients(id) ON DELETE CASCADE,
  owner_id                   UUID          NOT NULL,
  start_date                 DATE          NOT NULL,
  length_periods             INT           NOT NULL CHECK (length_periods > 0),
  expected_amount_per_period NUMERIC(12,2) NOT NULL CHECK (expected_amount_per_period > 0),
  status                     TEXT          NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active', 'completed', 'settled')),
  label                      TEXT,
  closed_at                  TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Enforce one active cycle per client
CREATE UNIQUE INDEX IF NOT EXISTS ajo_cycles_one_active
  ON ajo_cycles (client_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS ajo_cycles_owner_idx
  ON ajo_cycles (owner_id, status);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE ajo_cycles ENABLE ROW LEVEL SECURITY;

CREATE POLICY ajo_cycles_owner_select ON ajo_cycles
  FOR SELECT USING (owner_id = auth.uid());

-- ── RPC: open a cycle ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ajo_open_cycle(
  p_client_id UUID,
  p_owner_id  UUID,
  p_start     DATE    DEFAULT NULL,
  p_length    INT     DEFAULT NULL,
  p_amount    NUMERIC DEFAULT NULL,
  p_label     TEXT    DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_client   aso_clients%ROWTYPE;
  v_start    DATE;
  v_length   INT;
  v_amount   NUMERIC;
  v_cycle_id UUID;
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
  v_amount := COALESCE(p_amount, v_client.contribution_amount);

  IF v_amount IS NULL OR v_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Expected amount per period is required');
  END IF;

  INSERT INTO ajo_cycles
    (client_id, owner_id, start_date, length_periods, expected_amount_per_period, status, label)
  VALUES
    (p_client_id, p_owner_id, v_start, v_length, v_amount, 'active', p_label)
  RETURNING id INTO v_cycle_id;

  RETURN jsonb_build_object(
    'ok',                        true,
    'cycle_id',                  v_cycle_id,
    'start_date',                v_start,
    'length_periods',            v_length,
    'expected_amount_per_period', v_amount
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION ajo_open_cycle(UUID, UUID, DATE, INT, NUMERIC, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION ajo_open_cycle(UUID, UUID, DATE, INT, NUMERIC, TEXT)
  TO service_role;

-- ── RPC: close a cycle ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ajo_close_cycle(
  p_cycle_id UUID,
  p_owner_id UUID,
  p_status   TEXT DEFAULT 'completed'
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cycle ajo_cycles%ROWTYPE;
BEGIN
  SELECT * INTO v_cycle FROM ajo_cycles WHERE id = p_cycle_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Cycle not found');
  END IF;
  IF v_cycle.owner_id != p_owner_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized');
  END IF;
  IF v_cycle.status != 'active' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Cycle is not active');
  END IF;
  IF p_status NOT IN ('completed', 'settled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid status');
  END IF;

  UPDATE ajo_cycles
    SET status = p_status, closed_at = NOW()
  WHERE id = p_cycle_id;

  RETURN jsonb_build_object('ok', true, 'cycle_id', p_cycle_id, 'status', p_status);
END;
$$;

REVOKE EXECUTE ON FUNCTION ajo_close_cycle(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION ajo_close_cycle(UUID, UUID, TEXT)
  TO service_role;
