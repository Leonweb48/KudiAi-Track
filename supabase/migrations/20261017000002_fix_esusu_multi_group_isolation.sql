-- Fix: esusu multi-group isolation
--
-- Problems fixed:
-- 1. ajo_execute_payout had no group_id filter on any contribution query.
--    A member in two esusu groups had BOTH groups' contributions counted in the
--    gate check and pot, then swept together — emptying the wrong group's pot.
--
-- 2. esusu_pot_sweep and esusu_payout INSERT rows never set group_id,
--    so they couldn't be scoped per-group in future queries.
--
-- Fixes applied:
-- • All contribution queries in ajo_execute_payout now require group_id = v_group_id
-- • Both INSERT rows (sweep + payout) include group_id = v_group_id
-- • Backfill existing sweep/payout rows that have group_id IS NULL

-- ── 1. Backfill group_id on existing esusu sweep/payout rows ─────────────────
UPDATE ajo_contributions ac
SET group_id = (
  SELECT COALESCE(
    -- Prefer the membership junction table (most recently joined rotating group)
    (SELECT m.group_id
     FROM aso_client_group_memberships m
     JOIN ajo_groups g ON g.id = m.group_id
     WHERE m.client_id = ac.aso_client_id
       AND g.group_mode = 'rotating'
     ORDER BY m.joined_at ASC   -- oldest join = most likely the group the sweep belongs to
     LIMIT 1),
    -- Fallback to legacy ajo_group_id on the client row
    (SELECT c.ajo_group_id FROM aso_clients c WHERE c.id = ac.aso_client_id)
  )
)
WHERE ac.type IN ('esusu_pot_sweep', 'esusu_payout')
  AND ac.group_id IS NULL
  AND ac.contribution_context = 'esusu_rotation';

-- ── 2. Replace ajo_execute_payout with group_id-scoped queries ───────────────
CREATE OR REPLACE FUNCTION ajo_execute_payout(p_turn_id UUID, p_owner_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_turn           RECORD;
  v_round_status   TEXT;
  v_group_owner    UUID;
  v_round_number   INT;
  v_round_start    TIMESTAMPTZ;
  v_group_id       UUID;
  v_member_ids     UUID[];
  v_member_rec     RECORD;
  v_member_contrib NUMERIC(12,2);
  v_pot            NUMERIC(12,2) := 0;
  v_missing        JSONB := '[]'::JSONB;
  v_missing_count  INT   := 0;
  v_payout_id      UUID;
  v_next_id        UUID;
BEGIN
  SELECT t.*, c.full_name, c.email, c.contribution_amount
    INTO v_turn
    FROM ajo_group_turns t
    JOIN aso_clients c ON c.id = t.client_id
    WHERE t.id = p_turn_id
    FOR UPDATE OF t;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Turn not found');
  END IF;
  IF v_turn.status <> 'current' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Turn is not the current turn');
  END IF;
  IF v_turn.payout_contribution_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Payout already recorded for this turn');
  END IF;

  v_group_id := v_turn.group_id;

  SELECT r.status, g.owner_id, r.round_number, r.created_at
    INTO v_round_status, v_group_owner, v_round_number, v_round_start
    FROM ajo_group_rounds r
    JOIN ajo_groups g ON g.id = r.group_id
    WHERE r.id = v_turn.round_id;

  IF NOT FOUND OR v_round_status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Round is not active');
  END IF;
  IF v_group_owner <> p_owner_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Access denied');
  END IF;

  -- ── Membership: junction table + legacy ajo_group_id fallback ──────────────
  SELECT ARRAY_AGG(DISTINCT m.client_id) INTO v_member_ids
  FROM (
    SELECT client_id FROM aso_client_group_memberships
    WHERE group_id = v_group_id AND status = 'active'
    UNION
    SELECT id FROM aso_clients WHERE ajo_group_id = v_group_id
  ) m;

  IF v_member_ids IS NULL OR array_length(v_member_ids, 1) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No active members in group');
  END IF;

  -- ── Hard gate: net unswept per member for THIS group only ──────────────────
  -- group_id filter ensures a member in two esusu groups is only checked
  -- against contributions/sweeps for the group being paid out.
  FOR v_member_rec IN
    SELECT c.id, c.full_name, COALESCE(c.contribution_amount, 0) AS contribution_amount
    FROM aso_clients c
    WHERE c.id = ANY(v_member_ids)
  LOOP
    CONTINUE WHEN v_member_rec.contribution_amount <= 0;

    SELECT
      COALESCE(SUM(CASE WHEN type = 'contribution'    THEN amount ELSE 0 END), 0) -
      COALESCE(SUM(CASE WHEN type = 'esusu_pot_sweep' THEN amount ELSE 0 END), 0)
    INTO v_member_contrib
    FROM ajo_contributions
    WHERE aso_client_id        = v_member_rec.id
      AND contribution_context = 'esusu_rotation'
      AND group_id             = v_group_id        -- ← scope to this group only
      AND status               = 'completed'
      AND created_at           >= v_round_start;

    IF v_member_contrib < v_member_rec.contribution_amount THEN
      v_missing_count := v_missing_count + 1;
      v_missing := v_missing || jsonb_build_array(jsonb_build_object(
        'client_id',   v_member_rec.id,
        'client_name', v_member_rec.full_name,
        'amount_paid', v_member_contrib,
        'amount_due',  v_member_rec.contribution_amount,
        'shortfall',   v_member_rec.contribution_amount - v_member_contrib
      ));
    END IF;
  END LOOP;

  IF v_missing_count > 0 THEN
    RETURN jsonb_build_object(
      'ok',                    false,
      'blocked',               true,
      'error',                 v_missing_count || ' member(s) have not completed their esusu contribution for this period',
      'missing_count',         v_missing_count,
      'missing_contributors',  v_missing
    );
  END IF;

  -- ── Pot = net of THIS group's esusu contributions since round start ─────────
  SELECT
    COALESCE(SUM(CASE WHEN type = 'contribution'    THEN amount ELSE 0 END), 0) -
    COALESCE(SUM(CASE WHEN type = 'esusu_pot_sweep' THEN amount ELSE 0 END), 0)
  INTO v_pot
  FROM ajo_contributions
  WHERE aso_client_id        = ANY(v_member_ids)
    AND contribution_context = 'esusu_rotation'
    AND group_id             = v_group_id           -- ← scope to this group only
    AND status               = 'completed'
    AND created_at           >= v_round_start;

  IF v_pot <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pot is empty — no esusu contributions recorded for this period');
  END IF;

  -- ── Atomic sweep: debit each member's net for THIS group only ──────────────
  FOR v_member_rec IN
    SELECT c.id AS client_id, c.full_name,
           COALESCE(c.contribution_amount, 0) AS contribution_amount
    FROM aso_clients c
    WHERE c.id = ANY(v_member_ids)
  LOOP
    SELECT
      COALESCE(SUM(CASE WHEN type = 'contribution'    THEN amount ELSE 0 END), 0) -
      COALESCE(SUM(CASE WHEN type = 'esusu_pot_sweep' THEN amount ELSE 0 END), 0)
    INTO v_member_contrib
    FROM ajo_contributions
    WHERE aso_client_id        = v_member_rec.client_id
      AND contribution_context = 'esusu_rotation'
      AND group_id             = v_group_id          -- ← scope to this group only
      AND status               = 'completed'
      AND created_at           >= v_round_start;

    CONTINUE WHEN v_member_contrib <= 0;

    INSERT INTO ajo_contributions (
      aso_client_id, owner_id, amount, type,
      payment_method, status, contribution_context, group_id, notes, paystack_status
    ) VALUES (
      v_member_rec.client_id, p_owner_id, v_member_contrib, 'esusu_pot_sweep',
      'group_rotation', 'completed', 'esusu_rotation',
      v_group_id,                                    -- ← group_id recorded on sweep
      'Esusu pot sweep — Round ' || v_round_number || ', Turn ' || v_turn.position
        || ' (winner: ' || v_turn.full_name || ')',
      'completed'
    );

    UPDATE aso_clients
      SET current_balance = COALESCE(current_balance, 0) - v_member_contrib
      WHERE id = v_member_rec.client_id;
  END LOOP;

  -- ── Payout credit to winner — include group_id ─────────────────────────────
  INSERT INTO ajo_contributions (
    aso_client_id, owner_id, amount, type,
    payment_method, status, contribution_context, group_id, notes, paystack_status
  ) VALUES (
    v_turn.client_id, p_owner_id, v_pot, 'esusu_payout', 'group_rotation', 'completed',
    'esusu_rotation',
    v_group_id,                                      -- ← group_id recorded on payout
    'Esusu pot payout — Round ' || v_round_number || ', Position ' || v_turn.position,
    'completed'
  ) RETURNING id INTO v_payout_id;

  UPDATE aso_clients SET
    current_balance = COALESCE(current_balance, 0) + v_pot,
    total_saved     = COALESCE(total_saved, 0)     + v_pot
  WHERE id = v_turn.client_id;

  -- ── Mark turn paid; activate next upcoming turn ────────────────────────────
  UPDATE ajo_group_turns
    SET status = 'paid', payout_contribution_id = v_payout_id
    WHERE id = p_turn_id;

  SELECT id INTO v_next_id
    FROM ajo_group_turns
    WHERE round_id = v_turn.round_id AND status = 'upcoming'
    ORDER BY position ASC LIMIT 1;

  IF v_next_id IS NOT NULL THEN
    UPDATE ajo_group_turns
      SET status = 'current', period_start = NOW()
      WHERE id = v_next_id;
  END IF;

  RETURN jsonb_build_object(
    'ok',                    true,
    'payout_id',             v_payout_id,
    'pot_amount',            v_pot,
    'beneficiary_client_id', v_turn.client_id,
    'beneficiary_name',      v_turn.full_name,
    'beneficiary_email',     v_turn.email,
    'next_turn_id',          v_next_id,
    'round_complete',        (v_next_id IS NULL)
  );
END;
$$;

REVOKE ALL ON FUNCTION ajo_execute_payout(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION ajo_execute_payout(UUID, UUID) TO service_role;
