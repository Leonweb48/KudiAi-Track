-- Phase 3C: Esusu Rotation Engine
-- Adds group_mode to ajo_groups, new ajo_group_rounds / ajo_group_turns tables,
-- and 5 SECURITY DEFINER RPCs for round lifecycle management.

-- ── ajo_groups extensions ─────────────────────────────────────────────────
ALTER TABLE ajo_groups
  ADD COLUMN IF NOT EXISTS group_mode          TEXT NOT NULL DEFAULT 'savings'
    CHECK (group_mode IN ('savings', 'rotating')),
  ADD COLUMN IF NOT EXISTS privacy_show_names  BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS privacy_show_amounts BOOLEAN NOT NULL DEFAULT FALSE;

-- ── ajo_group_rounds ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ajo_group_rounds (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      UUID        NOT NULL REFERENCES ajo_groups(id) ON DELETE CASCADE,
  round_number  INT         NOT NULL DEFAULT 1,
  status        TEXT        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'completed', 'cancelled')),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ajo_group_rounds_group_status ON ajo_group_rounds(group_id, status);

-- ── ajo_group_turns ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ajo_group_turns (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id               UUID        NOT NULL REFERENCES ajo_group_rounds(id) ON DELETE CASCADE,
  group_id               UUID        NOT NULL REFERENCES ajo_groups(id)       ON DELETE CASCADE,
  position               INT         NOT NULL,
  client_id              UUID        NOT NULL REFERENCES aso_clients(id)      ON DELETE RESTRICT,
  expected_payout_date   DATE,
  period_start           TIMESTAMPTZ,
  payout_contribution_id UUID        REFERENCES ajo_contributions(id)         ON DELETE SET NULL,
  status                 TEXT        NOT NULL DEFAULT 'upcoming'
                                       CHECK (status IN ('upcoming', 'current', 'paid', 'skipped')),
  skip_reason            TEXT,
  skipped_at             TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX  IF NOT EXISTS ajo_group_turns_round_pos  ON ajo_group_turns(round_id, position);
CREATE INDEX  IF NOT EXISTS ajo_group_turns_client     ON ajo_group_turns(client_id);
-- Prevent double-pay: payout_contribution_id must be unique when set
CREATE UNIQUE INDEX IF NOT EXISTS ajo_group_turns_payout_unique
  ON ajo_group_turns(payout_contribution_id)
  WHERE payout_contribution_id IS NOT NULL;

-- ── ajo_reorder_log ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ajo_reorder_log (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id      UUID        NOT NULL REFERENCES ajo_group_rounds(id) ON DELETE CASCADE,
  owner_id      UUID        NOT NULL,
  changes_json  JSONB       NOT NULL DEFAULT '[]'::JSONB,
  reordered_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Disable RLS — all writes go through service_role RPCs
ALTER TABLE ajo_group_rounds DISABLE ROW LEVEL SECURITY;
ALTER TABLE ajo_group_turns  DISABLE ROW LEVEL SECURITY;
ALTER TABLE ajo_reorder_log  DISABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════════════════
-- RPC 1: ajo_start_round — create a new rotation round with ordered turns
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION ajo_start_round(
  p_group_id UUID,
  p_owner_id UUID,
  p_turns    JSONB   -- [{client_id, expected_payout_date}] ordered array
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_mode TEXT;
  v_round_id   UUID;
  v_round_num  INT;
  v_turn_elem  JSONB;
  v_pos        INT := 1;
  v_cid        UUID;
  v_date       DATE;
  v_len        INT;
  i            INT;
BEGIN
  -- Validate group exists and is owned by caller
  SELECT group_mode INTO v_group_mode
    FROM ajo_groups
    WHERE id = p_group_id AND owner_id = p_owner_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Group not found');
  END IF;
  IF v_group_mode <> 'rotating' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Group is not in rotating mode');
  END IF;

  -- No active round may exist
  IF EXISTS (
    SELECT 1 FROM ajo_group_rounds
    WHERE group_id = p_group_id AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'An active round already exists for this group');
  END IF;

  IF p_turns IS NULL OR jsonb_array_length(p_turns) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'At least one turn is required');
  END IF;

  -- Determine round number
  SELECT COALESCE(MAX(round_number), 0) + 1 INTO v_round_num
    FROM ajo_group_rounds WHERE group_id = p_group_id;

  -- Create round
  INSERT INTO ajo_group_rounds (group_id, round_number, status, started_at)
    VALUES (p_group_id, v_round_num, 'active', NOW())
    RETURNING id INTO v_round_id;

  -- Insert turns
  v_len := jsonb_array_length(p_turns);
  FOR i IN 0..v_len-1 LOOP
    v_turn_elem := p_turns->i;
    v_cid  := (v_turn_elem->>'client_id')::UUID;
    v_date := NULLIF(v_turn_elem->>'expected_payout_date', '')::DATE;

    -- Validate membership
    IF NOT EXISTS (
      SELECT 1 FROM aso_clients WHERE id = v_cid AND ajo_group_id = p_group_id
    ) THEN
      RAISE EXCEPTION 'Client % is not a member of group %', v_cid, p_group_id;
    END IF;

    INSERT INTO ajo_group_turns (
      round_id, group_id, position, client_id, expected_payout_date, period_start, status
    ) VALUES (
      v_round_id, p_group_id, v_pos, v_cid, v_date,
      CASE WHEN v_pos = 1 THEN NOW() ELSE NULL END,
      CASE WHEN v_pos = 1 THEN 'current' ELSE 'upcoming' END
    );

    v_pos := v_pos + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok',           true,
    'round_id',     v_round_id,
    'round_number', v_round_num,
    'turn_count',   v_len
  );
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- RPC 2: ajo_execute_payout — pay out the pot to the current turn member
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION ajo_execute_payout(
  p_turn_id  UUID,
  p_owner_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_turn         RECORD;
  v_round_status TEXT;
  v_group_owner  UUID;
  v_pot          NUMERIC(12,2);
  v_payout_id    UUID;
  v_next_id      UUID;
  v_member_ids   UUID[];
  v_client_name  TEXT;
  v_client_email TEXT;
  v_round_number INT;
BEGIN
  -- Get turn + client info
  SELECT t.*, c.full_name, c.email INTO v_turn
    FROM ajo_group_turns t
    JOIN aso_clients c ON c.id = t.client_id
    WHERE t.id = p_turn_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Turn not found');
  END IF;
  IF v_turn.status <> 'current' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Turn is not the current turn');
  END IF;
  IF v_turn.payout_contribution_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Payout already recorded for this turn');
  END IF;

  -- Validate round is active and owned by caller
  SELECT r.status, g.owner_id, r.round_number
    INTO v_round_status, v_group_owner, v_round_number
    FROM ajo_group_rounds r
    JOIN ajo_groups g ON g.id = r.group_id
    WHERE r.id = v_turn.round_id;

  IF NOT FOUND OR v_round_status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Round is not active');
  END IF;
  IF v_group_owner <> p_owner_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Access denied');
  END IF;

  -- Collect group member IDs for pot calculation
  SELECT ARRAY_AGG(id) INTO v_member_ids
    FROM aso_clients WHERE ajo_group_id = v_turn.group_id;

  -- Pot = sum of group members' contributions since this turn's period_start
  SELECT COALESCE(SUM(amount), 0) INTO v_pot
    FROM ajo_contributions
    WHERE aso_client_id = ANY(v_member_ids)
      AND type = 'contribution'
      AND status = 'completed'
      AND created_at >= v_turn.period_start;

  v_client_name  := v_turn.full_name;
  v_client_email := v_turn.email;

  -- Record payout entry for the beneficiary
  INSERT INTO ajo_contributions (
    aso_client_id, owner_id, amount, type, payment_method, status, notes
  ) VALUES (
    v_turn.client_id,
    p_owner_id,
    v_pot,
    'esusu_payout',
    'group_rotation',
    'completed',
    'Esusu pot payout — Round ' || v_round_number || ', Position ' || v_turn.position
  ) RETURNING id INTO v_payout_id;

  -- Mark turn paid
  UPDATE ajo_group_turns
    SET status = 'paid', payout_contribution_id = v_payout_id
    WHERE id = p_turn_id;

  -- Activate next upcoming turn
  SELECT id INTO v_next_id
    FROM ajo_group_turns
    WHERE round_id = v_turn.round_id AND status = 'upcoming'
    ORDER BY position ASC
    LIMIT 1;

  IF v_next_id IS NOT NULL THEN
    UPDATE ajo_group_turns
      SET status = 'current', period_start = NOW()
      WHERE id = v_next_id;
  END IF;

  RETURN jsonb_build_object(
    'ok',              true,
    'payout_id',       v_payout_id,
    'pot_amount',      v_pot,
    'beneficiary_name',  v_client_name,
    'beneficiary_email', v_client_email,
    'next_turn_id',    v_next_id,
    'round_complete',  (v_next_id IS NULL)
  );
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- RPC 3: ajo_skip_turn — skip a turn (move to end or remove)
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION ajo_skip_turn(
  p_turn_id     UUID,
  p_owner_id    UUID,
  p_reason      TEXT,
  p_move_to_end BOOLEAN DEFAULT TRUE
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_turn        RECORD;
  v_group_owner UUID;
  v_was_current BOOLEAN;
  v_max_pos     INT;
  v_next_id     UUID;
BEGIN
  -- Get turn + round status + group owner
  SELECT t.*, r.status AS round_status, g.owner_id AS group_owner INTO v_turn
    FROM ajo_group_turns t
    JOIN ajo_group_rounds r ON r.id = t.round_id
    JOIN ajo_groups g ON g.id = t.group_id
    WHERE t.id = p_turn_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Turn not found');
  END IF;
  IF v_turn.group_owner <> p_owner_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Access denied');
  END IF;
  IF v_turn.status = 'paid' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Turn is already paid');
  END IF;
  IF v_turn.status = 'skipped' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Turn is already skipped');
  END IF;

  v_was_current := (v_turn.status = 'current');

  IF p_move_to_end THEN
    SELECT COALESCE(MAX(position), 0) + 1 INTO v_max_pos
      FROM ajo_group_turns WHERE round_id = v_turn.round_id;
    UPDATE ajo_group_turns
      SET position     = v_max_pos,
          status       = 'upcoming',
          period_start = NULL,
          skip_reason  = p_reason,
          skipped_at   = NOW()
      WHERE id = p_turn_id;
  ELSE
    UPDATE ajo_group_turns
      SET status       = 'skipped',
          skip_reason  = p_reason,
          skipped_at   = NOW(),
          period_start = NULL
      WHERE id = p_turn_id;
  END IF;

  -- If it was the current turn, activate the next upcoming one
  IF v_was_current THEN
    SELECT id INTO v_next_id
      FROM ajo_group_turns
      WHERE round_id = v_turn.round_id AND status = 'upcoming'
      ORDER BY position ASC
      LIMIT 1;

    IF v_next_id IS NOT NULL THEN
      UPDATE ajo_group_turns
        SET status = 'current', period_start = NOW()
        WHERE id = v_next_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok',           true,
    'moved_to_end', p_move_to_end,
    'next_turn_id', v_next_id
  );
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- RPC 4: ajo_reorder_turns — reorder upcoming turns (logged)
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION ajo_reorder_turns(
  p_round_id  UUID,
  p_owner_id  UUID,
  p_new_order JSONB  -- [{turn_id, position}]
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_owner  UUID;
  v_round_status TEXT;
  v_elem         JSONB;
  v_turn_id      UUID;
  v_new_pos      INT;
  v_old_pos      INT;
  v_changes      JSONB := '[]'::JSONB;
  v_len          INT;
  i              INT;
BEGIN
  SELECT g.owner_id, r.status INTO v_group_owner, v_round_status
    FROM ajo_group_rounds r
    JOIN ajo_groups g ON g.id = r.group_id
    WHERE r.id = p_round_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Round not found');
  END IF;
  IF v_group_owner <> p_owner_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Access denied');
  END IF;
  IF v_round_status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Round is not active');
  END IF;

  v_len := jsonb_array_length(p_new_order);
  FOR i IN 0..v_len-1 LOOP
    v_elem    := p_new_order->i;
    v_turn_id := (v_elem->>'turn_id')::UUID;
    v_new_pos := (v_elem->>'position')::INT;

    -- Only upcoming turns may be reordered
    SELECT position INTO v_old_pos
      FROM ajo_group_turns
      WHERE id = v_turn_id AND round_id = p_round_id AND status = 'upcoming';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Turn % is not an upcoming turn in round %', v_turn_id, p_round_id;
    END IF;

    UPDATE ajo_group_turns SET position = v_new_pos WHERE id = v_turn_id;

    v_changes := v_changes || jsonb_build_array(
      jsonb_build_object('turn_id', v_turn_id, 'old_position', v_old_pos, 'new_position', v_new_pos)
    );
  END LOOP;

  -- Audit log
  INSERT INTO ajo_reorder_log (round_id, owner_id, changes_json)
    VALUES (p_round_id, p_owner_id, v_changes);

  RETURN jsonb_build_object('ok', true, 'changes', v_changes);
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- RPC 5: ajo_close_round — mark round completed; summary returned
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION ajo_close_round(
  p_round_id UUID,
  p_owner_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_owner  UUID;
  v_round_status TEXT;
  v_total_paid   NUMERIC(12,2);
  v_skip_count   BIGINT;
BEGIN
  SELECT g.owner_id, r.status INTO v_group_owner, v_round_status
    FROM ajo_group_rounds r
    JOIN ajo_groups g ON g.id = r.group_id
    WHERE r.id = p_round_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Round not found');
  END IF;
  IF v_group_owner <> p_owner_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Access denied');
  END IF;
  IF v_round_status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Round is not active');
  END IF;

  -- Summary stats before closing
  SELECT COALESCE(SUM(ac.amount), 0)
    INTO v_total_paid
    FROM ajo_group_turns t
    JOIN ajo_contributions ac ON ac.id = t.payout_contribution_id
    WHERE t.round_id = p_round_id AND t.status = 'paid';

  SELECT COUNT(*) INTO v_skip_count
    FROM ajo_group_turns
    WHERE round_id = p_round_id AND status = 'skipped';

  -- Close remaining open turns
  UPDATE ajo_group_turns
    SET status = 'skipped', skip_reason = 'Round closed by owner', skipped_at = NOW()
    WHERE round_id = p_round_id AND status IN ('upcoming', 'current');

  -- Mark round completed
  UPDATE ajo_group_rounds
    SET status = 'completed', completed_at = NOW()
    WHERE id = p_round_id;

  RETURN jsonb_build_object(
    'ok',            true,
    'total_paid',    v_total_paid,
    'skipped_count', v_skip_count
  );
END;
$$;

-- ── Grant RPCs to service_role only ──────────────────────────────────────
REVOKE EXECUTE ON FUNCTION ajo_start_round(UUID, UUID, JSONB)         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION ajo_execute_payout(UUID, UUID)             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION ajo_skip_turn(UUID, UUID, TEXT, BOOLEAN)   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION ajo_reorder_turns(UUID, UUID, JSONB)       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION ajo_close_round(UUID, UUID)                FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION ajo_start_round(UUID, UUID, JSONB)         TO service_role;
GRANT EXECUTE ON FUNCTION ajo_execute_payout(UUID, UUID)             TO service_role;
GRANT EXECUTE ON FUNCTION ajo_skip_turn(UUID, UUID, TEXT, BOOLEAN)   TO service_role;
GRANT EXECUTE ON FUNCTION ajo_reorder_turns(UUID, UUID, JSONB)       TO service_role;
GRANT EXECUTE ON FUNCTION ajo_close_round(UUID, UUID)                TO service_role;
