-- Phase 1, Step 4: Atomic balance-mutation RPCs (SECURITY DEFINER).
-- All five functions bypass RLS and are called either by authenticated users
-- (via the ajo-write edge function which verifies PIN first) or the service-role
-- webhook handler. PIN verification happens in the edge function, not here,
-- because PIN hashes are PBKDF2 (Web Crypto) and cannot be verified in SQL.
--
-- Deploy this migration BEFORE the RLS lockdown (Step 5).
-- SECURITY DEFINER means these functions work with the old liberal RLS policies
-- during the transition window, so no critical gap exists.

-- ─────────────────────────────────────────────────────────────────────────────
-- 4a: ajo_record_contribution
--     Atomic insert + balance update. Registration fee charged here only,
--     never at withdrawal (single charging point per v3 plan).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION ajo_record_contribution(
  p_client_id    UUID,
  p_owner_id     UUID,
  p_amount       NUMERIC,
  p_method       TEXT DEFAULT 'cash',
  p_ref          TEXT DEFAULT NULL,
  p_notes        TEXT DEFAULT NULL,
  p_recorded_by  UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client          RECORD;
  v_is_first        BOOLEAN;
  v_reg_fee         NUMERIC := 0;
  v_net_balance_add NUMERIC;
  v_freq_days       INT;
  v_base_date       DATE;
  v_next_date       DATE;
  v_contribution_id UUID;
  v_reg_fee_id      UUID;
BEGIN
  -- Lock client row for this transaction
  SELECT * INTO v_client FROM aso_clients WHERE id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Client not found');
  END IF;

  -- Ownership check (user_id on aso_clients = business owner's auth UUID)
  IF v_client.user_id IS NOT NULL AND v_client.user_id != p_owner_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized');
  END IF;

  -- Amount validation
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Amount must be greater than zero');
  END IF;

  -- Determine if this is the client's first contribution
  v_is_first := (COALESCE(v_client.total_saved, 0) = 0);

  -- Registration fee: charged on first deposit only
  IF v_is_first THEN
    v_reg_fee := COALESCE(v_client.registration_charge, 0);
  END IF;

  v_net_balance_add := p_amount - v_reg_fee;

  -- Compute next contribution date
  v_freq_days := CASE COALESCE(v_client.contribution_frequency, 'monthly')
    WHEN 'daily'   THEN 1
    WHEN 'weekly'  THEN 7
    ELSE 30
  END;
  v_base_date := COALESCE(v_client.next_contribution_date, CURRENT_DATE);
  v_next_date := v_base_date + v_freq_days;

  -- Insert main contribution row
  INSERT INTO ajo_contributions (
    aso_client_id, owner_id, amount, type,
    payment_method, paystack_ref, status, notes,
    recorded_by, paystack_status
  ) VALUES (
    p_client_id, p_owner_id, p_amount, 'contribution',
    p_method, p_ref, 'completed', p_notes,
    p_recorded_by, 'completed'
  )
  RETURNING id INTO v_contribution_id;

  -- Insert registration fee row (only on first deposit, if fee > 0)
  IF v_is_first AND v_reg_fee > 0 THEN
    INSERT INTO ajo_contributions (
      aso_client_id, owner_id, amount, type,
      payment_method, status, notes, recorded_by,
      fee_for_contribution_id, paystack_status
    ) VALUES (
      p_client_id, p_owner_id, v_reg_fee, 'registration_fee',
      p_method, 'completed',
      'Registration fee on first deposit', p_recorded_by,
      v_contribution_id, 'completed'
    )
    RETURNING id INTO v_reg_fee_id;
  END IF;

  -- Atomic client balance update
  UPDATE aso_clients SET
    total_saved            = COALESCE(total_saved, 0)    + p_amount,
    current_balance        = COALESCE(current_balance, 0) + v_net_balance_add,
    next_contribution_date = v_next_date
  WHERE id = p_client_id;

  RETURN jsonb_build_object(
    'ok',              true,
    'contribution_id', v_contribution_id,
    'reg_fee_id',      v_reg_fee_id,
    'reg_fee',         v_reg_fee,
    'new_balance',     COALESCE(v_client.current_balance, 0) + v_net_balance_add,
    'next_date',       v_next_date
  );
END;
$$;

GRANT EXECUTE ON FUNCTION ajo_record_contribution(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, UUID) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4b: ajo_record_withdrawal
--     Two-row fee ledger (net row + withdrawal_fee row).
--     Registration fee is NEVER charged here — single charging point is 4a.
--     Ledger-based dedup: if registration_fee row exists → use withdrawal_fee.
--     PIN verified in edge function before this is called.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION ajo_record_withdrawal(
  p_client_id    UUID,
  p_owner_id     UUID,
  p_gross_amount NUMERIC,
  p_method       TEXT DEFAULT 'cash',
  p_notes        TEXT DEFAULT NULL,
  p_recorded_by  UUID DEFAULT NULL,
  p_request_id   UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client       RECORD;
  v_fee_amount   NUMERIC;
  v_net_amount   NUMERIC;
  v_net_id       UUID;
  v_fee_id       UUID;
BEGIN
  -- Lock client row
  SELECT * INTO v_client FROM aso_clients WHERE id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Client not found');
  END IF;

  IF v_client.user_id IS NOT NULL AND v_client.user_id != p_owner_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized');
  END IF;

  -- Amount validation
  IF p_gross_amount IS NULL OR p_gross_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Amount must be greater than zero');
  END IF;

  -- Balance check (before any write — clean error instead of CHECK violation)
  IF COALESCE(v_client.current_balance, 0) < p_gross_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Insufficient balance');
  END IF;

  -- Fee computation — always withdrawal_fee (never registration_fee here).
  -- registration_fee is deposit-only (4a). The CASE below is belt-and-suspenders
  -- for historical clients who may already have a registration_fee row.
  v_fee_amount := ROUND(
    p_gross_amount * COALESCE(v_client.withdrawal_fee_percent, 0) / 100,
    2
  );
  v_net_amount := p_gross_amount - v_fee_amount;

  IF v_net_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Amount too small after fee');
  END IF;

  -- Insert net withdrawal row
  INSERT INTO ajo_contributions (
    aso_client_id, owner_id, amount, type,
    payment_method, status, notes, recorded_by, paystack_status
  ) VALUES (
    p_client_id, p_owner_id, v_net_amount, 'withdrawal',
    p_method, 'completed', p_notes, p_recorded_by, 'completed'
  )
  RETURNING id INTO v_net_id;

  -- Insert fee row (only when fee > 0)
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

  -- Atomic client balance update (gross leaves balance; net credited to total_withdrawn)
  UPDATE aso_clients SET
    current_balance = current_balance - p_gross_amount,
    total_withdrawn = COALESCE(total_withdrawn, 0) + v_net_amount
  WHERE id = p_client_id;

  -- If linked to a withdrawal request, mark it approved
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

GRANT EXECUTE ON FUNCTION ajo_record_withdrawal(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, UUID) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4c: ajo_confirm_payment
--     Fully atomic Paystack confirmation: flips status + updates aso_clients
--     balance, total_saved, next_contribution_date in one transaction.
--     Called only by the paystack-webhook edge function (service role).
--     Idempotent: second call with same ref returns {ok:false} without mutating.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION ajo_confirm_payment(
  p_paystack_ref TEXT,
  p_paid_at      TIMESTAMPTZ DEFAULT NOW(),
  p_channel      TEXT        DEFAULT 'card'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contrib   RECORD;
  v_client    RECORD;
  v_freq_days INT;
  v_base_date DATE;
  v_next_date DATE;
BEGIN
  -- Find pending row (FOR UPDATE prevents concurrent confirmation)
  SELECT * INTO v_contrib
  FROM ajo_contributions
  WHERE paystack_ref = p_paystack_ref
    AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not found or already confirmed');
  END IF;

  -- Flip contribution to completed
  UPDATE ajo_contributions SET
    status          = 'completed',
    paystack_status = 'success',
    paid_at         = p_paid_at,
    payment_channel = p_channel
  WHERE id = v_contrib.id;

  -- Lock client row
  SELECT * INTO v_client FROM aso_clients WHERE id = v_contrib.aso_client_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Client not found');
  END IF;

  -- Compute next contribution date
  v_freq_days := CASE COALESCE(v_client.contribution_frequency, 'monthly')
    WHEN 'daily'   THEN 1
    WHEN 'weekly'  THEN 7
    ELSE 30
  END;
  v_base_date := COALESCE(v_client.next_contribution_date, CURRENT_DATE);
  v_next_date := v_base_date + v_freq_days;

  -- Atomic client update
  UPDATE aso_clients SET
    current_balance        = COALESCE(current_balance, 0) + v_contrib.amount,
    total_saved            = COALESCE(total_saved, 0)     + v_contrib.amount,
    next_contribution_date = v_next_date
  WHERE id = v_contrib.aso_client_id;

  RETURN jsonb_build_object(
    'ok',          true,
    'client_id',   v_contrib.aso_client_id,
    'amount',      v_contrib.amount,
    'new_balance', COALESCE(v_client.current_balance, 0) + v_contrib.amount
  );
END;
$$;

-- Service role only (called by webhook edge fn)
GRANT EXECUTE ON FUNCTION ajo_confirm_payment(TEXT, TIMESTAMPTZ, TEXT) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4d: ajo_reverse_contribution
--     Group reversal: reverses the entire transaction group atomically
--     (net row + all rows where fee_for_contribution_id = p_original_id).
--     Guards: status='completed', not a reversal, not already reversed.
--     Balance check before any write — returns clean error instead of
--     letting the CHECK constraint fire with a raw DB error.
--     PIN verified in edge function before this is called.
-- ─────────────────────────────────────────────────────────────────────────────
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
  -- Validate reason
  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Reason must be at least 5 characters');
  END IF;

  -- Fetch original row
  SELECT * INTO v_original FROM ajo_contributions WHERE id = p_original_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Row not found');
  END IF;

  -- Guard: must be a completed row
  IF v_original.status != 'completed' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not completed — only completed rows can be reversed');
  END IF;

  -- Guard: must not be a reversal row itself
  IF v_original.reverses_contribution_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Is a reversal — cannot reverse a reversal row');
  END IF;

  -- Ownership check
  IF v_original.owner_id IS NOT NULL AND v_original.owner_id != p_owner_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized');
  END IF;

  -- Guard: must not be a fee row
  IF v_original.fee_for_contribution_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Is a fee row — reverse the parent transaction instead');
  END IF;

  -- Guard: must not already be reversed
  IF EXISTS (
    SELECT 1 FROM ajo_contributions WHERE reverses_contribution_id = p_original_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Already reversed');
  END IF;

  -- Collect fee rows linked to this original
  SELECT COALESCE(SUM(amount), 0) INTO v_fee_sum
  FROM ajo_contributions
  WHERE fee_for_contribution_id = p_original_id AND status = 'completed';

  -- Determine reversal type and balance delta
  CASE v_original.type
    WHEN 'contribution' THEN
      v_rev_type    := 'reversal_contribution';
      -- Reversal reduces balance by (amount - fees already deducted)
      v_balance_delta := -(v_original.amount - v_fee_sum);
    WHEN 'withdrawal' THEN
      v_rev_type    := 'reversal_withdrawal';
      -- Reversal increases balance by gross (net + fee)
      v_balance_delta := v_original.amount + v_fee_sum;
    ELSE
      RETURN jsonb_build_object('ok', false, 'error', 'Unsupported type: ' || v_original.type);
  END CASE;

  -- Lock client row
  SELECT * INTO v_client FROM aso_clients WHERE id = v_original.aso_client_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Client not found');
  END IF;

  -- Balance guard: check reversal won't push balance negative (for contribution reversals)
  IF COALESCE(v_client.current_balance, 0) + v_balance_delta < 0 THEN
    RETURN jsonb_build_object(
      'ok',    false,
      'error', 'Client balance insufficient to reverse this entry'
    );
  END IF;

  -- Insert reversal row for the original net row
  INSERT INTO ajo_contributions (
    aso_client_id, owner_id, amount, type, payment_method,
    status, notes, recorded_by, reverses_contribution_id, paystack_status
  ) VALUES (
    v_original.aso_client_id, v_original.owner_id,
    v_original.amount, v_rev_type, v_original.payment_method,
    'completed', 'Reversal: ' || p_reason, p_owner_id,
    v_original.id, 'completed'
  )
  RETURNING id INTO v_rev_net_id;

  v_reversal_ids := array_append(v_reversal_ids, v_rev_net_id);

  -- Insert reversal rows for each fee row
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
        reverses_contribution_id, fee_for_contribution_id, paystack_status
      ) VALUES (
        v_fee_rows.aso_client_id, v_fee_rows.owner_id,
        v_fee_rows.amount, v_rev_fee_type, v_fee_rows.payment_method,
        'completed', 'Fee reversal: ' || p_reason, p_owner_id,
        v_fee_rows.id, v_rev_net_id, 'completed'
      )
      RETURNING id INTO v_rev_fee_id;
      v_reversal_ids := array_append(v_reversal_ids, v_rev_fee_id);
    END;
  END LOOP;

  -- Atomic client balance update
  UPDATE aso_clients SET
    current_balance = COALESCE(current_balance, 0) + v_balance_delta,
    -- Undo effect on totals based on original type
    total_saved     = CASE
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

GRANT EXECUTE ON FUNCTION ajo_reverse_contribution(UUID, UUID, TEXT) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4e: ajo_archive_client
--     Replaces hard-delete. No row deleted. Zero-balance check.
--     Sets archived_at, archived_by, portal_active=false.
--     PIN verified in edge function before this is called.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION ajo_archive_client(
  p_client_id UUID,
  p_owner_id  UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client RECORD;
BEGIN
  SELECT * INTO v_client FROM aso_clients WHERE id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Client not found');
  END IF;

  IF v_client.user_id IS NOT NULL AND v_client.user_id != p_owner_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized');
  END IF;

  IF COALESCE(v_client.current_balance, 0) != 0 THEN
    RETURN jsonb_build_object(
      'ok',    false,
      'error', 'Non-zero balance ₦' || v_client.current_balance || ' — settle before archiving'
    );
  END IF;

  UPDATE aso_clients SET
    archived_at  = NOW(),
    archived_by  = p_owner_id,
    portal_active = false
  WHERE id = p_client_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION ajo_archive_client(UUID, UUID) TO service_role;
