-- Esusu payout: hard gate — reject immediately if any member hasn't contributed.
-- Previously the RPC recorded debts and proceeded anyway. Now it blocks entirely
-- and returns the list of who's missing so the owner can chase them first.

DROP FUNCTION IF EXISTS ajo_execute_payout(UUID, UUID);

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
  v_group_id       UUID;
  v_pot            NUMERIC(12,2);
  v_payout_id      UUID;
  v_next_id        UUID;
  v_member_ids     UUID[];
  v_member_rec     RECORD;
  v_member_contrib NUMERIC(12,2);
  v_missing        JSONB := '[]'::JSONB;
  v_missing_count  INT   := 0;
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

  -- ── Hard gate: every member must have contributed their full amount ──────────
  FOR v_member_rec IN
    SELECT c.id, c.full_name, COALESCE(c.contribution_amount, 0) AS contribution_amount
    FROM aso_clients c WHERE c.ajo_group_id = v_group_id
  LOOP
    CONTINUE WHEN v_member_rec.contribution_amount <= 0;

    SELECT COALESCE(SUM(amount), 0) INTO v_member_contrib
      FROM ajo_contributions
      WHERE aso_client_id = v_member_rec.id
        AND type   = 'contribution'
        AND status = 'completed'
        AND created_at >= v_turn.period_start;

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
      'ok',             false,
      'blocked',        true,
      'error',          v_missing_count || ' member(s) have not completed their contribution for this period',
      'missing_count',  v_missing_count,
      'missing_contributors', v_missing
    );
  END IF;
  -- ── All members have contributed — proceed ────────────────────────────────

  SELECT ARRAY_AGG(id) INTO v_member_ids
    FROM aso_clients WHERE ajo_group_id = v_group_id;

  SELECT COALESCE(SUM(amount), 0) INTO v_pot
    FROM ajo_contributions
    WHERE aso_client_id = ANY(v_member_ids)
      AND type   = 'contribution'
      AND status = 'completed'
      AND created_at >= v_turn.period_start;

  INSERT INTO ajo_contributions (
    aso_client_id, owner_id, amount, type, payment_method, status, notes, paystack_status
  ) VALUES (
    v_turn.client_id, p_owner_id, v_pot, 'esusu_payout', 'group_rotation', 'completed',
    'Esusu pot payout — Round ' || v_round_number || ', Position ' || v_turn.position,
    'completed'
  ) RETURNING id INTO v_payout_id;

  UPDATE aso_clients SET
    current_balance = COALESCE(current_balance, 0) + v_pot,
    total_saved     = COALESCE(total_saved, 0)     + v_pot
  WHERE id = v_turn.client_id;

  UPDATE ajo_group_turns
    SET status = 'paid', payout_contribution_id = v_payout_id
    WHERE id = p_turn_id;

  SELECT id INTO v_next_id
    FROM ajo_group_turns
    WHERE round_id = v_turn.round_id AND status = 'upcoming'
    ORDER BY position ASC LIMIT 1;

  IF v_next_id IS NOT NULL THEN
    UPDATE ajo_group_turns SET status = 'current', period_start = NOW()
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
