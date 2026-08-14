-- Fix: ajo_execute_commission had no solvency pre-check.
-- When commission > current_balance the UPDATE fired the aso_clients_balance_nonneg
-- CHECK constraint as an unhandled Postgres exception. The edge function caught it and
-- returned {ok:false}, but the client-side handler swallowed the error and showed success
-- (that JS bug is fixed separately in ContributionCard / handleExecuteCommission).
--
-- Correct behaviour: reject with a clear message including both figures.
-- We never cap silently — a partial deduction would corrupt the commission ledger
-- (the ajo_contributions row would show a different amount than the agreed commission).

CREATE OR REPLACE FUNCTION ajo_execute_commission(
  p_cycle_id UUID,
  p_owner_id UUID,
  p_amount   NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cycle    ajo_cycles%ROWTYPE;
  v_client   aso_clients%ROWTYPE;
  v_entry_id UUID;
  v_cur_bal  NUMERIC;
  v_new_bal  NUMERIC;
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
  IF v_cycle.commission_model = 'first_period' THEN
    RETURN jsonb_build_object(
      'ok',    false,
      'error', 'first_period commission is collected automatically at the client''s first deposit — no manual execution needed'
    );
  END IF;

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

  v_cur_bal := COALESCE(v_client.current_balance, 0);

  -- Solvency guard — added in 20261103000005.
  -- Mirror of the guard in ajo_record_withdrawal (20260711000004 line 167).
  -- Reject cleanly so the CHECK constraint is never the error surface.
  IF v_cur_bal < p_amount THEN
    RETURN jsonb_build_object(
      'ok',    false,
      'error', format(
        'Insufficient balance — commission of ₦%s exceeds client balance of ₦%s',
        to_char(p_amount,  'FM999,999,999.00'),
        to_char(v_cur_bal, 'FM999,999,999.00')
      )
    );
  END IF;

  v_new_bal := v_cur_bal - p_amount;
  UPDATE aso_clients SET current_balance = v_new_bal WHERE id = v_cycle.client_id;

  INSERT INTO ajo_contributions
    (aso_client_id, owner_id, amount, type, status, payment_method, notes, cycle_id)
  VALUES
    (v_cycle.client_id, p_owner_id, p_amount, 'commission', 'completed', 'commission',
     'Cycle commission', p_cycle_id)
  RETURNING id INTO v_entry_id;

  RETURN jsonb_build_object(
    'ok',            true,
    'entry_id',      v_entry_id,
    'amount',        p_amount,
    'balance_before', v_cur_bal,
    'balance_after',  v_new_bal
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION ajo_execute_commission(UUID, UUID, NUMERIC)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION ajo_execute_commission(UUID, UUID, NUMERIC)
  TO service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  '20261103000005',
  'ajo_execute_commission_solvency_guard',
  ARRAY['CREATE OR REPLACE FUNCTION ajo_execute_commission(UUID, UUID, NUMERIC)']
)
ON CONFLICT (version) DO NOTHING;
