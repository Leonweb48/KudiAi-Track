-- Ajo Per-Entity Attribution (Option B)
-- Adds group_id to ajo_contributions and ajo_withdrawal_requests so every
-- deposit and withdrawal is tied to the specific card or group it belongs to.
-- Current-balance write paths and lock functions are UNCHANGED.

-- ── 1. Schema changes ─────────────────────────────────────────────────────

ALTER TABLE ajo_contributions
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES ajo_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ajo_contributions_group_id
  ON ajo_contributions(group_id)
  WHERE group_id IS NOT NULL;

ALTER TABLE ajo_withdrawal_requests
  ADD COLUMN IF NOT EXISTS cycle_id UUID REFERENCES ajo_cycles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES ajo_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ajo_wr_cycle_id
  ON ajo_withdrawal_requests(cycle_id)
  WHERE cycle_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ajo_wr_group_id
  ON ajo_withdrawal_requests(group_id)
  WHERE group_id IS NOT NULL;


-- ── 2. Backfill group_id for unambiguous historical rows ──────────────────
-- A client with exactly ONE active membership of the matching group_mode gets
-- their old contribution rows tagged.  Clients in multiple groups of the same
-- mode are left NULL (ambiguous) and counted below.

WITH single_group AS (
  SELECT
    acgm.client_id,
    acgm.group_id,
    ag.group_mode,
    COUNT(*) OVER (PARTITION BY acgm.client_id, ag.group_mode) AS grp_count
  FROM aso_client_group_memberships acgm
  JOIN ajo_groups ag ON ag.id = acgm.group_id
  WHERE acgm.status = 'active'
)
UPDATE ajo_contributions ac
SET group_id = sg.group_id
FROM single_group sg
WHERE ac.aso_client_id = sg.client_id
  AND ac.group_id IS NULL
  AND sg.grp_count = 1
  AND (
    (ac.contribution_context = 'esusu_rotation' AND sg.group_mode = 'rotating')
    OR (ac.contribution_context = 'group_savings'  AND sg.group_mode = 'savings')
  );


-- ── 3. Report ambiguous rows left NULL ───────────────────────────────────

DO $$
DECLARE v_null INT;
BEGIN
  SELECT COUNT(*) INTO v_null
  FROM ajo_contributions
  WHERE contribution_context IN ('esusu_rotation', 'group_savings')
    AND group_id IS NULL;
  RAISE NOTICE 'Ajo attribution backfill complete. Unattributed group rows remaining: %', v_null;
END $$;


-- ── 4. ajo_record_contribution — add p_group_id ──────────────────────────

DROP FUNCTION IF EXISTS ajo_record_contribution(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, UUID);

CREATE OR REPLACE FUNCTION ajo_record_contribution(
  p_client_id            UUID,
  p_owner_id             UUID,
  p_amount               NUMERIC,
  p_method               TEXT    DEFAULT 'cash',
  p_ref                  TEXT    DEFAULT NULL,
  p_notes                TEXT    DEFAULT NULL,
  p_recorded_by          UUID    DEFAULT NULL,
  p_contribution_context TEXT    DEFAULT 'personal_savings',
  p_source               TEXT    DEFAULT NULL,
  p_cycle_id             UUID    DEFAULT NULL,
  p_group_id             UUID    DEFAULT NULL
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

  INSERT INTO ajo_contributions (
    aso_client_id, owner_id, amount, type,
    payment_method, paystack_ref, status, notes,
    recorded_by, paystack_status, contribution_context, contribution_source,
    cycle_id, group_id
  ) VALUES (
    p_client_id, p_owner_id, p_amount, 'contribution',
    p_method, p_ref, 'pending', p_notes,
    p_recorded_by, 'pending', p_contribution_context, p_source,
    p_cycle_id, p_group_id
  )
  RETURNING id INTO v_contribution_id;

  RETURN jsonb_build_object(
    'ok',              true,
    'contribution_id', v_contribution_id,
    'status',          'pending'
  );
END;
$$;

REVOKE ALL ON FUNCTION ajo_record_contribution(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ajo_record_contribution(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, UUID, UUID)
  TO service_role;


-- ── 5. ajo_submit_manual_claim — add p_group_id ──────────────────────────

DROP FUNCTION IF EXISTS ajo_submit_manual_claim(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID);

CREATE OR REPLACE FUNCTION ajo_submit_manual_claim(
  p_client_id            UUID,
  p_owner_id             UUID,
  p_amount               NUMERIC,
  p_payer_name           TEXT    DEFAULT NULL,
  p_notes                TEXT    DEFAULT NULL,
  p_proof_url            TEXT    DEFAULT NULL,
  p_contribution_context TEXT    DEFAULT 'personal_savings',
  p_cycle_id             UUID    DEFAULT NULL,
  p_group_id             UUID    DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client      RECORD;
  v_pending_cnt INT;
  v_claim_id    UUID;
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
    paystack_status, contribution_context, cycle_id, group_id
  ) VALUES (
    p_client_id, p_owner_id, p_amount, 'contribution',
    'manual_transfer', 'pending', 'client',
    p_payer_name, p_notes, p_proof_url,
    'pending', p_contribution_context, p_cycle_id, p_group_id
  )
  RETURNING id INTO v_claim_id;

  RETURN jsonb_build_object('ok', true, 'claim_id', v_claim_id, 'amount', p_amount);
END;
$$;

REVOKE ALL ON FUNCTION ajo_submit_manual_claim(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ajo_submit_manual_claim(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, UUID)
  TO service_role;


-- ── 6. ajo_approve_contribution — fee rows inherit group_id ──────────────
-- Signature unchanged (3 args). Only the INSERT bodies change: registration_fee
-- and commission rows now carry the parent contribution's group_id.

CREATE OR REPLACE FUNCTION ajo_approve_contribution(
  p_contribution_id UUID,
  p_owner_id        UUID,
  p_approver_id     UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contrib        RECORD;
  v_client         RECORD;
  v_is_first       BOOLEAN;
  v_reg_fee        NUMERIC := 0;
  v_cycle_fee      NUMERIC := 0;
  v_net_add        NUMERIC;
  v_freq_days      INT;
  v_base_date      DATE;
  v_next_date      DATE;
  v_reg_fee_id     UUID;
  v_commission_id  UUID;
  v_cycle_id       UUID;
  v_cycle_expected NUMERIC := 0;
  v_commission_acc NUMERIC := 0;
  v_newly_acc      NUMERIC := 0;
BEGIN
  SELECT * INTO v_contrib
  FROM ajo_contributions
  WHERE id = p_contribution_id AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Contribution not found or already processed');
  END IF;

  IF v_contrib.owner_id IS NOT NULL AND v_contrib.owner_id != p_owner_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized');
  END IF;

  SELECT * INTO v_client FROM aso_clients WHERE id = v_contrib.aso_client_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Client not found');
  END IF;

  v_is_first := NOT EXISTS (
    SELECT 1 FROM ajo_contributions
    WHERE aso_client_id = v_contrib.aso_client_id
      AND status = 'completed'
      AND type   = 'contribution'
  );
  IF v_is_first THEN
    v_reg_fee := COALESCE(v_client.registration_charge, 0);
  END IF;

  v_freq_days := CASE COALESCE(v_client.contribution_frequency, 'monthly')
    WHEN 'daily'  THEN 1
    WHEN 'weekly' THEN 7
    ELSE 30
  END;
  v_base_date := COALESCE(v_client.next_contribution_date, CURRENT_DATE);
  v_next_date := v_base_date + v_freq_days;

  UPDATE ajo_contributions SET
    status          = 'completed',
    paystack_status = 'completed',
    approved_by     = p_approver_id,
    approved_at     = NOW()
  WHERE id = p_contribution_id;

  IF v_is_first AND v_reg_fee > 0 THEN
    INSERT INTO ajo_contributions (
      aso_client_id, owner_id, amount, type,
      payment_method, status, notes,
      fee_for_contribution_id, paystack_status, contribution_context, cycle_id, group_id
    ) VALUES (
      v_contrib.aso_client_id, v_contrib.owner_id, v_reg_fee, 'registration_fee',
      v_contrib.payment_method, 'completed', 'Registration fee on first deposit',
      p_contribution_id, 'completed', v_contrib.contribution_context,
      v_contrib.cycle_id, v_contrib.group_id
    )
    RETURNING id INTO v_reg_fee_id;
  END IF;

  IF COALESCE(v_contrib.contribution_context, 'personal_savings') = 'personal_savings' THEN
    v_cycle_id := v_contrib.cycle_id;

    IF v_cycle_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM ajo_cycles cy
        WHERE cy.id = v_cycle_id
          AND cy.status = 'active'
          AND cy.commission_model = 'first_period'
      ) OR EXISTS (
        SELECT 1 FROM ajo_contributions fc
        WHERE fc.cycle_id = v_cycle_id
          AND fc.type = 'commission'
          AND fc.status = 'completed'
      ) THEN
        v_cycle_id := NULL;
      END IF;
    ELSE
      SELECT c.id INTO v_cycle_id
      FROM ajo_cycles c
      WHERE c.client_id = v_contrib.aso_client_id
        AND c.status = 'active'
        AND c.commission_model = 'first_period'
        AND NOT EXISTS (
          SELECT 1 FROM ajo_contributions fc
          WHERE fc.cycle_id = c.id
            AND fc.type = 'commission'
            AND fc.status = 'completed'
        )
      ORDER BY c.created_at ASC
      LIMIT 1;

      IF v_cycle_id IS NOT NULL THEN
        UPDATE ajo_contributions SET cycle_id = v_cycle_id WHERE id = p_contribution_id;
      END IF;
    END IF;

    IF v_cycle_id IS NOT NULL THEN
      SELECT expected_amount_per_period, COALESCE(commission_balance, 0)
      INTO v_cycle_expected, v_commission_acc
      FROM ajo_cycles WHERE id = v_cycle_id;

      v_newly_acc := v_contrib.amount - v_reg_fee;

      IF v_commission_acc = 0 AND v_newly_acc > 0 THEN
        v_cycle_fee := LEAST(v_newly_acc, v_cycle_expected);
        UPDATE ajo_cycles SET commission_balance = v_cycle_expected WHERE id = v_cycle_id;
        INSERT INTO ajo_contributions (
          aso_client_id, owner_id, amount, type,
          payment_method, status, notes,
          fee_for_contribution_id, paystack_status, contribution_context, cycle_id, group_id
        ) VALUES (
          v_contrib.aso_client_id, v_contrib.owner_id, v_cycle_fee, 'commission',
          v_contrib.payment_method, 'completed', 'Collector''s fee — Day 1',
          p_contribution_id, 'completed', v_contrib.contribution_context,
          v_cycle_id, v_contrib.group_id
        )
        RETURNING id INTO v_commission_id;
      END IF;
    END IF;
  END IF;

  v_net_add := v_contrib.amount - v_reg_fee - v_cycle_fee;

  UPDATE aso_clients SET
    total_saved            = COALESCE(total_saved, 0)     + v_net_add,
    current_balance        = COALESCE(current_balance, 0) + v_net_add,
    next_contribution_date = v_next_date
  WHERE id = v_contrib.aso_client_id;

  RETURN jsonb_build_object(
    'ok',              true,
    'contribution_id', p_contribution_id,
    'client_id',       v_contrib.aso_client_id,
    'amount',          v_contrib.amount,
    'reg_fee',         v_reg_fee,
    'reg_fee_id',      v_reg_fee_id,
    'cycle_fee',       v_cycle_fee,
    'commission_id',   v_commission_id,
    'is_first_cycle',  v_commission_id IS NOT NULL,
    'new_balance',     COALESCE(v_client.current_balance, 0) + v_net_add,
    'next_date',       v_next_date
  );
END;
$$;

REVOKE ALL ON FUNCTION ajo_approve_contribution(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION ajo_approve_contribution(UUID, UUID, UUID) TO service_role;


-- ── 7. ajo_record_withdrawal — stamp cycle_id / group_id on rows ─────────
-- Reads attribution from the withdrawal_request row when p_request_id is
-- provided; falls back to explicit p_cycle_id / p_group_id parameters.
-- Balance logic and lock checks are UNCHANGED.

DROP FUNCTION IF EXISTS public.ajo_record_withdrawal(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, UUID);

CREATE OR REPLACE FUNCTION public.ajo_record_withdrawal(
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
  v_client        RECORD;
  v_esusu_locked  NUMERIC;
  v_cycle_locked  NUMERIC;
  v_withdrawable  NUMERIC;
  v_pct_fee       NUMERIC;
  v_fee_amount    NUMERIC;
  v_net_amount    NUMERIC;
  v_net_id        UUID;
  v_fee_id        UUID;
  v_lock_msg      TEXT;
  v_attr_cycle_id UUID;
  v_attr_group_id UUID;
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

  v_esusu_locked := ajo_locked_esusu_amount(p_client_id);
  v_cycle_locked := ajo_locked_cycle_amount(p_client_id);
  v_withdrawable := COALESCE(v_client.current_balance, 0) - v_esusu_locked - v_cycle_locked;

  IF v_withdrawable < p_gross_amount THEN
    v_lock_msg := CASE
      WHEN v_esusu_locked > 0 AND v_cycle_locked > 0
        THEN '₦' || ROUND(v_esusu_locked, 2) || ' locked in an active esusu round and ₦' || ROUND(v_cycle_locked, 2) || ' locked in an active first-period savings cycle'
      WHEN v_esusu_locked > 0
        THEN '₦' || ROUND(v_esusu_locked, 2) || ' is locked in an active esusu round'
      WHEN v_cycle_locked > 0
        THEN '₦' || ROUND(v_cycle_locked, 2) || ' is locked in an active first-period savings cycle'
      ELSE 'balance too low'
    END;
    RETURN jsonb_build_object(
      'ok',           false,
      'error',        'Insufficient withdrawable balance — ' || v_lock_msg,
      'esusu_locked', v_esusu_locked,
      'cycle_locked', v_cycle_locked,
      'withdrawable', GREATEST(v_withdrawable, 0)
    );
  END IF;

  -- Resolve attribution: request row wins over explicit params
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


-- ── 8. ajo_reverse_contribution — copy group_id from original row ─────────
-- Signature unchanged (3 args). Adds group_id to every reversal INSERT so
-- the entity ledger stays balanced on reversals.

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
    cycle_id, group_id
  ) VALUES (
    v_original.aso_client_id, v_original.owner_id,
    v_original.amount, v_rev_type, v_original.payment_method,
    'completed', 'Reversal: ' || p_reason, p_owner_id,
    v_original.id, 'completed',
    v_original.cycle_id, v_original.group_id
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
        cycle_id, group_id
      ) VALUES (
        v_fee_rows.aso_client_id, v_fee_rows.owner_id,
        v_fee_rows.amount, v_rev_fee_type, v_fee_rows.payment_method,
        'completed', 'Fee reversal: ' || p_reason, p_owner_id,
        v_fee_rows.id, v_rev_net_id, 'completed',
        v_fee_rows.cycle_id, v_fee_rows.group_id
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
        THEN GREATEST(0, COALESCE(total_saved, 0) - (v_original.amount - v_fee_sum))
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
