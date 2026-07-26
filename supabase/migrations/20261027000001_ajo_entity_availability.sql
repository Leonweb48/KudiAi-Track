-- ─────────────────────────────────────────────────────────────────────────────
-- Withdrawal availability: subtract pending requests + enforce per-entity caps
--
-- Three new read-only helpers:
--   ajo_pending_for_entity   — total pending/held_24h withdrawal amount for a
--                              client, optionally scoped to a cycle or group.
--   ajo_cycle_net_balance    — mirrors getCycleStats().net: contributions -
--                              fees - prior withdrawals for a specific cycle.
--   ajo_group_net_balance    — mirrors getGroupSaved(): group_savings
--                              contributions for a specific group.
--
-- Updated ajo_record_withdrawal:
--   Adds a global pending deduction for direct staff recordings (no request_id).
--   When approving an existing request (p_request_id IS NOT NULL) the pending
--   check is skipped — the request was validated at creation and is now settled.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── ajo_pending_for_entity ────────────────────────────────────────────────────
-- With no entity args: returns total pending across all of the client's requests.
-- With p_cycle_id: scoped to that cycle only.
-- With p_group_id: scoped to that group only.
CREATE OR REPLACE FUNCTION public.ajo_pending_for_entity(
  p_client_id UUID,
  p_cycle_id  UUID DEFAULT NULL,
  p_group_id  UUID DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(amount), 0)
  FROM   ajo_withdrawal_requests
  WHERE  aso_client_id = p_client_id
    AND  status IN ('pending', 'held_24h')
    AND  CASE
           WHEN p_cycle_id IS NOT NULL THEN cycle_id = p_cycle_id
           WHEN p_group_id IS NOT NULL THEN group_id = p_group_id
           ELSE TRUE
         END;
$$;

REVOKE ALL ON FUNCTION public.ajo_pending_for_entity(UUID, UUID, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ajo_pending_for_entity(UUID, UUID, UUID) TO service_role, authenticated;

-- ── ajo_cycle_net_balance ─────────────────────────────────────────────────────
-- Server-side mirror of getCycleStats().net used in the client UI.
-- contributions - commission/registration_fee - prior withdrawals, floored at 0.
CREATE OR REPLACE FUNCTION public.ajo_cycle_net_balance(
  p_client_id UUID,
  p_cycle_id  UUID
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(0,
    COALESCE(SUM(CASE WHEN type = 'contribution'                         THEN amount ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN type IN ('commission', 'registration_fee') THEN amount ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN type = 'withdrawal'                        THEN amount ELSE 0 END), 0)
  )
  FROM  ajo_contributions
  WHERE aso_client_id = p_client_id
    AND cycle_id      = p_cycle_id
    AND status        = 'completed';
$$;

REVOKE ALL ON FUNCTION public.ajo_cycle_net_balance(UUID, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ajo_cycle_net_balance(UUID, UUID) TO service_role, authenticated;

-- ── ajo_group_net_balance ─────────────────────────────────────────────────────
-- Server-side mirror of getGroupSaved() used in the client UI.
-- Sums completed group_savings contributions (no prior-withdrawal deduction,
-- matching the UI figure). Global lock check covers actual balance integrity.
CREATE OR REPLACE FUNCTION public.ajo_group_net_balance(
  p_client_id UUID,
  p_group_id  UUID
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(0,
    COALESCE(SUM(amount), 0)
  )
  FROM  ajo_contributions
  WHERE aso_client_id        = p_client_id
    AND group_id             = p_group_id
    AND contribution_context = 'group_savings'
    AND type                 = 'contribution'
    AND status               = 'completed';
$$;

REVOKE ALL ON FUNCTION public.ajo_group_net_balance(UUID, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ajo_group_net_balance(UUID, UUID) TO service_role, authenticated;

-- ── ajo_record_withdrawal — add global pending check for direct recordings ────
-- Full replacement (same 9-arg signature). Only addition: after the 3-way lock
-- check, subtract outstanding pending requests from v_withdrawable when the
-- call is a direct recording (p_request_id IS NULL). Request approvals skip
-- this block because the request being approved is itself pending and settling
-- it is the purpose of the call.

DROP FUNCTION IF EXISTS public.ajo_record_withdrawal(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, UUID, UUID, UUID);

CREATE FUNCTION public.ajo_record_withdrawal(
  p_client_id    UUID,
  p_owner_id     UUID,
  p_gross_amount NUMERIC,
  p_method       TEXT    DEFAULT 'cash',
  p_notes        TEXT    DEFAULT NULL,
  p_recorded_by  UUID    DEFAULT NULL,
  p_request_id   UUID    DEFAULT NULL,
  p_cycle_id     UUID    DEFAULT NULL,
  p_group_id     UUID    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client         RECORD;
  v_esusu_locked   NUMERIC;
  v_cycle_locked   NUMERIC;
  v_group_locked   NUMERIC;
  v_withdrawable   NUMERIC;
  v_pending_total  NUMERIC;
  v_pct_fee        NUMERIC;
  v_fee_amount     NUMERIC;
  v_net_amount     NUMERIC;
  v_net_id         UUID;
  v_fee_id         UUID;
  v_lock_msg       TEXT;
  v_lock_parts     TEXT[];
  v_attr_cycle_id  UUID;
  v_attr_group_id  UUID;
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

  IF COALESCE(v_client.current_balance, 0) < p_gross_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Insufficient balance');
  END IF;

  -- Three-way lock: esusu round + first_period cycle + committed group/esusu
  v_esusu_locked := ajo_locked_esusu_amount(p_client_id);
  v_cycle_locked := ajo_locked_cycle_amount(p_client_id);
  v_group_locked := ajo_locked_group_amount(p_client_id);
  v_withdrawable := COALESCE(v_client.current_balance, 0)
                    - v_esusu_locked - v_cycle_locked - v_group_locked;

  IF v_withdrawable < p_gross_amount THEN
    v_lock_parts := ARRAY[]::TEXT[];
    IF v_group_locked > 0 THEN
      v_lock_parts := v_lock_parts || ('₦' || ROUND(v_group_locked, 2) || ' committed to a savings group or esusu — available after your payout');
    END IF;
    IF v_esusu_locked > 0 THEN
      v_lock_parts := v_lock_parts || ('₦' || ROUND(v_esusu_locked, 2) || ' locked in an active esusu round');
    END IF;
    IF v_cycle_locked > 0 THEN
      v_lock_parts := v_lock_parts || ('₦' || ROUND(v_cycle_locked, 2) || ' locked in an active first-period savings cycle');
    END IF;
    v_lock_msg := CASE
      WHEN array_length(v_lock_parts, 1) > 0
        THEN 'Insufficient withdrawable balance — ' || array_to_string(v_lock_parts, ' and ')
      ELSE 'balance too low'
    END;
    RETURN jsonb_build_object(
      'ok',           false,
      'error',        v_lock_msg,
      'esusu_locked', v_esusu_locked,
      'cycle_locked', v_cycle_locked,
      'group_locked', v_group_locked,
      'withdrawable', GREATEST(v_withdrawable, 0)
    );
  END IF;

  -- Pending deduction: direct recordings only (request approvals skip this).
  -- When approving an existing request the request is already in 'pending'
  -- status and settling it is the whole point — counting it would block approval.
  IF p_request_id IS NULL THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_pending_total
    FROM   ajo_withdrawal_requests
    WHERE  aso_client_id = p_client_id
      AND  status IN ('pending', 'held_24h');

    IF p_gross_amount > (v_withdrawable - v_pending_total) THEN
      RETURN jsonb_build_object(
        'ok',      false,
        'error',   format(
                     '₦%s available right now — ₦%s already pending review',
                     GREATEST(0, v_withdrawable - v_pending_total)::NUMERIC(18,2)::TEXT,
                     v_pending_total::NUMERIC(18,2)::TEXT
                   ),
        'pending', v_pending_total,
        'withdrawable', GREATEST(0, v_withdrawable - v_pending_total)
      );
    END IF;
  END IF;

  -- Resolve attribution: request row wins, then explicit params
  IF p_request_id IS NOT NULL THEN
    SELECT cycle_id, group_id INTO v_attr_cycle_id, v_attr_group_id
    FROM ajo_withdrawal_requests WHERE id = p_request_id;
    v_attr_cycle_id := COALESCE(p_cycle_id, v_attr_cycle_id);
    v_attr_group_id := COALESCE(p_group_id, v_attr_group_id);
  ELSE
    v_attr_cycle_id := p_cycle_id;
    v_attr_group_id := p_group_id;
  END IF;

  SELECT COALESCE(commission_percent, 0) INTO v_pct_fee
  FROM ajo_cycles
  WHERE client_id = p_client_id
    AND status = 'active'
    AND commission_model = 'percent'
  ORDER BY created_at ASC
  LIMIT 1;

  v_fee_amount := CASE WHEN COALESCE(v_pct_fee, 0) > 0
    THEN ROUND(p_gross_amount * v_pct_fee / 100, 2)
    ELSE 0
  END;
  v_net_amount := p_gross_amount - v_fee_amount;

  IF v_net_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Amount too small after fee');
  END IF;

  INSERT INTO ajo_contributions (
    aso_client_id, owner_id, amount, type,
    payment_method, status, notes, recorded_by, paystack_status,
    cycle_id, group_id
  ) VALUES (
    p_client_id, p_owner_id, v_net_amount, 'withdrawal',
    p_method, 'completed', p_notes, p_recorded_by, 'completed',
    v_attr_cycle_id, v_attr_group_id
  )
  RETURNING id INTO v_net_id;

  IF v_fee_amount > 0 THEN
    INSERT INTO ajo_contributions (
      aso_client_id, owner_id, amount, type,
      payment_method, status, recorded_by,
      fee_for_contribution_id, paystack_status,
      cycle_id, group_id
    ) VALUES (
      p_client_id, p_owner_id, v_fee_amount, 'withdrawal_fee',
      p_method, 'completed', p_recorded_by,
      v_net_id, 'completed',
      v_attr_cycle_id, v_attr_group_id
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
    'ok',           true,
    'net_id',       v_net_id,
    'fee_id',       v_fee_id,
    'fee_amount',   v_fee_amount,
    'net_amount',   v_net_amount,
    'gross_amount', p_gross_amount,
    'new_balance',  COALESCE(v_client.current_balance, 0) - p_gross_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ajo_record_withdrawal(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ajo_record_withdrawal(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, UUID, UUID, UUID)
  TO service_role;
