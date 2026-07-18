-- Ajo Trust Model v2 — Part 2: Fee Unification
-- Approved 2026-07-18. Ruling: Case 3 group-linked → percent at wfp.
--
-- What this migration does:
--   1. Migrates aso_clients per ruled cases, zeroing withdrawal_fee_percent.
--   2. Adds CHECK: group-linked clients cannot be first_period (DB constraint).
--   3. Replaces ajo_record_withdrawal fee source:
--      withdrawal_fee_percent (retired) → commission_percent when commission_model='percent'.
--
-- Expected counts on this DB (pre-migration state):
--   Case 3 group-linked (Rahila Danjuma): 1 row — percent at 5%
--   Case 5 (wfp-only):                   1 row — percent at existing wfp
--   Zero rows left with withdrawal_fee_percent > 0 after migration.

-- ── 1. Pre-migration notice: Case 3 group-linked ─────────────────────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, full_name, withdrawal_fee_percent, ajo_group_id
    FROM   aso_clients
    WHERE  archived_at IS NULL
      AND  commission_model   = 'first_period'
      AND  withdrawal_fee_percent > 0
      AND  ajo_group_id IS NOT NULL
  LOOP
    RAISE NOTICE
      'MIGRATION (Case 3 group-linked): "%" (%) — first_period invalid for group member. '
      'Migrating → percent @ %. Owner awareness: orphaned first_period setting cleared.',
      r.full_name, r.id, r.withdrawal_fee_percent;
  END LOOP;
END;
$$;

-- ── 2. Data migration ─────────────────────────────────────────────────────────
UPDATE aso_clients
SET
  commission_model = CASE
    -- Case 1: wfp>0 + percent → percent (wfp wins over commission_percent value)
    WHEN withdrawal_fee_percent > 0 AND commission_model = 'percent'
      THEN 'percent'
    -- Case 3 group-linked → percent (approved ruling; first_period invalid in group)
    WHEN commission_model = 'first_period' AND withdrawal_fee_percent > 0 AND ajo_group_id IS NOT NULL
      THEN 'percent'
    -- Case 3 non-group → first_period wins, wfp zeroed
    WHEN commission_model = 'first_period' AND withdrawal_fee_percent > 0
      THEN 'first_period'
    -- Case 5: wfp>0 + none → percent
    WHEN withdrawal_fee_percent > 0 AND commission_model = 'none'
      THEN 'percent'
    -- Cases 2, 4, 6: already correct
    ELSE commission_model
  END,
  commission_percent = CASE
    -- Case 1: wfp wins — replace commission_percent with wfp value
    WHEN withdrawal_fee_percent > 0 AND commission_model = 'percent'
      THEN withdrawal_fee_percent
    -- Case 3 group-linked: use wfp as the percent value
    WHEN commission_model = 'first_period' AND withdrawal_fee_percent > 0 AND ajo_group_id IS NOT NULL
      THEN withdrawal_fee_percent
    -- Case 3 non-group: first_period — clear percent (not used by first_period model)
    WHEN commission_model = 'first_period' AND withdrawal_fee_percent > 0 AND ajo_group_id IS NULL
      THEN NULL
    -- Case 5: promote wfp into commission_percent
    WHEN withdrawal_fee_percent > 0 AND commission_model = 'none'
      THEN withdrawal_fee_percent
    -- Cases 2, 4, 6: commission_percent already correct
    ELSE commission_percent
  END,
  withdrawal_fee_percent = 0    -- field retired; zero for all active clients
WHERE archived_at IS NULL;

-- ── 3. Group constraint ───────────────────────────────────────────────────────
-- first_period is structurally unavailable for group-linked clients:
-- group savings use percentage-at-withdrawal only; first_period executes per-cycle
-- at settlement which has no defined semantics in a shared-pot group context.
ALTER TABLE aso_clients
  ADD CONSTRAINT aso_clients_no_first_period_in_group
    CHECK (ajo_group_id IS NULL OR commission_model != 'first_period');

-- ── 4. ajo_record_withdrawal — unified fee source ─────────────────────────────
-- Before: ROUND(p_gross_amount * COALESCE(v_client.withdrawal_fee_percent, 0) / 100, 2)
-- After:  percentage model → commission_percent; first_period → $0 here (settled at cycle close)
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
  v_client     RECORD;
  v_fee_amount NUMERIC;
  v_net_amount NUMERIC;
  v_net_id     UUID;
  v_fee_id     UUID;
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

  -- Unified fee: percent model → commission_percent; first_period settles at cycle close.
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
    'new_balance', COALESCE(v_client.current_balance, 0) - p_gross_amount
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ajo_record_withdrawal(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, UUID) TO service_role;

-- ── 5. Migration output verification ─────────────────────────────────────────
-- Run after applying to confirm zero legacy values remain:
--   SELECT COUNT(*) FROM aso_clients WHERE archived_at IS NULL AND withdrawal_fee_percent > 0;
--   → must be 0
--   SELECT commission_model, COUNT(*) FROM aso_clients WHERE archived_at IS NULL GROUP BY 1;
--   → distribution should match pre-migration case counts
--   SELECT COUNT(*) FROM aso_clients WHERE ajo_group_id IS NOT NULL AND commission_model = 'first_period';
--   → must be 0 (constraint also enforces this)
