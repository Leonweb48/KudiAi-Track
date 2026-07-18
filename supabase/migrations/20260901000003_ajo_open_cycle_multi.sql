-- Allow a client to open additional saving cycles while one is already active.
-- The one-active-cycle guard is removed; the unique index was already dropped in
-- 20260901000001_ajo_multi_membership.
CREATE OR REPLACE FUNCTION ajo_open_cycle(
  p_client_id        UUID,
  p_owner_id         UUID,
  p_start            DATE    DEFAULT NULL,
  p_length           INT     DEFAULT NULL,
  p_amount           NUMERIC DEFAULT NULL,
  p_label            TEXT    DEFAULT NULL,
  p_commission_model TEXT    DEFAULT NULL,
  p_commission_pct   NUMERIC DEFAULT NULL,
  p_force            BOOLEAN DEFAULT FALSE
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
  v_cycle_id          UUID;
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

  -- NOTE: one-active-cycle guard intentionally removed — clients may run
  -- multiple saving cycles in parallel (house, car, school, etc.).

  v_start  := COALESCE(p_start, v_client.registration_date, CURRENT_DATE);
  v_length := COALESCE(p_length,
    CASE v_client.contribution_frequency
      WHEN 'daily'   THEN 31
      WHEN 'weekly'  THEN 5
      WHEN 'monthly' THEN 12
      ELSE 31
    END);
  v_amount           := COALESCE(p_amount,            v_client.contribution_amount);
  v_commission_model := COALESCE(p_commission_model,  v_client.commission_model, 'none');
  v_commission_pct   := COALESCE(p_commission_pct,    v_client.commission_percent);

  IF v_amount IS NULL OR v_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Expected amount per period is required');
  END IF;

  -- Conflict check: first_period commission + registration_charge = double charge
  IF v_commission_model = 'first_period'
     AND (v_client.registration_charge IS NOT NULL AND v_client.registration_charge > 0)
     AND NOT p_force
  THEN
    RETURN jsonb_build_object(
      'ok',           false,
      'conflict',     'REG_FEE_AND_FIRST_PERIOD',
      'reg_charge',   v_client.registration_charge,
      'commission',   v_commission_model,
      'expected',     v_amount,
      'error',        'Double-charge conflict: first_period commission and registration_charge are both set'
    );
  END IF;

  INSERT INTO ajo_cycles
    (client_id, owner_id, start_date, length_periods, expected_amount_per_period,
     status, label, commission_model, commission_percent)
  VALUES
    (p_client_id, p_owner_id, v_start, v_length, v_amount,
     'active', p_label, v_commission_model, v_commission_pct)
  RETURNING id INTO v_cycle_id;

  RETURN jsonb_build_object(
    'ok',                         true,
    'cycle_id',                   v_cycle_id,
    'start_date',                 v_start,
    'length_periods',             v_length,
    'expected_amount_per_period', v_amount,
    'commission_model',           v_commission_model,
    'commission_percent',         v_commission_pct
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION ajo_open_cycle(UUID, UUID, DATE, INT, NUMERIC, TEXT, TEXT, NUMERIC, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION ajo_open_cycle(UUID, UUID, DATE, INT, NUMERIC, TEXT, TEXT, NUMERIC, BOOLEAN)
  TO service_role;
