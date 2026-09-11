-- ═════════════════════════════════════════════════════════════════════════════
-- Self-service "Open New Card" was failing with "Contribution amount is
-- required to open a cycle" whenever the business hadn't set a fixed periodic
-- contribution_amount on the client's aso_clients row. Clients opening their
-- own card should be able to open a flexible one (deposit whatever, whenever
-- — no fixed per-period target) when no amount is configured; owner-created
-- cycles keep the existing hard requirement unchanged.
-- ═════════════════════════════════════════════════════════════════════════════

-- A flexible card has no fixed per-period target — widen the constraint from
-- "> 0" to "0 or more" (never narrows: every existing row already satisfies it).
ALTER TABLE public.ajo_cycles DROP CONSTRAINT IF EXISTS ajo_cycles_expected_amount_per_period_check;
ALTER TABLE public.ajo_cycles ADD CONSTRAINT ajo_cycles_expected_amount_per_period_check
  CHECK (expected_amount_per_period >= 0);

-- Adding a parameter changes the signature — DROP the old 10-arg overload
-- first so callers that omit p_allow_flexible resolve unambiguously to the
-- one function below, instead of Postgres seeing two equally-valid matches.
DROP FUNCTION IF EXISTS public.ajo_open_cycle(UUID, UUID, DATE, INT, NUMERIC, TEXT, TEXT, NUMERIC, BOOLEAN, TEXT);

CREATE OR REPLACE FUNCTION public.ajo_open_cycle(
  p_client_id        UUID,
  p_owner_id         UUID,
  p_start            DATE    DEFAULT NULL,
  p_length           INT     DEFAULT NULL,
  p_amount           NUMERIC DEFAULT NULL,
  p_label            TEXT    DEFAULT NULL,
  p_commission_model TEXT    DEFAULT NULL,
  p_commission_pct   NUMERIC DEFAULT NULL,
  p_force            BOOLEAN DEFAULT false,
  p_frequency        TEXT    DEFAULT NULL,
  p_allow_flexible   BOOLEAN DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  IF (v_amount IS NULL OR v_amount <= 0) THEN
    IF NOT p_allow_flexible THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Contribution amount is required to open a cycle');
    END IF;
    -- Flexible card: no fixed per-period target. Every guard/fullness check
    -- elsewhere already treats expected_amount_per_period = 0 as "uncapped".
    v_amount := 0;
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

REVOKE ALL ON FUNCTION public.ajo_open_cycle(UUID, UUID, DATE, INT, NUMERIC, TEXT, TEXT, NUMERIC, BOOLEAN, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ajo_open_cycle(UUID, UUID, DATE, INT, NUMERIC, TEXT, TEXT, NUMERIC, BOOLEAN, TEXT, BOOLEAN)
  TO service_role;
