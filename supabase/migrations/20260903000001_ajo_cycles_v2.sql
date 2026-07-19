-- Cycles v2: per-cycle purpose uniqueness, frequency column,
-- ajo_locked_cycle_amount helper, and a new ajo_open_cycle that defaults
-- start_date to CURRENT_DATE (never registration_date) and validates the purpose.
--
-- Part 1: Fix cycle creation — no more silent clone of registration_date; purpose required + unique.
-- Part 2 (schema): frequency stored on each cycle; commission_model/percent already snapshotted.
-- Part 3 (lock helper): ajo_locked_cycle_amount — net savings locked in active first_period cycles.


-- ── 1. frequency column ────────────────────────────────────────────────────────
ALTER TABLE ajo_cycles ADD COLUMN IF NOT EXISTS frequency TEXT NOT NULL DEFAULT 'monthly';

-- Backfill from the client's contribution_frequency
UPDATE ajo_cycles c
   SET frequency = COALESCE(cl.contribution_frequency, 'monthly')
  FROM aso_clients cl
 WHERE cl.id = c.client_id;

ALTER TABLE ajo_cycles
  ADD CONSTRAINT ajo_cycles_frequency_check
  CHECK (frequency IN ('daily', 'weekly', 'monthly'));


-- ── 2. label: backfill nulls, make NOT NULL, partial-unique index ──────────────
-- Backfill any null/empty labels before making the column NOT NULL.
UPDATE ajo_cycles SET label = 'Personal Savings' WHERE label IS NULL OR TRIM(label) = '';

ALTER TABLE ajo_cycles ALTER COLUMN label SET NOT NULL;
ALTER TABLE ajo_cycles ALTER COLUMN label SET DEFAULT 'Personal Savings';

-- One active cycle per purpose per client: unique on LOWER(TRIM(label)) among active cycles.
-- Once a cycle completes, the same purpose can be reused for the next cycle.
CREATE UNIQUE INDEX IF NOT EXISTS ajo_cycles_one_active_per_purpose
  ON ajo_cycles (client_id, LOWER(TRIM(label)))
 WHERE status = 'active';


-- ── 3. ajo_locked_cycle_amount — net balance locked in active first_period cycles ──
-- A first_period cycle locks all the savings attributed to it until the cycle completes.
-- The locked amount = SUM(completed contributions) - SUM(commission rows)
-- for contributions/commissions where cycle_id ∈ active first_period cycles.
-- This stacks with ajo_locked_esusu_amount in withdrawal gates.
CREATE OR REPLACE FUNCTION public.ajo_locked_cycle_amount(p_client_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    SUM(CASE WHEN c.type = 'contribution' THEN  c.amount ELSE 0 END)
    - SUM(CASE WHEN c.type = 'commission'  THEN  c.amount ELSE 0 END),
    0
  )
  FROM ajo_contributions c
  JOIN ajo_cycles cy ON cy.id = c.cycle_id
  WHERE c.aso_client_id = p_client_id
    AND c.status = 'completed'
    AND c.type IN ('contribution', 'commission')
    AND cy.status = 'active'
    AND cy.commission_model = 'first_period';
$$;

REVOKE EXECUTE ON FUNCTION public.ajo_locked_cycle_amount(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ajo_locked_cycle_amount(UUID)
  TO service_role, authenticated;


-- ── 4. New ajo_open_cycle — adds p_frequency, defaults start to CURRENT_DATE ──
-- Key fix: p_start now defaults to CURRENT_DATE, not registration_date.
-- registration_date was correct for cycle #1 but wrong for all subsequent cycles.
-- The caller can still pass an explicit p_start if needed (e.g. owner backdating).
-- Adds purpose-uniqueness guard via unique_violation catch.

DROP FUNCTION IF EXISTS ajo_open_cycle(UUID, UUID, DATE, INT, NUMERIC, TEXT, TEXT, NUMERIC, BOOLEAN);

CREATE OR REPLACE FUNCTION ajo_open_cycle(
  p_client_id        UUID,
  p_owner_id         UUID,
  p_start            DATE    DEFAULT NULL,
  p_length           INT     DEFAULT NULL,
  p_amount           NUMERIC DEFAULT NULL,
  p_label            TEXT    DEFAULT NULL,
  p_commission_model TEXT    DEFAULT NULL,
  p_commission_pct   NUMERIC DEFAULT NULL,
  p_force            BOOLEAN DEFAULT FALSE,
  p_frequency        TEXT    DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_client            aso_clients%ROWTYPE;
  v_start             DATE;
  v_length            INT;
  v_amount            NUMERIC;
  v_commission_model  TEXT;
  v_commission_pct    NUMERIC;
  v_frequency         TEXT;
  v_label             TEXT;
  v_cycle_id          UUID;
  v_conflict_notice   TEXT := NULL;
BEGIN
  SELECT * INTO v_client FROM aso_clients WHERE id = p_client_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Client not found');
  END IF;
  IF v_client.user_id != p_owner_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized');
  END IF;
  IF v_client.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Client is archived');
  END IF;

  v_frequency        := COALESCE(NULLIF(TRIM(p_frequency), ''), v_client.contribution_frequency, 'monthly');
  -- Default start to TODAY — registration_date was the previous default; it is wrong for cycles 2+.
  v_start            := COALESCE(p_start, CURRENT_DATE);
  v_length           := COALESCE(p_length,
    CASE v_frequency
      WHEN 'daily'   THEN 31
      WHEN 'weekly'  THEN 5
      WHEN 'monthly' THEN 12
      ELSE 12
    END);
  v_amount           := COALESCE(p_amount, v_client.contribution_amount);
  v_commission_model := COALESCE(NULLIF(TRIM(p_commission_model), ''), v_client.commission_model, 'none');
  v_commission_pct   := COALESCE(p_commission_pct, v_client.commission_percent);
  v_label            := COALESCE(NULLIF(TRIM(p_label), ''), 'Personal Savings');

  IF v_amount IS NULL OR v_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Contribution amount is required to open a cycle');
  END IF;

  IF v_commission_model = 'first_period'
     AND COALESCE(v_client.registration_charge, 0) > 0
  THEN
    v_conflict_notice := 'REG_FEE_AND_FIRST_PERIOD';
  END IF;

  BEGIN
    INSERT INTO ajo_cycles
      (client_id, owner_id, start_date, length_periods, expected_amount_per_period,
       status, label, frequency, commission_model, commission_percent)
    VALUES
      (p_client_id, p_owner_id, v_start, v_length, v_amount,
       'active', v_label, v_frequency, v_commission_model, v_commission_pct)
    RETURNING id INTO v_cycle_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'ok',    false,
      'error', 'A cycle called "' || v_label || '" is already active for this client — choose a different purpose name.'
    );
  END;

  RETURN jsonb_build_object(
    'ok',                         true,
    'cycle_id',                   v_cycle_id,
    'start_date',                 v_start,
    'length_periods',             v_length,
    'expected_amount_per_period', v_amount,
    'frequency',                  v_frequency,
    'commission_model',           v_commission_model,
    'commission_percent',         v_commission_pct,
    'conflict_notice',            v_conflict_notice
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION ajo_open_cycle(UUID, UUID, DATE, INT, NUMERIC, TEXT, TEXT, NUMERIC, BOOLEAN, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION ajo_open_cycle(UUID, UUID, DATE, INT, NUMERIC, TEXT, TEXT, NUMERIC, BOOLEAN, TEXT)
  TO service_role;
