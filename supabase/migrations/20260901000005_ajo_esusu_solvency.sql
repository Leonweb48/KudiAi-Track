-- Esusu solvency fix — closes phantom-liability bug where member contributions
-- credited current_balance AND the winner was credited again with no debit,
-- doubling aggregate liabilities vs cash-collected truth.
--
-- Changes:
--   1. ajo_locked_esusu_amount — helper used by withdrawal gates
--   2. ajo_execute_payout rebuilt — junction-table membership, context filter,
--      atomic pot-sweep debits before winner credit
--   3. ajo_client_ledger_balance updated — esusu_pot_sweep added as debit type
--   4. ajo_record_withdrawal updated — locked-funds ceiling enforced server-side


-- ── 1. Helper: locked esusu amount for a client ─────────────────────────────
-- Returns the sum of completed esusu_rotation contributions made during the
-- currently active turn period(s) for any esusu group the client belongs to.
-- These funds are earmarked for the next payout and must not be withdrawn.
CREATE OR REPLACE FUNCTION public.ajo_locked_esusu_amount(p_client_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(ac.amount), 0)
  FROM ajo_contributions ac
  WHERE ac.aso_client_id = p_client_id
    AND ac.contribution_context = 'esusu_rotation'
    AND ac.type   = 'contribution'
    AND ac.status = 'completed'
    AND ac.created_at >= (
      -- earliest period_start across all active esusu turns this client is in
      SELECT COALESCE(MIN(t.period_start), NOW() + INTERVAL '100 years')
      FROM ajo_group_turns t
      JOIN ajo_group_rounds r ON r.id = t.round_id AND r.status = 'active'
      WHERE t.status = 'current'
        AND (
          r.group_id IN (
            SELECT group_id FROM aso_client_group_memberships
            WHERE client_id = p_client_id AND status = 'active'
          )
          OR r.group_id IN (
            SELECT ajo_group_id FROM aso_clients
            WHERE id = p_client_id AND ajo_group_id IS NOT NULL
          )
        )
    );
$$;

REVOKE EXECUTE ON FUNCTION public.ajo_locked_esusu_amount(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ajo_locked_esusu_amount(UUID)
  TO service_role, authenticated;


-- ── 2. ajo_execute_payout — rebuilt with atomic sweep ───────────────────────
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
  v_member_ids     UUID[];
  v_member_rec     RECORD;
  v_member_contrib NUMERIC(12,2);
  v_pot            NUMERIC(12,2) := 0;
  v_missing        JSONB := '[]'::JSONB;
  v_missing_count  INT   := 0;
  v_payout_id      UUID;
  v_next_id        UUID;
BEGIN
  -- Lock the turn row to prevent concurrent payout
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
    -- Idempotent: already paid
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

  -- ── Membership: junction table only (ajo_group_id is the legacy fallback) ──
  -- Mirrors the already-fixed ajo_start_round membership check.
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

  -- ── Hard gate: every member must have contributed (esusu_rotation context) ──
  FOR v_member_rec IN
    SELECT c.id, c.full_name, COALESCE(c.contribution_amount, 0) AS contribution_amount
    FROM aso_clients c
    WHERE c.id = ANY(v_member_ids)
  LOOP
    CONTINUE WHEN v_member_rec.contribution_amount <= 0;

    SELECT COALESCE(SUM(amount), 0) INTO v_member_contrib
      FROM ajo_contributions
      WHERE aso_client_id     = v_member_rec.id
        AND contribution_context = 'esusu_rotation'
        AND type              = 'contribution'
        AND status            = 'completed'
        AND created_at        >= v_turn.period_start;

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

  -- ── Pot = sum of esusu_rotation contributions since period_start ──────────
  -- Personal-savings contributions are excluded by the context filter.
  SELECT COALESCE(SUM(amount), 0) INTO v_pot
    FROM ajo_contributions
    WHERE aso_client_id      = ANY(v_member_ids)
      AND contribution_context = 'esusu_rotation'
      AND type               = 'contribution'
      AND status             = 'completed'
      AND created_at         >= v_turn.period_start;

  IF v_pot <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pot is empty — no esusu contributions recorded for this period');
  END IF;

  -- ── Atomic sweep: debit each member's share from their balance ─────────────
  -- This closes the phantom-liability gap. After the sweep + payout, the sum of
  -- all client balances equals cash actually collected — not 2× that figure.
  FOR v_member_rec IN
    SELECT c.id AS client_id,
           c.full_name,
           COALESCE(c.contribution_amount, 0) AS contribution_amount
    FROM aso_clients c
    WHERE c.id = ANY(v_member_ids)
  LOOP
    SELECT COALESCE(SUM(amount), 0) INTO v_member_contrib
      FROM ajo_contributions
      WHERE aso_client_id      = v_member_rec.client_id
        AND contribution_context = 'esusu_rotation'
        AND type               = 'contribution'
        AND status             = 'completed'
        AND created_at         >= v_turn.period_start;

    CONTINUE WHEN v_member_contrib <= 0;

    -- Ledger: sweep debit (visible on member's statement)
    INSERT INTO ajo_contributions (
      aso_client_id, owner_id, amount, type,
      payment_method, status, contribution_context, notes, paystack_status
    ) VALUES (
      v_member_rec.client_id, p_owner_id, v_member_contrib, 'esusu_pot_sweep',
      'group_rotation', 'completed', 'esusu_rotation',
      'Esusu pot sweep — Round ' || v_round_number || ', Turn ' || v_turn.position
        || ' (winner: ' || v_turn.full_name || ')',
      'completed'
    );

    -- Balance: deduct swept amount
    UPDATE aso_clients
      SET current_balance = COALESCE(current_balance, 0) - v_member_contrib
      WHERE id = v_member_rec.client_id;
  END LOOP;

  -- ── Payout credit to winner ────────────────────────────────────────────────
  INSERT INTO ajo_contributions (
    aso_client_id, owner_id, amount, type,
    payment_method, status, contribution_context, notes, paystack_status
  ) VALUES (
    v_turn.client_id, p_owner_id, v_pot, 'esusu_payout', 'group_rotation', 'completed',
    'esusu_rotation',
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


-- ── 3. ajo_client_ledger_balance — add esusu_pot_sweep as debit type ────────
CREATE OR REPLACE FUNCTION public.ajo_client_ledger_balance(p_client_id uuid)
  RETURNS numeric
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    SUM(CASE
      WHEN type IN (
        'contribution',
        'esusu_payout',
        'reversal_withdrawal',
        'reversal_withdrawal_fee',
        'reversal_registration_fee'
      ) AND status = 'completed' THEN amount
      ELSE 0
    END)
    -
    SUM(CASE
      WHEN type IN (
        'withdrawal',
        'withdrawal_fee',
        'registration_fee',
        'reversal_contribution',
        'commission',
        'esusu_pot_sweep'   -- sweep debits balance but is not a withdrawal
      ) AND status = 'completed' THEN amount
      ELSE 0
    END),
  0)
  FROM ajo_contributions
  WHERE aso_client_id = p_client_id;
$$;

REVOKE ALL ON FUNCTION public.ajo_client_ledger_balance(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ajo_client_ledger_balance(uuid)
  TO service_role;


-- ── 4. ajo_record_withdrawal — enforce locked-funds ceiling ─────────────────
CREATE OR REPLACE FUNCTION public.ajo_record_withdrawal(
  p_client_id    UUID,
  p_owner_id     UUID,
  p_gross_amount NUMERIC,
  p_method       TEXT    DEFAULT 'cash',
  p_notes        TEXT    DEFAULT NULL,
  p_recorded_by  UUID    DEFAULT NULL,
  p_request_id   UUID    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client      RECORD;
  v_locked      NUMERIC;
  v_withdrawable NUMERIC;
  v_fee_amount  NUMERIC;
  v_net_amount  NUMERIC;
  v_net_id      UUID;
  v_fee_id      UUID;
BEGIN
  SELECT * INTO v_client FROM aso_clients WHERE id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Client not found');
  END IF;

  IF v_client.user_id IS NOT NULL AND v_client.user_id != p_owner_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized');
  END IF;

  IF p_gross_amount IS NULL OR p_gross_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Amount must be greater than zero');
  END IF;

  -- Basic balance check
  IF COALESCE(v_client.current_balance, 0) < p_gross_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Insufficient balance');
  END IF;

  -- Locked-funds ceiling: esusu contributions in an active round are not withdrawable
  v_locked      := ajo_locked_esusu_amount(p_client_id);
  v_withdrawable := COALESCE(v_client.current_balance, 0) - v_locked;
  IF v_withdrawable < p_gross_amount THEN
    RETURN jsonb_build_object(
      'ok',            false,
      'error',         'Insufficient withdrawable balance — ₦' || ROUND(v_locked, 2)::TEXT || ' is locked in an active esusu round',
      'locked_amount', v_locked,
      'withdrawable',  GREATEST(v_withdrawable, 0)
    );
  END IF;

  -- Unified fee
  v_fee_amount := CASE
    WHEN v_client.commission_model = 'percent'
      THEN ROUND(p_gross_amount * COALESCE(v_client.commission_percent, 0) / 100, 2)
    ELSE 0
  END;
  v_net_amount := p_gross_amount - v_fee_amount;

  IF v_net_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Amount too small after fee');
  END IF;

  INSERT INTO ajo_contributions (
    aso_client_id, owner_id, amount, type,
    payment_method, status, notes, recorded_by, paystack_status
  ) VALUES (
    p_client_id, p_owner_id, v_net_amount, 'withdrawal',
    p_method, 'completed', p_notes, p_recorded_by, 'completed'
  )
  RETURNING id INTO v_net_id;

  IF v_fee_amount > 0 THEN
    INSERT INTO ajo_contributions (
      aso_client_id, owner_id, amount, type,
      payment_method, status, recorded_by,
      fee_for_contribution_id, paystack_status
    ) VALUES (
      p_client_id, p_owner_id, v_fee_amount, 'withdrawal_fee',
      p_method, 'completed', p_recorded_by,
      v_net_id, 'completed'
    )
    RETURNING id INTO v_fee_id;
  END IF;

  UPDATE aso_clients SET
    current_balance = current_balance - p_gross_amount,
    total_withdrawn = COALESCE(total_withdrawn, 0) + v_net_amount
  WHERE id = p_client_id;

  IF p_request_id IS NOT NULL THEN
    UPDATE ajo_withdrawal_requests
    SET status = 'approved', approved_at = NOW()
    WHERE id = p_request_id;
  END IF;

  RETURN jsonb_build_object(
    'ok',          true,
    'net_id',      v_net_id,
    'fee_id',      v_fee_id,
    'fee_amount',  v_fee_amount,
    'net_amount',  v_net_amount,
    'gross_amount', p_gross_amount,
    'new_balance', COALESCE(v_client.current_balance, 0) - p_gross_amount
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ajo_record_withdrawal(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, UUID)
  TO service_role;
