-- Phase 2 Part 2: Manual deposit flow
-- Adds columns for client-initiated bank transfer claims,
-- a storage bucket for proof screenshots,
-- and three SECURITY DEFINER RPCs following the Phase 1 pattern.
-- Ledger function unchanged — only status='completed' rows count.

-- ── 1. Additional columns on ajo_contributions ────────────────────────────
ALTER TABLE ajo_contributions
  ADD COLUMN IF NOT EXISTS payer_name      text,           -- who sent the bank transfer
  ADD COLUMN IF NOT EXISTS claim_notes     text,           -- client's reference note
  ADD COLUMN IF NOT EXISTS proof_url       text,           -- URL of uploaded screenshot
  ADD COLUMN IF NOT EXISTS rejected_reason text,           -- populated on rejection
  ADD COLUMN IF NOT EXISTS confirmed_by    uuid,           -- owner/staff who confirmed
  ADD COLUMN IF NOT EXISTS confirmed_at    timestamptz;    -- when confirmed

-- Fast queue lookup for owner's pending claims
CREATE INDEX IF NOT EXISTS ajo_contributions_pending_manual_idx
  ON ajo_contributions (owner_id, created_at)
  WHERE status = 'pending' AND payment_method = 'manual_transfer';

-- ── 2. Storage bucket for proof images ───────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ajo-proofs', 'ajo-proofs', true,
  2097152,  -- 2 MB hard limit
  ARRAY['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif']
)
ON CONFLICT (id) DO NOTHING;

-- Any session (anon key from client portal) may INSERT proof images.
-- Path is keyed by client_id so the owner can scope reads if needed.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'ajo_proofs_insert'
  ) THEN
    EXECUTE $p$ CREATE POLICY "ajo_proofs_insert" ON storage.objects
      FOR INSERT WITH CHECK (bucket_id = 'ajo-proofs') $p$;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'ajo_proofs_select'
  ) THEN
    EXECUTE $p$ CREATE POLICY "ajo_proofs_select" ON storage.objects
      FOR SELECT USING (bucket_id = 'ajo-proofs') $p$;
  END IF;
END $$;

-- ── 3. ajo_submit_manual_claim ─────────────────────────────────────────────
-- Client (via ajo-portal service role) submits a bank-transfer claim.
-- Creates a pending row. Never touches balances or total_saved.
-- Guards: amount > 0, max 3 unconfirmed claims.
CREATE OR REPLACE FUNCTION ajo_submit_manual_claim(
  p_client_id  uuid,
  p_owner_id   uuid,
  p_amount     numeric,
  p_payer_name text    DEFAULT NULL,
  p_notes      text    DEFAULT NULL,
  p_proof_url  text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client      record;
  v_pending_cnt int;
  v_claim_id    uuid;
BEGIN
  SELECT * INTO v_client FROM aso_clients WHERE id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Client not found');
  END IF;

  IF v_client.user_id IS NOT NULL AND v_client.user_id != p_owner_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Amount must be greater than zero');
  END IF;

  SELECT COUNT(*) INTO v_pending_cnt
  FROM ajo_contributions
  WHERE aso_client_id = p_client_id
    AND status         = 'pending'
    AND payment_method = 'manual_transfer';

  IF v_pending_cnt >= 3 THEN
    RETURN jsonb_build_object(
      'ok',    false,
      'error', 'You have 3 unconfirmed deposit claims. Wait for your savings agent to confirm them before submitting more.'
    );
  END IF;

  INSERT INTO ajo_contributions (
    aso_client_id, owner_id, amount, type,
    payment_method, status, initiated_by,
    payer_name, claim_notes, proof_url,
    paystack_status
  ) VALUES (
    p_client_id, p_owner_id, p_amount, 'contribution',
    'manual_transfer', 'pending', 'client',
    p_payer_name, p_notes, p_proof_url,
    'pending'
  )
  RETURNING id INTO v_claim_id;

  RETURN jsonb_build_object('ok', true, 'claim_id', v_claim_id, 'amount', p_amount);
END;
$$;

GRANT EXECUTE ON FUNCTION ajo_submit_manual_claim(uuid, uuid, numeric, text, text, text) TO service_role;

-- ── 4. ajo_confirm_manual_deposit ──────────────────────────────────────────
-- Owner/staff confirms that the transfer arrived. Mirrors ajo_record_contribution:
-- first-deposit registration fee logic, next_contribution_date advance, balance credit.
-- SELECT FOR UPDATE on the claim row guarantees idempotency — a second call
-- finds no matching row and returns ok:false without double-crediting.
CREATE OR REPLACE FUNCTION ajo_confirm_manual_deposit(
  p_claim_id     uuid,
  p_owner_id     uuid,
  p_confirmed_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim      record;
  v_client     record;
  v_is_first   boolean;
  v_reg_fee    numeric := 0;
  v_net_add    numeric;
  v_freq_days  int;
  v_base_date  date;
  v_next_date  date;
  v_reg_fee_id uuid;
BEGIN
  -- Lock the pending claim (idempotent: second call returns not-found)
  SELECT * INTO v_claim
  FROM ajo_contributions
  WHERE id             = p_claim_id
    AND status         = 'pending'
    AND payment_method = 'manual_transfer'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Claim not found or already processed');
  END IF;

  IF v_claim.owner_id IS NOT NULL AND v_claim.owner_id != p_owner_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized');
  END IF;

  -- Lock client row (serialises concurrent confirms for the same client)
  SELECT * INTO v_client FROM aso_clients WHERE id = v_claim.aso_client_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Client not found');
  END IF;

  -- First-deposit check: identical to ajo_record_contribution
  v_is_first := (COALESCE(v_client.total_saved, 0) = 0);
  IF v_is_first THEN
    v_reg_fee := COALESCE(v_client.registration_charge, 0);
  END IF;
  v_net_add := v_claim.amount - v_reg_fee;

  -- Next-contribution-date advance
  v_freq_days := CASE COALESCE(v_client.contribution_frequency, 'monthly')
    WHEN 'daily'  THEN 1
    WHEN 'weekly' THEN 7
    ELSE 30
  END;
  v_base_date := COALESCE(v_client.next_contribution_date, CURRENT_DATE);
  v_next_date := v_base_date + v_freq_days;

  -- Flip claim to completed
  UPDATE ajo_contributions SET
    status          = 'completed',
    paystack_status = 'completed',
    confirmed_by    = p_confirmed_by,
    confirmed_at    = NOW()
  WHERE id = p_claim_id;

  -- Registration fee row (first deposit only)
  IF v_is_first AND v_reg_fee > 0 THEN
    INSERT INTO ajo_contributions (
      aso_client_id, owner_id, amount, type,
      payment_method, status, notes,
      fee_for_contribution_id, paystack_status, initiated_by
    ) VALUES (
      v_claim.aso_client_id, v_claim.owner_id, v_reg_fee, 'registration_fee',
      'manual_transfer', 'completed',
      'Registration fee on first deposit',
      p_claim_id, 'completed', 'staff'
    )
    RETURNING id INTO v_reg_fee_id;
  END IF;

  -- Credit balance (same columns as ajo_record_contribution)
  UPDATE aso_clients SET
    total_saved            = COALESCE(total_saved, 0)    + v_claim.amount,
    current_balance        = COALESCE(current_balance, 0) + v_net_add,
    next_contribution_date = v_next_date
  WHERE id = v_claim.aso_client_id;

  RETURN jsonb_build_object(
    'ok',          true,
    'claim_id',    p_claim_id,
    'client_id',   v_claim.aso_client_id,
    'amount',      v_claim.amount,
    'reg_fee',     v_reg_fee,
    'reg_fee_id',  v_reg_fee_id,
    'new_balance', COALESCE(v_client.current_balance, 0) + v_net_add,
    'next_date',   v_next_date
  );
END;
$$;

GRANT EXECUTE ON FUNCTION ajo_confirm_manual_deposit(uuid, uuid, uuid) TO service_role;

-- ── 5. ajo_reject_manual_claim ────────────────────────────────────────────
-- Marks the claim rejected with a reason. Balance untouched.
-- Row is never deleted — immutability discipline matches Phase 1.
CREATE OR REPLACE FUNCTION ajo_reject_manual_claim(
  p_claim_id uuid,
  p_owner_id uuid,
  p_reason   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim record;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Reason is required (min 3 characters)');
  END IF;

  SELECT * INTO v_claim
  FROM ajo_contributions
  WHERE id             = p_claim_id
    AND status         = 'pending'
    AND payment_method = 'manual_transfer'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Claim not found or already processed');
  END IF;

  IF v_claim.owner_id IS NOT NULL AND v_claim.owner_id != p_owner_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized');
  END IF;

  UPDATE ajo_contributions SET
    status           = 'rejected',
    paystack_status  = 'rejected',
    rejected_reason  = p_reason
  WHERE id = p_claim_id;

  RETURN jsonb_build_object(
    'ok',       true,
    'claim_id', p_claim_id,
    'client_id', v_claim.aso_client_id,
    'amount',   v_claim.amount
  );
END;
$$;

GRANT EXECUTE ON FUNCTION ajo_reject_manual_claim(uuid, uuid, text) TO service_role;
