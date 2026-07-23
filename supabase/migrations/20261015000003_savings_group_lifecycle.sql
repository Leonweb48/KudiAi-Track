-- ─────────────────────────────────────────────────────────────────────────────
-- Savings group lifecycle: target-based rounds, deposit gating, lock release
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Schema: lifecycle columns on ajo_groups ───────────────────────────────
ALTER TABLE public.ajo_groups
  ADD COLUMN IF NOT EXISTS target_amount   NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS target_deadline DATE,
  ADD COLUMN IF NOT EXISTS round_status    TEXT NOT NULL DEFAULT 'not_started'
                                           CHECK (round_status IN ('not_started','active','target_met','closed')),
  ADD COLUMN IF NOT EXISTS started_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by       UUID;

-- ── 2. ajo_locked_group_amount — exclude closed savings rounds ───────────────
-- Savings group contributions are locked while round_status != 'closed'.
-- Closing the group (round_status = 'closed') automatically unlocks all members'
-- funds without writing disbursement rows — Option B: lock is purely derived.
-- group_release rows (written for early single-member exit) subtract from lock.
CREATE OR REPLACE FUNCTION public.ajo_locked_group_amount(p_client_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(COALESCE(
    SUM(
      CASE c.type
        WHEN 'contribution'          THEN  c.amount
        WHEN 'reversal_contribution' THEN -c.amount
        WHEN 'disbursement'          THEN -c.amount
        WHEN 'withdrawal'            THEN -c.amount
        WHEN 'reversal_withdrawal'   THEN  c.amount
        WHEN 'group_release'         THEN -c.amount
        ELSE 0
      END
    ),
    0
  ), 0)
  FROM ajo_contributions c
  WHERE c.aso_client_id = p_client_id
    AND c.status = 'completed'
    AND (
      -- Esusu rotation: always locked (esusu uses its own payout / round-close)
      (c.type IN ('contribution', 'reversal_contribution')
       AND c.contribution_context = 'esusu_rotation')
      OR
      -- Savings group: locked only while the group round is NOT closed
      (c.type IN ('contribution', 'reversal_contribution')
       AND c.contribution_context = 'group_savings'
       AND EXISTS (
         SELECT 1 FROM ajo_groups g
         WHERE g.id = c.group_id
           AND g.round_status != 'closed'
       ))
      OR
      -- Money returned from any group (payout, withdrawal, early release)
      (c.type IN ('disbursement', 'withdrawal', 'reversal_withdrawal', 'group_release')
       AND c.group_id IS NOT NULL)
    );
$$;

REVOKE ALL ON FUNCTION public.ajo_locked_group_amount(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ajo_locked_group_amount(UUID) TO service_role, authenticated;

-- ── 3. ajo_start_savings_round ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ajo_start_savings_round(
  p_owner_id      UUID,
  p_group_id      UUID,
  p_target_amount NUMERIC,
  p_deadline      DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group RECORD;
BEGIN
  SELECT * INTO v_group
  FROM ajo_groups
  WHERE id = p_group_id AND owner_id = p_owner_id AND group_mode = 'savings'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Savings group not found');
  END IF;

  IF v_group.round_status NOT IN ('not_started', 'closed') THEN
    RETURN jsonb_build_object('ok', false, 'error',
      CASE v_group.round_status
        WHEN 'active'     THEN 'This group already has an active round'
        WHEN 'target_met' THEN 'Target met — close the group to release funds before starting a new round'
        ELSE 'Cannot start round in current state'
      END
    );
  END IF;

  IF p_target_amount IS NULL OR p_target_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Target amount must be greater than zero');
  END IF;

  IF p_deadline IS NULL OR p_deadline <= CURRENT_DATE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Deadline must be a future date');
  END IF;

  UPDATE ajo_groups SET
    round_status    = 'active',
    target_amount   = p_target_amount,
    target_deadline = p_deadline,
    started_at      = NOW(),
    closed_at       = NULL,
    closed_by       = NULL
  WHERE id = p_group_id;

  RETURN jsonb_build_object(
    'ok',              true,
    'group_id',        p_group_id,
    'target_amount',   p_target_amount,
    'target_deadline', p_deadline,
    'started_at',      NOW()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ajo_start_savings_round(UUID, UUID, NUMERIC, DATE) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ajo_start_savings_round(UUID, UUID, NUMERIC, DATE) TO service_role;

-- ── 4. ajo_close_savings_round ───────────────────────────────────────────────
-- Setting round_status = 'closed' IS the unlock event — ajo_locked_group_amount
-- skips contributions from closed groups, so all members' funds become
-- withdrawable immediately, with zero balance transfers.
CREATE OR REPLACE FUNCTION public.ajo_close_savings_round(
  p_owner_id UUID,
  p_group_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group    RECORD;
  v_releases JSONB := '[]'::JSONB;
  v_pot      NUMERIC;
  v_cid      UUID;
  v_name     TEXT;
  v_amt      NUMERIC;
BEGIN
  SELECT * INTO v_group
  FROM ajo_groups
  WHERE id = p_group_id AND owner_id = p_owner_id AND group_mode = 'savings'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Savings group not found');
  END IF;

  IF v_group.round_status NOT IN ('active', 'target_met') THEN
    RETURN jsonb_build_object('ok', false, 'error',
      CASE v_group.round_status
        WHEN 'not_started' THEN 'Round has not been started yet'
        WHEN 'closed'      THEN 'Round is already closed'
        ELSE 'Cannot close in current state'
      END
    );
  END IF;

  -- Build per-member release ledger (read-only; for notification payload)
  FOR v_cid, v_name, v_amt IN
    SELECT acgm.client_id, ac.full_name,
      COALESCE((
        SELECT SUM(c2.amount)
        FROM ajo_contributions c2
        WHERE c2.aso_client_id        = acgm.client_id
          AND c2.group_id             = p_group_id
          AND c2.contribution_context = 'group_savings'
          AND c2.type                 = 'contribution'
          AND c2.status               = 'completed'
          AND (v_group.started_at IS NULL OR c2.created_at >= v_group.started_at)
      ), 0)
    FROM aso_client_group_memberships acgm
    JOIN aso_clients ac ON ac.id = acgm.client_id
    WHERE acgm.group_id = p_group_id AND acgm.status = 'active'
  LOOP
    v_releases := v_releases || jsonb_build_array(jsonb_build_object(
      'client_id',       v_cid,
      'client_name',     v_name,
      'released_amount', v_amt
    ));
  END LOOP;

  -- Compute final pot
  SELECT COALESCE(SUM(amount), 0)
  INTO v_pot
  FROM ajo_contributions
  WHERE group_id             = p_group_id
    AND contribution_context = 'group_savings'
    AND type                 = 'contribution'
    AND status               = 'completed'
    AND (v_group.started_at IS NULL OR created_at >= v_group.started_at);

  -- Close the round — this is the unlock; no balance writes needed
  UPDATE ajo_groups SET
    round_status = 'closed',
    closed_at    = NOW(),
    closed_by    = p_owner_id
  WHERE id = p_group_id;

  RETURN jsonb_build_object(
    'ok',        true,
    'group_id',  p_group_id,
    'pot_total', v_pot,
    'closed_at', NOW(),
    'releases',  v_releases
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ajo_close_savings_round(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ajo_close_savings_round(UUID, UUID) TO service_role;

-- ── 5. ajo_release_savings_member ───────────────────────────────────────────
-- Early exit: owner releases a single member while the group round is active.
-- Writes a group_release row so ajo_locked_group_amount nets to 0 for this
-- client + group pair. Does NOT update current_balance (funds already credited).
CREATE OR REPLACE FUNCTION public.ajo_release_savings_member(
  p_owner_id  UUID,
  p_group_id  UUID,
  p_client_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group  RECORD;
  v_mem    RECORD;
  v_amount NUMERIC;
BEGIN
  SELECT * INTO v_group
  FROM ajo_groups
  WHERE id = p_group_id AND owner_id = p_owner_id AND group_mode = 'savings'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Savings group not found');
  END IF;

  IF v_group.round_status NOT IN ('active', 'target_met') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Group round is not active');
  END IF;

  SELECT * INTO v_mem
  FROM aso_client_group_memberships
  WHERE group_id = p_group_id AND client_id = p_client_id AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Member not found in this group');
  END IF;

  -- Member's total contributions for the current round
  SELECT COALESCE(SUM(amount), 0)
  INTO v_amount
  FROM ajo_contributions
  WHERE aso_client_id        = p_client_id
    AND group_id             = p_group_id
    AND contribution_context = 'group_savings'
    AND type                 = 'contribution'
    AND status               = 'completed'
    AND (v_group.started_at IS NULL OR created_at >= v_group.started_at);

  -- group_release row zeros the lock for this member + group (no balance change)
  IF v_amount > 0 THEN
    INSERT INTO ajo_contributions (
      aso_client_id, owner_id, amount, type,
      payment_method, status, notes,
      contribution_context, group_id, paystack_status
    ) VALUES (
      p_client_id, p_owner_id, v_amount, 'group_release',
      'internal', 'completed', 'Released from savings group by owner',
      'group_savings', p_group_id, 'completed'
    );
  END IF;

  -- Remove from active roster
  UPDATE aso_client_group_memberships
  SET status = 'inactive'
  WHERE group_id = p_group_id AND client_id = p_client_id;

  RETURN jsonb_build_object(
    'ok',              true,
    'client_id',       p_client_id,
    'group_id',        p_group_id,
    'released_amount', v_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ajo_release_savings_member(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ajo_release_savings_member(UUID, UUID, UUID) TO service_role;

-- ── 6. Trigger: target_met auto-flip ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ajo_check_target_met()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group RECORD;
  v_pot   NUMERIC;
BEGIN
  -- Only fire on completed group_savings contributions
  IF NEW.status != 'completed'
     OR COALESCE(NEW.contribution_context, 'personal_savings') != 'group_savings'
     OR NEW.type != 'contribution'
     OR NEW.group_id IS NULL
  THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_group FROM ajo_groups WHERE id = NEW.group_id;
  IF NOT FOUND OR v_group.round_status != 'active' OR v_group.target_amount IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_pot
  FROM ajo_contributions
  WHERE group_id             = NEW.group_id
    AND contribution_context = 'group_savings'
    AND type                 = 'contribution'
    AND status               = 'completed'
    AND (v_group.started_at IS NULL OR created_at >= v_group.started_at);

  IF v_pot >= v_group.target_amount THEN
    UPDATE ajo_groups
    SET round_status = 'target_met'
    WHERE id = NEW.group_id AND round_status = 'active';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ajo_target_met_trigger ON ajo_contributions;
CREATE TRIGGER ajo_target_met_trigger
  AFTER INSERT OR UPDATE OF status ON ajo_contributions
  FOR EACH ROW EXECUTE FUNCTION public.ajo_check_target_met();

-- ── 7. Structural invariant checks (no live data required) ──────────────────
DO $$
DECLARE
  v_col_exists    BOOLEAN;
  v_check_fired   BOOLEAN := false;
  v_lock_zero     NUMERIC;
BEGIN
  -- 7A: Columns present
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ajo_groups' AND column_name = 'round_status'
  ) INTO v_col_exists;
  ASSERT v_col_exists, 'FAIL 7A: round_status column missing';

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ajo_groups' AND column_name = 'target_amount'
  ) INTO v_col_exists;
  ASSERT v_col_exists, 'FAIL 7A: target_amount column missing';

  -- 7B: CHECK constraint rejects invalid round_status
  BEGIN
    INSERT INTO ajo_groups (owner_id, name, group_mode, round_status)
    VALUES (gen_random_uuid(), '__constraint_test__', 'savings', 'bad_state');
  EXCEPTION
    WHEN check_violation THEN v_check_fired := true;
  END;
  ASSERT v_check_fired, 'FAIL 7B: round_status CHECK constraint did not reject invalid value';

  -- 7C: Lock function returns 0 for unknown client
  SELECT ajo_locked_group_amount(gen_random_uuid()) INTO v_lock_zero;
  ASSERT v_lock_zero = 0, 'FAIL 7C: ajo_locked_group_amount did not return 0 for unknown client';

  RAISE NOTICE 'Migration 20261015000003 — all structural invariants pass';
END;
$$;
