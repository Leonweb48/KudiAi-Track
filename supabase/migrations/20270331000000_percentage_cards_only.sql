-- ═════════════════════════════════════════════════════════════════════════════
-- Savings cards: percentage only (owner's decision 2026-10-14). The "first period" card type (the collector keeps the
-- first period's deposit) is no longer offered for NEW cards. Cards already open keep running exactly as before —
-- nothing here touches an existing card or a client's saved terms.
--
-- A new card that would have been first-period (the client's saved fee type, or an old app asking for it) opens as a
-- PERCENTAGE card instead, at the client's own % — or, when the client has none, the business's default %
-- (new profiles.ajo_default_commission_percent, set on the Ajo screen). With no % anywhere, the card is refused with a
-- message telling the business to set one. "No fee" cards are unchanged.
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ajo_default_commission_percent numeric(5,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_ajo_default_commission_percent_range') THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_ajo_default_commission_percent_range
      CHECK (ajo_default_commission_percent >= 0 AND ajo_default_commission_percent <= 100);
  END IF;
END $$;

COMMENT ON COLUMN public.profiles.ajo_default_commission_percent IS
  'Default collector fee % for new savings cards when the client has no % of their own (0 = none set).';

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
  v_default_pct       NUMERIC;
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

  -- Percentage cards only: first-period is no longer opened. Use the card's/client's own %, else the business default.
  IF v_commission_model IN ('first_period', 'percent') THEN
    IF COALESCE(v_commission_pct, 0) <= 0 THEN
      SELECT ajo_default_commission_percent INTO v_default_pct FROM profiles WHERE id = p_owner_id;
      IF COALESCE(v_default_pct, 0) > 0 THEN
        v_commission_pct := v_default_pct;
      END IF;
    END IF;
    IF v_commission_model = 'first_period' THEN
      IF COALESCE(v_commission_pct, 0) <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'error',
          'Savings cards now use a percentage fee. Ask your savings collector to set a fee percentage first.');
      END IF;
      v_commission_model := 'percent';
    END IF;
  END IF;

  IF (v_amount IS NULL OR v_amount <= 0) THEN
    IF NOT p_allow_flexible THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Contribution amount is required to open a cycle');
    END IF;
    -- Flexible card: no fixed per-period target. Every guard/fullness check
    -- elsewhere already treats expected_amount_per_period = 0 as "uncapped".
    v_amount := 0;
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
