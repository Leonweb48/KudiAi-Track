-- Fix 1: collection_record double-credit gap — orphan recovery
--
-- When collection_record's approve step fails after the record step succeeds,
-- a pending row with contribution_source='collection' is left in ajo_contributions.
-- The EF now detects this orphan on retry and runs only the approve step,
-- preventing a duplicate insert that would double-credit the client.
--
-- The source='collection' tag is what isolates this check from client-submitted
-- manual-deposit claims (initiated_by='client', payment_method='manual_transfer'):
-- those must always wait for explicit owner confirmation and must never be
-- auto-approved by a passing collection retry.

-- ── 1. Add contribution_source column ─────────────────────────────────────────
ALTER TABLE ajo_contributions
  ADD COLUMN IF NOT EXISTS contribution_source TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS ajo_contributions_source_pending_idx
  ON ajo_contributions (aso_client_id, amount, status, contribution_source)
  WHERE status = 'pending' AND contribution_source IS NOT NULL;

-- ── 2. Recreate ajo_record_contribution with p_source param ───────────────────
DROP FUNCTION IF EXISTS ajo_record_contribution(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, UUID, TEXT);

CREATE OR REPLACE FUNCTION ajo_record_contribution(
  p_client_id            UUID,
  p_owner_id             UUID,
  p_amount               NUMERIC,
  p_method               TEXT    DEFAULT 'cash',
  p_ref                  TEXT    DEFAULT NULL,
  p_notes                TEXT    DEFAULT NULL,
  p_recorded_by          UUID    DEFAULT NULL,
  p_contribution_context TEXT    DEFAULT 'personal_savings',
  p_source               TEXT    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client          RECORD;
  v_contribution_id UUID;
BEGIN
  SELECT * INTO v_client FROM aso_clients WHERE id = p_client_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Client not found');
  END IF;

  IF v_client.user_id IS NOT NULL AND v_client.user_id != p_owner_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Amount must be greater than zero');
  END IF;

  -- Insert as pending; balance credit and next_contribution_date update happen on approval.
  -- p_source is stored to allow the collection_record EF action to detect its own orphans.
  INSERT INTO ajo_contributions (
    aso_client_id, owner_id, amount, type,
    payment_method, paystack_ref, status, notes,
    recorded_by, paystack_status, contribution_context, contribution_source
  ) VALUES (
    p_client_id, p_owner_id, p_amount, 'contribution',
    p_method, p_ref, 'pending', p_notes,
    p_recorded_by, 'pending', p_contribution_context, p_source
  )
  RETURNING id INTO v_contribution_id;

  RETURN jsonb_build_object(
    'ok',              true,
    'contribution_id', v_contribution_id,
    'status',          'pending'
  );
END;
$$;

REVOKE ALL ON FUNCTION ajo_record_contribution(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION ajo_record_contribution(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, UUID, TEXT, TEXT) TO service_role;
