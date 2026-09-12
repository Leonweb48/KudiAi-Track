-- Multi-winner Esusu rotation: an owner can configure N members to be paid
-- simultaneously each rotation period (instead of exactly 1), plus a custom
-- "every N days" contribution frequency option on ajo_groups.
--
-- payout_slots_per_round lives on ajo_group_rounds (not ajo_groups) because the
-- owner can only sensibly pick "winners per round" vs "amount per winner" once
-- the actual member count is known — which is exactly the moment ajo_start_round
-- is called. Rounds are never edited after creation, so this sidesteps any
-- "can this change mid-round" question entirely.
--
-- Also bundles two independent fixes surfaced while touching this code:
--   1. ajo_skip_turn's initial read gets a row lock (FOR UPDATE OF t), closing a
--      pre-existing race where a concurrent ajo_execute_payout could commit a
--      payout on a turn that skip_turn then blindly overwrote back to 'upcoming'.
--   2. A fairness guard on permanent turn removal (skip with move_to_end=false):
--      it must not leave a remaining turn count that doesn't divide evenly by
--      the round's payout_slots_per_round, since that would let a shrunk tail
--      batch's lone winner collect the whole pot instead of their fair share.

-- ── Schema ───────────────────────────────────────────────────────────────────

ALTER TABLE ajo_groups DROP CONSTRAINT IF EXISTS ajo_groups_contribution_frequency_check;
ALTER TABLE ajo_groups ADD CONSTRAINT ajo_groups_contribution_frequency_check
  CHECK (contribution_frequency = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text, 'custom'::text]));

ALTER TABLE ajo_groups ADD COLUMN IF NOT EXISTS custom_interval_days INT;

ALTER TABLE ajo_groups DROP CONSTRAINT IF EXISTS ajo_groups_custom_interval_days_check;
ALTER TABLE ajo_groups ADD CONSTRAINT ajo_groups_custom_interval_days_check
  CHECK (custom_interval_days IS NULL OR custom_interval_days > 0);

ALTER TABLE ajo_groups DROP CONSTRAINT IF EXISTS ajo_groups_custom_frequency_requires_days;
ALTER TABLE ajo_groups ADD CONSTRAINT ajo_groups_custom_frequency_requires_days
  CHECK (contribution_frequency <> 'custom' OR custom_interval_days IS NOT NULL);

ALTER TABLE ajo_group_rounds ADD COLUMN IF NOT EXISTS payout_slots_per_round INT NOT NULL DEFAULT 1;

ALTER TABLE ajo_group_rounds DROP CONSTRAINT IF EXISTS ajo_group_rounds_payout_slots_check;
ALTER TABLE ajo_group_rounds ADD CONSTRAINT ajo_group_rounds_payout_slots_check
  CHECK (payout_slots_per_round >= 1);

-- ── ajo_start_round: accept + validate payout_slots_per_round ───────────────

CREATE OR REPLACE FUNCTION public.ajo_start_round(
  p_group_id uuid, p_owner_id uuid, p_turns jsonb, p_payout_slots_per_round INT DEFAULT 1
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_group_mode TEXT;
  v_round_id   UUID;
  v_round_num  INT;
  v_turn_elem  JSONB;
  v_pos        INT := 1;
  v_cid        UUID;
  v_date       DATE;
  v_len        INT;
  v_distinct   INT;
  v_slots      INT;
  i            INT;
BEGIN
  v_slots := COALESCE(p_payout_slots_per_round, 1);
  IF v_slots < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payout_slots_per_round must be at least 1');
  END IF;

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

  v_len := jsonb_array_length(p_turns);

  SELECT COUNT(DISTINCT (elem->>'client_id')) INTO v_distinct
    FROM jsonb_array_elements(p_turns) AS elem;
  IF v_distinct <> v_len THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Duplicate client_id in turns — each member may only hold one position');
  END IF;

  IF v_len % v_slots <> 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', format('Member count (%s) must be an exact multiple of winners-per-round (%s)', v_len, v_slots)
    );
  END IF;

  SELECT COALESCE(MAX(round_number), 0) + 1 INTO v_round_num
    FROM ajo_group_rounds WHERE group_id = p_group_id;

  INSERT INTO ajo_group_rounds (group_id, round_number, status, started_at, payout_slots_per_round)
    VALUES (p_group_id, v_round_num, 'active', NOW(), v_slots)
    RETURNING id INTO v_round_id;

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
      CASE WHEN v_pos <= v_slots THEN NOW() ELSE NULL END,
      CASE WHEN v_pos <= v_slots THEN 'current' ELSE 'upcoming' END
    );

    v_pos := v_pos + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok',                    true,
    'round_id',               v_round_id,
    'round_number',           v_round_num,
    'turn_count',             v_len,
    'payout_slots_per_round', v_slots
  );
END;
$function$;

-- ── ajo_execute_payout: pay the whole current batch, split evenly ──────────

CREATE OR REPLACE FUNCTION public.ajo_execute_payout(p_turn_id uuid, p_owner_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_anchor         RECORD;
  v_round_status   TEXT;
  v_group_owner    UUID;
  v_round_number   INT;
  v_round_start    TIMESTAMPTZ;
  v_group_id       UUID;
  v_round_id       UUID;
  v_slots          INT;
  v_member_ids     UUID[];
  v_member_rec     RECORD;
  v_member_contrib NUMERIC(12,2);
  v_pot            NUMERIC(12,2) := 0;
  v_missing        JSONB := '[]'::JSONB;
  v_missing_count  INT   := 0;
  v_next_ids       UUID[] := '{}';
  v_next_id        UUID;
  v_batch_turn_ids UUID[]   := '{}';
  v_batch_client   UUID[]   := '{}';
  v_batch_pos      INT[]    := '{}';
  v_batch_name     TEXT[]   := '{}';
  v_batch_email    TEXT[]   := '{}';
  v_slot_count     INT;
  v_per_winner     NUMERIC(12,2);
  v_remainder      NUMERIC(12,2);
  v_amount         NUMERIC(12,2);
  v_payout_id      UUID;
  v_beneficiaries  JSONB := '[]'::JSONB;
  v_t              RECORD;
  j                INT;
BEGIN
  -- Resolve the round/group from the given (any current) turn id — identification only, no lock yet.
  SELECT t.round_id, t.group_id, t.status
    INTO v_anchor
    FROM ajo_group_turns t
    WHERE t.id = p_turn_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Turn not found');
  END IF;
  IF v_anchor.status <> 'current' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Turn is not the current turn');
  END IF;

  v_round_id := v_anchor.round_id;
  v_group_id := v_anchor.group_id;

  SELECT r.status, g.owner_id, r.round_number, r.created_at, r.payout_slots_per_round
    INTO v_round_status, v_group_owner, v_round_number, v_round_start, v_slots
    FROM ajo_group_rounds r
    JOIN ajo_groups g ON g.id = r.group_id
    WHERE r.id = v_round_id;

  IF NOT FOUND OR v_round_status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Round is not active');
  END IF;
  IF v_group_owner <> p_owner_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Access denied');
  END IF;

  -- Lock the whole current batch (ordered by position) and collect their details.
  -- FOR UPDATE OF t here is what makes a raced-out second concurrent call (e.g. a
  -- double-tapped "Pay Out") return the "not current" error below instead of a
  -- double payout — the second caller's rows no longer match status='current'
  -- once this transaction commits.
  FOR v_t IN
    SELECT t.id, t.position, t.client_id, t.payout_contribution_id, c.full_name, c.email
      FROM ajo_group_turns t
      JOIN aso_clients c ON c.id = t.client_id
      WHERE t.round_id = v_round_id AND t.status = 'current'
      ORDER BY t.position ASC
      FOR UPDATE OF t
  LOOP
    IF v_t.payout_contribution_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Payout already recorded for this turn');
    END IF;
    v_batch_turn_ids := v_batch_turn_ids || v_t.id;
    v_batch_client   := v_batch_client   || v_t.client_id;
    v_batch_pos      := v_batch_pos      || v_t.position;
    v_batch_name     := v_batch_name     || v_t.full_name;
    v_batch_email    := v_batch_email    || COALESCE(v_t.email, '');
  END LOOP;

  IF array_length(v_batch_turn_ids, 1) IS NULL OR array_length(v_batch_turn_ids, 1) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Turn is not the current turn');
  END IF;
  v_slot_count := array_length(v_batch_turn_ids, 1);

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
      AND group_id             = v_group_id
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
    AND group_id             = v_group_id
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
      AND group_id             = v_group_id
      AND status               = 'completed'
      AND created_at           >= v_round_start;

    CONTINUE WHEN v_member_contrib <= 0;

    INSERT INTO ajo_contributions (
      aso_client_id, owner_id, amount, type,
      payment_method, status, contribution_context, group_id, notes, paystack_status
    ) VALUES (
      v_member_rec.client_id, p_owner_id, v_member_contrib, 'esusu_pot_sweep',
      'group_rotation', 'completed', 'esusu_rotation',
      v_group_id,
      'Esusu pot sweep — Round ' || v_round_number || ', positions ' || v_batch_pos[1] || '-' || v_batch_pos[v_slot_count],
      'completed'
    );

    UPDATE aso_clients
      SET current_balance = COALESCE(current_balance, 0) - v_member_contrib
      WHERE id = v_member_rec.client_id;
  END LOOP;

  -- ── Split pot evenly across the batch; rounding remainder to lowest position ─
  v_per_winner := TRUNC(v_pot / v_slot_count, 2);
  v_remainder  := v_pot - (v_per_winner * v_slot_count);

  FOR j IN 1..v_slot_count LOOP
    v_amount := v_per_winner + CASE WHEN j = 1 THEN v_remainder ELSE 0 END;

    INSERT INTO ajo_contributions (
      aso_client_id, owner_id, amount, type,
      payment_method, status, contribution_context, group_id, notes, paystack_status
    ) VALUES (
      v_batch_client[j], p_owner_id, v_amount, 'esusu_payout', 'group_rotation', 'completed',
      'esusu_rotation',
      v_group_id,
      'Esusu pot payout — Round ' || v_round_number || ', Position ' || v_batch_pos[j],
      'completed'
    ) RETURNING id INTO v_payout_id;

    UPDATE aso_clients SET
      current_balance = COALESCE(current_balance, 0) + v_amount,
      total_saved     = COALESCE(total_saved, 0)     + v_amount
    WHERE id = v_batch_client[j];

    UPDATE ajo_group_turns
      SET status = 'paid', payout_contribution_id = v_payout_id
      WHERE id = v_batch_turn_ids[j];

    v_beneficiaries := v_beneficiaries || jsonb_build_array(jsonb_build_object(
      'client_id', v_batch_client[j],
      'name',      v_batch_name[j],
      'email',     v_batch_email[j],
      'position',  v_batch_pos[j],
      'amount',    v_amount,
      'payout_id', v_payout_id
    ));
  END LOOP;

  -- ── Activate next batch ─────────────────────────────────────────────────
  FOR v_next_id IN
    SELECT id FROM ajo_group_turns
    WHERE round_id = v_round_id AND status = 'upcoming'
    ORDER BY position ASC
    LIMIT v_slots
  LOOP
    UPDATE ajo_group_turns
      SET status = 'current', period_start = NOW()
      WHERE id = v_next_id;
    v_next_ids := v_next_ids || v_next_id;
  END LOOP;

  RETURN jsonb_build_object(
    'ok',                true,
    'beneficiaries',     v_beneficiaries,
    'pot_amount',        v_pot,
    'per_winner_amount', v_per_winner,
    'next_turn_ids',     to_jsonb(v_next_ids),
    'round_complete',    (array_length(v_next_ids, 1) IS NULL)
  );
END;
$function$;

-- ── ajo_skip_turn: lock the initial read, backfill the batch, guard removal ─

CREATE OR REPLACE FUNCTION public.ajo_skip_turn(p_turn_id uuid, p_owner_id uuid, p_reason text, p_move_to_end boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_turn           RECORD;
  v_was_current    BOOLEAN;
  v_max_pos        INT;
  v_slots          INT;
  v_remaining      INT;
  v_current_count  INT;
  v_promote_count  INT;
  v_next_ids       UUID[] := '{}';
  v_next_id        UUID;
BEGIN
  -- Get turn + round status + group owner + slots; FOR UPDATE OF t locks the
  -- turn row for this whole transaction so a concurrent ajo_execute_payout on
  -- the same turn fully serializes against this call instead of racing (fixes
  -- a pre-existing bug where a plain, unlocked read here could let this
  -- function overwrite a turn that a concurrent payout had just paid).
  SELECT t.*, r.status AS round_status, g.owner_id AS group_owner, r.payout_slots_per_round AS slots
    INTO v_turn
    FROM ajo_group_turns t
    JOIN ajo_group_rounds r ON r.id = t.round_id
    JOIN ajo_groups g ON g.id = t.group_id
    WHERE t.id = p_turn_id
    FOR UPDATE OF t;

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

  v_slots       := COALESCE(v_turn.slots, 1);
  v_was_current := (v_turn.status = 'current');

  -- Fairness guard: a permanent removal must not leave a remaining turn count
  -- that doesn't divide evenly by payout_slots_per_round — otherwise a shrunk
  -- tail batch's lone winner would collect the whole collective pot instead of
  -- their fair share. "Move to end" never triggers this since it keeps the
  -- turn in the pool (just deprioritized) — the total count never shrinks.
  IF NOT p_move_to_end THEN
    SELECT COUNT(*) INTO v_remaining
      FROM ajo_group_turns
      WHERE round_id = v_turn.round_id
        AND status IN ('upcoming', 'current')
        AND id <> p_turn_id;

    IF v_remaining > 0 AND v_remaining % v_slots <> 0 THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', format(
          'Removing this member would leave %s turn(s) for %s winners per round — an uneven split. Use "move to end" instead, or close the round.',
          v_remaining, v_slots
        )
      );
    END IF;
  END IF;

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

  -- If it was part of the current batch, backfill it back up to full size,
  -- bounded by however many upcoming turns actually remain.
  IF v_was_current THEN
    SELECT COUNT(*) INTO v_current_count
      FROM ajo_group_turns
      WHERE round_id = v_turn.round_id AND status = 'current';

    v_promote_count := v_slots - v_current_count;

    IF v_promote_count > 0 THEN
      FOR v_next_id IN
        SELECT id FROM ajo_group_turns
        WHERE round_id = v_turn.round_id AND status = 'upcoming'
        ORDER BY position ASC
        LIMIT v_promote_count
      LOOP
        UPDATE ajo_group_turns
          SET status = 'current', period_start = NOW()
          WHERE id = v_next_id;
        v_next_ids := v_next_ids || v_next_id;
      END LOOP;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok',            true,
    'moved_to_end',  p_move_to_end,
    'next_turn_ids', to_jsonb(v_next_ids)
  );
END;
$function$;
