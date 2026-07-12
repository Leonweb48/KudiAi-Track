-- ── Esusu enhancements: balance credit, debt tracking, trigger-based clearing ──

-- 1. ajo_esusu_debts — outstanding contributions at payout time
CREATE TABLE IF NOT EXISTS ajo_esusu_debts (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id                UUID        NOT NULL REFERENCES ajo_groups(id)        ON DELETE CASCADE,
  round_id                UUID        NOT NULL REFERENCES ajo_group_rounds(id)  ON DELETE CASCADE,
  turn_id                 UUID        NOT NULL REFERENCES ajo_group_turns(id)   ON DELETE CASCADE,
  debtor_client_id        UUID        NOT NULL REFERENCES aso_clients(id)       ON DELETE CASCADE,
  amount                  NUMERIC(12,2) NOT NULL,
  status                  TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'cleared')),
  cleared_at              TIMESTAMPTZ,
  cleared_contribution_id UUID        REFERENCES ajo_contributions(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ajo_esusu_debts_client
  ON ajo_esusu_debts (debtor_client_id, status);
CREATE INDEX IF NOT EXISTS idx_ajo_esusu_debts_round
  ON ajo_esusu_debts (round_id, status);
CREATE INDEX IF NOT EXISTS idx_ajo_esusu_debts_turn
  ON ajo_esusu_debts (turn_id);

-- 2. Trigger: auto-clear pending debts whenever a contribution row becomes completed.
--    Covers all paths: ajo_record_contribution (INSERT), ajo_confirm_payment (UPDATE),
--    ajo_confirm_manual_deposit (UPDATE) — no RPC changes needed for those.
CREATE OR REPLACE FUNCTION ajo_clear_esusu_debts_fn()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.type = 'contribution' AND NEW.status = 'completed'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'completed')
  THEN
    UPDATE ajo_esusu_debts
      SET status                  = 'cleared',
          cleared_at              = NOW(),
          cleared_contribution_id = NEW.id
      WHERE debtor_client_id = NEW.aso_client_id
        AND status            = 'pending'
        AND EXISTS (
          SELECT 1 FROM ajo_group_rounds r
          WHERE r.id = ajo_esusu_debts.round_id AND r.status = 'active'
        );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ajo_clear_debts_trigger ON ajo_contributions;
CREATE TRIGGER ajo_clear_debts_trigger
  AFTER INSERT OR UPDATE OF status ON ajo_contributions
  FOR EACH ROW EXECUTE FUNCTION ajo_clear_esusu_debts_fn();

-- 3. Updated ajo_execute_payout:
--    • Credits beneficiary's current_balance + total_saved
--    • Records pending debts for members who haven't contributed since period_start
--    • Returns debtors array + debtor_count
--    • Owner can still force a payout regardless (debt is a record, not a blocker)
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
  v_pot            NUMERIC(12,2);
  v_payout_id      UUID;
  v_next_id        UUID;
  v_member_ids     UUID[];
  v_member_rec     RECORD;
  v_member_contrib NUMERIC(12,2);
  v_debt_amount    NUMERIC(12,2);
  v_debtors        JSONB := '[]'::JSONB;
  v_debtor_count   INT   := 0;
BEGIN
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

  -- All group member IDs
  SELECT ARRAY_AGG(id) INTO v_member_ids
    FROM aso_clients WHERE ajo_group_id = v_group_id;

  -- Pot = sum of completed contributions since period_start
  SELECT COALESCE(SUM(amount), 0) INTO v_pot
    FROM ajo_contributions
    WHERE aso_client_id = ANY(v_member_ids)
      AND type   = 'contribution'
      AND status = 'completed'
      AND created_at >= v_turn.period_start;

  -- Identify members who haven't contributed; record pending debts
  FOR v_member_rec IN
    SELECT c.id,
           c.full_name,
           c.email,
           COALESCE(c.contribution_amount, 0) AS contribution_amount
    FROM aso_clients c
    WHERE c.ajo_group_id = v_group_id
  LOOP
    CONTINUE WHEN v_member_rec.contribution_amount <= 0;

    SELECT COALESCE(SUM(amount), 0) INTO v_member_contrib
      FROM ajo_contributions
      WHERE aso_client_id = v_member_rec.id
        AND type   = 'contribution'
        AND status = 'completed'
        AND created_at >= v_turn.period_start;

    v_debt_amount := v_member_rec.contribution_amount - v_member_contrib;
    CONTINUE WHEN v_debt_amount <= 0;

    -- Idempotent: skip if debt already exists for this turn + member
    IF NOT EXISTS (
      SELECT 1 FROM ajo_esusu_debts
      WHERE turn_id         = p_turn_id
        AND debtor_client_id = v_member_rec.id
        AND status           = 'pending'
    ) THEN
      INSERT INTO ajo_esusu_debts (group_id, round_id, turn_id, debtor_client_id, amount)
      VALUES (v_group_id, v_turn.round_id, p_turn_id, v_member_rec.id, v_debt_amount);
    END IF;

    v_debtor_count := v_debtor_count + 1;
    v_debtors := v_debtors || jsonb_build_array(jsonb_build_object(
      'client_id',   v_member_rec.id,
      'client_name',  v_member_rec.full_name,
      'client_email', v_member_rec.email,
      'amount_owed',  v_debt_amount
    ));
  END LOOP;

  -- Record payout as an entry in beneficiary's contribution history
  INSERT INTO ajo_contributions (
    aso_client_id, owner_id, amount, type, payment_method, status, notes, paystack_status
  ) VALUES (
    v_turn.client_id, p_owner_id, v_pot, 'esusu_payout', 'group_rotation', 'completed',
    'Esusu pot payout — Round ' || v_round_number || ', Position ' || v_turn.position,
    'completed'
  ) RETURNING id INTO v_payout_id;

  -- Credit beneficiary's personal savings balance
  UPDATE aso_clients SET
    current_balance = COALESCE(current_balance, 0) + v_pot,
    total_saved     = COALESCE(total_saved, 0)     + v_pot
  WHERE id = v_turn.client_id;

  -- Mark turn paid
  UPDATE ajo_group_turns
    SET status = 'paid', payout_contribution_id = v_payout_id
    WHERE id = p_turn_id;

  -- Activate next upcoming turn
  SELECT id INTO v_next_id
    FROM ajo_group_turns
    WHERE round_id = v_turn.round_id AND status = 'upcoming'
    ORDER BY position ASC LIMIT 1;

  IF v_next_id IS NOT NULL THEN
    UPDATE ajo_group_turns SET status = 'current', period_start = NOW()
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
    'round_complete',        (v_next_id IS NULL),
    'debtors',               v_debtors,
    'debtor_count',          v_debtor_count
  );
END;
$$;

REVOKE ALL ON FUNCTION ajo_execute_payout(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION ajo_execute_payout(UUID, UUID) TO service_role;
