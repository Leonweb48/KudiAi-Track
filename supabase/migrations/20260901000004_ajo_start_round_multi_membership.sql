-- ajo_start_round previously validated membership via aso_clients.ajo_group_id only.
-- With multi-membership, clients join groups via aso_client_group_memberships.
-- Update the membership check to accept either path.
CREATE OR REPLACE FUNCTION ajo_start_round(
  p_group_id UUID,
  p_owner_id UUID,
  p_turns    JSONB
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
  SELECT group_mode INTO v_group_mode
    FROM ajo_groups
    WHERE id = p_group_id AND owner_id = p_owner_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Group not found');
  END IF;
  IF v_group_mode <> 'rotating' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Group is not in rotating mode');
  END IF;

  IF EXISTS (
    SELECT 1 FROM ajo_group_rounds
    WHERE group_id = p_group_id AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'An active round already exists for this group');
  END IF;

  IF p_turns IS NULL OR jsonb_array_length(p_turns) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'At least one turn is required');
  END IF;

  SELECT COALESCE(MAX(round_number), 0) + 1 INTO v_round_num
    FROM ajo_group_rounds WHERE group_id = p_group_id;

  INSERT INTO ajo_group_rounds (group_id, round_number, status, started_at)
    VALUES (p_group_id, v_round_num, 'active', NOW())
    RETURNING id INTO v_round_id;

  v_len := jsonb_array_length(p_turns);
  FOR i IN 0..v_len-1 LOOP
    v_turn_elem := p_turns->i;
    v_cid  := (v_turn_elem->>'client_id')::UUID;
    v_date := NULLIF(v_turn_elem->>'expected_payout_date', '')::DATE;

    -- Accept membership via junction table OR legacy ajo_group_id column
    IF NOT EXISTS (
      SELECT 1 FROM aso_client_group_memberships
        WHERE client_id = v_cid AND group_id = p_group_id AND status = 'active'
    ) AND NOT EXISTS (
      SELECT 1 FROM aso_clients
        WHERE id = v_cid AND ajo_group_id = p_group_id
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
