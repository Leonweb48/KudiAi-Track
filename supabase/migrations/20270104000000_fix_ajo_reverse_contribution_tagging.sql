-- ═════════════════════════════════════════════════════════════════════════════
-- ajo_reverse_contribution never tagged reversal rows with contribution_context,
-- and had REGRESSED on group_id too (an earlier version, 20261002000000, DID
-- propagate group_id into both inserts — a later rewrite, 20261015000002, lost
-- it when the function was reworked, most likely copy-pasted from an even
-- older base).
--
-- Same bug class as ajo_execute_payout's historical gap and ajo_record_
-- withdrawal's (both already fixed this session): getGroupStats (client) and
-- ajo_entity_stats (server) both filter strictly on contribution_context +
-- group_id before summing anything. A reversal of a group_savings or
-- esusu_rotation contribution/withdrawal — real money, correctly applied to
-- current_balance via v_balance_delta below — was invisible to either sum,
-- because it satisfied neither the group's contribution_context nor its
-- group_id. The ORIGINAL row (never touched by a reversal — it stays
-- status='completed' forever) kept counting toward that entity's "saved"/
-- "received," while its reversal silently failed to net back out.
--
-- Now propagates contribution_context and group_id straight from the row
-- being reversed (v_original / v_fee_rows) — the correct value by
-- construction, since a reversal is definitionally "the same entity, the
-- opposite direction," never a value to recompute.
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION ajo_reverse_contribution(
  p_original_id UUID,
  p_owner_id    UUID,
  p_reason      TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_original      RECORD;
  v_client        RECORD;
  v_fee_rows      RECORD;
  v_balance_delta NUMERIC := 0;
  v_fee_sum       NUMERIC := 0;
  v_reversal_ids  UUID[]  := '{}';
  v_rev_net_id    UUID;
  v_rev_type      TEXT;
  v_rev_fee_type  TEXT;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Reason must be at least 5 characters');
  END IF;

  SELECT * INTO v_original FROM ajo_contributions WHERE id = p_original_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Row not found');
  END IF;

  IF v_original.status != 'completed' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not completed — only completed rows can be reversed');
  END IF;

  IF v_original.reverses_contribution_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Is a reversal — cannot reverse a reversal row');
  END IF;

  IF v_original.owner_id IS NOT NULL AND v_original.owner_id != p_owner_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized');
  END IF;

  IF v_original.fee_for_contribution_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Is a fee row — reverse the parent transaction instead');
  END IF;

  IF EXISTS (
    SELECT 1 FROM ajo_contributions WHERE reverses_contribution_id = p_original_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Already reversed');
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_fee_sum
  FROM ajo_contributions
  WHERE fee_for_contribution_id = p_original_id AND status = 'completed';

  CASE v_original.type
    WHEN 'contribution' THEN
      v_rev_type      := 'reversal_contribution';
      v_balance_delta := -(v_original.amount - v_fee_sum);
    WHEN 'withdrawal' THEN
      v_rev_type      := 'reversal_withdrawal';
      v_balance_delta := v_original.amount + v_fee_sum;
    ELSE
      RETURN jsonb_build_object('ok', false, 'error', 'Unsupported type: ' || v_original.type);
  END CASE;

  SELECT * INTO v_client FROM aso_clients WHERE id = v_original.aso_client_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Client not found');
  END IF;

  IF COALESCE(v_client.current_balance, 0) + v_balance_delta < 0 THEN
    RETURN jsonb_build_object(
      'ok',    false,
      'error', 'Client balance insufficient to reverse this entry'
    );
  END IF;

  INSERT INTO ajo_contributions (
    aso_client_id, owner_id, amount, type, payment_method,
    status, notes, recorded_by, reverses_contribution_id, paystack_status,
    cycle_id, group_id, contribution_context
  ) VALUES (
    v_original.aso_client_id, v_original.owner_id,
    v_original.amount, v_rev_type, v_original.payment_method,
    'completed', 'Reversal: ' || p_reason, p_owner_id,
    v_original.id, 'completed',
    v_original.cycle_id, v_original.group_id, v_original.contribution_context
  )
  RETURNING id INTO v_rev_net_id;

  v_reversal_ids := array_append(v_reversal_ids, v_rev_net_id);

  FOR v_fee_rows IN
    SELECT * FROM ajo_contributions
    WHERE fee_for_contribution_id = p_original_id AND status = 'completed'
  LOOP
    v_rev_fee_type := CASE v_fee_rows.type
      WHEN 'withdrawal_fee'    THEN 'reversal_withdrawal_fee'
      WHEN 'registration_fee'  THEN 'reversal_registration_fee'
      ELSE 'reversal_' || v_fee_rows.type
    END;

    DECLARE v_rev_fee_id UUID;
    BEGIN
      INSERT INTO ajo_contributions (
        aso_client_id, owner_id, amount, type, payment_method,
        status, notes, recorded_by,
        reverses_contribution_id, fee_for_contribution_id, paystack_status,
        cycle_id, group_id, contribution_context
      ) VALUES (
        v_fee_rows.aso_client_id, v_fee_rows.owner_id,
        v_fee_rows.amount, v_rev_fee_type, v_fee_rows.payment_method,
        'completed', 'Fee reversal: ' || p_reason, p_owner_id,
        v_fee_rows.id, v_rev_net_id, 'completed',
        v_fee_rows.cycle_id, v_fee_rows.group_id, v_fee_rows.contribution_context
      )
      RETURNING id INTO v_rev_fee_id;
      v_reversal_ids := array_append(v_reversal_ids, v_rev_fee_id);

      IF v_fee_rows.type = 'commission' AND v_fee_rows.cycle_id IS NOT NULL THEN
        UPDATE ajo_cycles SET commission_balance = 0 WHERE id = v_fee_rows.cycle_id;
      END IF;
    END;
  END LOOP;

  UPDATE aso_clients SET
    current_balance = COALESCE(current_balance, 0) + v_balance_delta,
    total_saved = CASE
      WHEN v_original.type = 'contribution'
        THEN GREATEST(0, COALESCE(total_saved, 0) - v_original.amount)
      ELSE total_saved
    END,
    total_withdrawn = CASE
      WHEN v_original.type = 'withdrawal'
        THEN GREATEST(0, COALESCE(total_withdrawn, 0) - v_original.amount)
      ELSE total_withdrawn
    END
  WHERE id = v_original.aso_client_id;

  RETURN jsonb_build_object(
    'ok',           true,
    'reversal_ids', v_reversal_ids,
    'new_balance',  COALESCE(v_client.current_balance, 0) + v_balance_delta
  );
END;
$$;

REVOKE ALL ON FUNCTION ajo_reverse_contribution(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION ajo_reverse_contribution(UUID, UUID, TEXT) TO service_role;

-- ── One-time repair: already-mistagged reversal rows ──────────────────────────
-- Safe signature: a reversal row (reverses_contribution_id/fee_for_
-- contribution_id IS NOT NULL) still at the column default 'personal_savings'
-- whose ORIGINAL row (what it reverses) says otherwise — pull the correct
-- context/group_id straight from that original, exactly what the fixed
-- function now does at insert time.
DO $$
DECLARE
  v_fixed INT;
BEGIN
  -- reverses_contribution_id is always set on a reversal row created by this
  -- function (for both the main reversal and each fee reversal) — it always
  -- points at the exact row being reversed.
  UPDATE ajo_contributions rev
  SET contribution_context = orig.contribution_context,
      group_id             = orig.group_id
  FROM ajo_contributions orig
  WHERE orig.id = rev.reverses_contribution_id
    AND rev.type LIKE 'reversal_%'
    AND rev.contribution_context = 'personal_savings'
    AND orig.contribution_context <> 'personal_savings';

  GET DIAGNOSTICS v_fixed = ROW_COUNT;
  RAISE NOTICE 'reversal contribution_context repair: retagged % row(s)', v_fixed;
END $$;
