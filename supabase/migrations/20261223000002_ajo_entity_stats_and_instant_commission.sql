-- Two changes:
--
-- 1. New ajo_entity_stats(client_id, cycle_id?, group_id?) RPC returning
--    {total_saved, total_withdrawn, fees, locked, pending, available} for one
--    specific personal cycle, esusu group, or savings group — the three
--    numbers (saved/withdrawn/available) were never separately exposed
--    per-entity before (only a blended "net"). This also replaces two calls
--    in ajo-portal/index.ts's request-withdrawal handler that reference
--    functions which DO NOT EXIST live (ajo_group_net_balance,
--    ajo_pending_for_entity) or are called with a mismatched signature
--    (ajo_cycle_net_balance) — confirmed via the live database, not a guess.
--    Today this means every client withdrawal request naming a specific
--    personal cycle or any group/esusu is silently rejected with "Only ₦0
--    available". Fixed as a direct consequence of adding this RPC.
--
-- 2. ajo_record_withdrawal now settles any owed percent-model commission
--    across ALL of the client's eligible completed/settled cycles BEFORE
--    evaluating whether the withdrawal itself can proceed — atomically: the
--    total commission due is computed and validated against the client's
--    balance FIRST (no mutation), and only once confirmed affordable are the
--    commission rows actually inserted and the balance debited. If it can't
--    be covered, the whole withdrawal fails before anything is written.

-- ── ajo_entity_stats ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ajo_entity_stats(p_client_id uuid, p_cycle_id uuid DEFAULT NULL, p_group_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_saved      NUMERIC := 0;
  v_withdrawn  NUMERIC := 0;
  v_fees       NUMERIC := 0;
  v_locked     NUMERIC := 0;
  v_pending    NUMERIC := 0;
  v_available  NUMERIC := 0;
  v_group_mode TEXT;
BEGIN
  IF p_cycle_id IS NOT NULL THEN
    SELECT
      COALESCE(SUM(CASE WHEN type = 'contribution' THEN amount ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN type = 'withdrawal'   THEN amount ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN type IN ('commission', 'registration_fee', 'withdrawal_fee') THEN amount ELSE 0 END), 0)
    INTO v_saved, v_withdrawn, v_fees
    FROM ajo_contributions
    WHERE cycle_id = p_cycle_id AND aso_client_id = p_client_id AND status = 'completed';

    -- Scoped, per-cycle version of ajo_locked_cycle_amount's logic (that
    -- function aggregates across ALL of a client's active first_period
    -- cycles — a client can run several in parallel, so it can't be reused
    -- as-is for a single entity's figure).
    SELECT GREATEST(COALESCE(SUM(
      CASE c.type
        WHEN 'contribution'              THEN  c.amount
        WHEN 'commission'                THEN -c.amount
        WHEN 'registration_fee'          THEN -c.amount
        WHEN 'reversal_contribution'     THEN -c.amount
        WHEN 'reversal_commission'       THEN  c.amount
        WHEN 'reversal_registration_fee' THEN  c.amount
        ELSE 0
      END
    ), 0), 0)
    INTO v_locked
    FROM ajo_contributions c
    JOIN ajo_cycles cy ON cy.id = c.cycle_id
    WHERE c.cycle_id = p_cycle_id
      AND c.aso_client_id = p_client_id
      AND c.status = 'completed'
      AND cy.status = 'active'
      AND cy.commission_model = 'first_period'
      AND (
        cy.commission_balance >= cy.expected_amount_per_period
        OR EXISTS (
          SELECT 1 FROM ajo_contributions fc
          WHERE fc.cycle_id = cy.id AND fc.type = 'commission' AND fc.status = 'completed'
        )
      );

    SELECT COALESCE(SUM(amount), 0) INTO v_pending
      FROM ajo_withdrawal_requests
      WHERE cycle_id = p_cycle_id AND status IN ('pending', 'held_24h');

  ELSIF p_group_id IS NOT NULL THEN
    SELECT group_mode INTO v_group_mode FROM ajo_groups WHERE id = p_group_id;

    IF v_group_mode = 'rotating' THEN
      SELECT
        COALESCE(SUM(CASE WHEN type = 'contribution'  THEN amount ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN type = 'esusu_payout'  THEN amount ELSE 0 END), 0)
      INTO v_saved, v_withdrawn
      FROM ajo_contributions
      WHERE group_id = p_group_id AND aso_client_id = p_client_id
        AND contribution_context = 'esusu_rotation' AND status = 'completed';

      -- Scoped, per-group version of ajo_locked_esusu_amount's logic.
      SELECT COALESCE(SUM(ac.amount), 0)
      INTO v_locked
      FROM ajo_contributions ac
      WHERE ac.aso_client_id = p_client_id
        AND ac.group_id = p_group_id
        AND ac.contribution_context = 'esusu_rotation'
        AND ac.type = 'contribution'
        AND ac.status = 'completed'
        AND ac.created_at >= (
          SELECT COALESCE(MIN(t.period_start), NOW() + INTERVAL '100 years')
          FROM ajo_group_turns t
          JOIN ajo_group_rounds r ON r.id = t.round_id AND r.status = 'active'
          WHERE t.status = 'current' AND r.group_id = p_group_id
        );
    ELSE
      SELECT
        COALESCE(SUM(CASE WHEN type = 'contribution' THEN amount ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN type IN ('withdrawal', 'disbursement') THEN amount ELSE 0 END), 0)
      INTO v_saved, v_withdrawn
      FROM ajo_contributions
      WHERE group_id = p_group_id AND aso_client_id = p_client_id
        AND contribution_context = 'group_savings' AND status = 'completed';

      -- Scoped, per-group version of ajo_locked_group_amount's logic.
      SELECT GREATEST(COALESCE(SUM(
        CASE c.type
          WHEN 'contribution'          THEN  c.amount
          WHEN 'reversal_contribution' THEN -c.amount
          WHEN 'disbursement'          THEN -c.amount
          WHEN 'withdrawal'            THEN -c.amount
          WHEN 'reversal_withdrawal'   THEN  c.amount
          WHEN 'group_release'         THEN -c.amount
          ELSE 0
        END
      ), 0), 0)
      INTO v_locked
      FROM ajo_contributions c
      WHERE c.aso_client_id = p_client_id
        AND c.group_id = p_group_id
        AND c.status = 'completed'
        AND (
          (c.type IN ('contribution', 'reversal_contribution')
           AND c.contribution_context = 'group_savings'
           AND EXISTS (SELECT 1 FROM ajo_groups g WHERE g.id = c.group_id AND g.round_status != 'closed'))
          OR
          (c.type IN ('disbursement', 'withdrawal', 'reversal_withdrawal', 'group_release')
           AND c.contribution_context = 'group_savings')
        );
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_pending
      FROM ajo_withdrawal_requests
      WHERE group_id = p_group_id AND status IN ('pending', 'held_24h');
  END IF;

  v_available := GREATEST(0, v_saved - v_withdrawn - v_fees - v_locked - v_pending);

  RETURN jsonb_build_object(
    'total_saved',     v_saved,
    'total_withdrawn', v_withdrawn,
    'fees',            v_fees,
    'locked',          v_locked,
    'pending',         v_pending,
    'available',       v_available
  );
END;
$function$;

-- ── ajo_record_withdrawal: instant commission sweep before the withdrawal ──

CREATE OR REPLACE FUNCTION public.ajo_record_withdrawal(p_client_id uuid, p_owner_id uuid, p_gross_amount numeric, p_method text DEFAULT 'cash'::text, p_notes text DEFAULT NULL::text, p_recorded_by uuid DEFAULT NULL::uuid, p_request_id uuid DEFAULT NULL::uuid, p_cycle_id uuid DEFAULT NULL::uuid, p_group_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_client               RECORD;
  v_esusu_locked         NUMERIC;
  v_cycle_locked         NUMERIC;
  v_group_locked         NUMERIC;
  v_withdrawable         NUMERIC;
  v_pct_fee              NUMERIC;
  v_fee_amount           NUMERIC;
  v_net_amount           NUMERIC;
  v_net_id               UUID;
  v_fee_id               UUID;
  v_lock_msg             TEXT;
  v_lock_parts           TEXT[];
  v_attr_cycle_id        UUID;
  v_attr_group_id        UUID;
  v_cycle_just_closed    BOOLEAN := false;
  v_closed_label         TEXT;
  v_cyc_close            RECORD;
  v_cycle_net_bal        NUMERIC;
  -- wallet payout scheduling
  v_payout_scheduled     BOOLEAN := false;
  v_payout_date          DATE;
  -- instant commission sweep
  v_total_commission_due NUMERIC;
  v_working_balance      NUMERIC;
  v_comm_cycle           RECORD;
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

  -- ── Instant commission sweep: settle any owed percent-model commission
  --    across ALL eligible completed/settled cycles before this withdrawal
  --    is evaluated. Pass 1 computes the total due with NO mutation and
  --    validates it against the balance; pass 2 (only once confirmed
  --    affordable) actually books it. This keeps the whole thing atomic
  --    without needing an exception-driven rollback — nothing is written
  --    until we already know it can all be covered.
  SELECT COALESCE(SUM(
    ROUND(
      (SELECT COALESCE(SUM(amount), 0) FROM ajo_contributions
         WHERE cycle_id = cy.id AND type = 'contribution' AND status = 'completed')
      * COALESCE(cy.commission_percent, 0) / 100
    , 2)
  ), 0)
  INTO v_total_commission_due
  FROM ajo_cycles cy
  WHERE cy.client_id = p_client_id
    AND cy.commission_model = 'percent'
    AND cy.status IN ('completed', 'settled')
    AND NOT EXISTS (
      SELECT 1 FROM ajo_contributions fc
      WHERE fc.cycle_id = cy.id AND fc.type = 'commission' AND fc.status = 'completed'
    );

  v_working_balance := COALESCE(v_client.current_balance, 0);

  IF v_total_commission_due > 0 AND v_working_balance < v_total_commission_due THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', format(
        '₦%s in owed commission must be settled first, but the available balance (₦%s) is insufficient — this withdrawal cannot proceed',
        to_char(v_total_commission_due, 'FM999,999,990.00'), to_char(v_working_balance, 'FM999,999,990.00')
      )
    );
  END IF;

  IF v_total_commission_due > 0 THEN
    FOR v_comm_cycle IN
      SELECT cy.id,
        ROUND(
          (SELECT COALESCE(SUM(amount), 0) FROM ajo_contributions
             WHERE cycle_id = cy.id AND type = 'contribution' AND status = 'completed')
          * COALESCE(cy.commission_percent, 0) / 100
        , 2) AS comm_amount
      FROM ajo_cycles cy
      WHERE cy.client_id = p_client_id
        AND cy.commission_model = 'percent'
        AND cy.status IN ('completed', 'settled')
        AND NOT EXISTS (
          SELECT 1 FROM ajo_contributions fc
          WHERE fc.cycle_id = cy.id AND fc.type = 'commission' AND fc.status = 'completed'
        )
      ORDER BY cy.created_at ASC
    LOOP
      CONTINUE WHEN v_comm_cycle.comm_amount <= 0;
      INSERT INTO ajo_contributions
        (aso_client_id, owner_id, amount, type, status, payment_method, notes, cycle_id)
      VALUES
        (p_client_id, p_owner_id, v_comm_cycle.comm_amount, 'commission', 'completed', 'commission',
         'Cycle commission (auto-settled at withdrawal)', v_comm_cycle.id);
      v_working_balance := v_working_balance - v_comm_cycle.comm_amount;
    END LOOP;

    UPDATE aso_clients SET current_balance = current_balance - v_total_commission_due WHERE id = p_client_id;
  END IF;

  IF v_working_balance < p_gross_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Insufficient balance');
  END IF;

  v_esusu_locked := ajo_locked_esusu_amount(p_client_id);
  v_cycle_locked := ajo_locked_cycle_amount(p_client_id);
  v_group_locked := ajo_locked_group_amount(p_client_id);
  v_withdrawable := v_working_balance - v_esusu_locked - v_cycle_locked - v_group_locked;

  IF v_withdrawable < p_gross_amount THEN
    v_lock_parts := ARRAY[]::TEXT[];
    IF v_group_locked > 0 THEN
      v_lock_parts := v_lock_parts || ('₦' || ROUND(v_group_locked, 2) || ' committed to a savings group or esusu — available after your payout');
    END IF;
    IF v_esusu_locked > 0 THEN
      v_lock_parts := v_lock_parts || ('₦' || ROUND(v_esusu_locked, 2) || ' locked in an active esusu round');
    END IF;
    IF v_cycle_locked > 0 THEN
      v_lock_parts := v_lock_parts || ('₦' || ROUND(v_cycle_locked, 2) || ' locked in an active first-period savings cycle');
    END IF;
    v_lock_msg := CASE
      WHEN array_length(v_lock_parts, 1) > 0
        THEN 'Insufficient withdrawable balance — ' || array_to_string(v_lock_parts, ' and ')
      ELSE 'balance too low'
    END;
    RETURN jsonb_build_object(
      'ok',           false,
      'error',        v_lock_msg,
      'esusu_locked', v_esusu_locked,
      'cycle_locked', v_cycle_locked,
      'group_locked', v_group_locked,
      'withdrawable', GREATEST(v_withdrawable, 0)
    );
  END IF;

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

  -- ── schedule a real wallet-to-wallet payout, next business working day ──
  IF v_client.client_user_id IS NOT NULL AND v_net_amount > 0 THEN
    v_payout_date := public.ajo_next_business_day(CURRENT_DATE);
    INSERT INTO public.ajo_wallet_payouts (
      withdrawal_id, request_id, client_id, owner_id, client_user_id,
      amount_kobo, scheduled_date
    ) VALUES (
      v_net_id, p_request_id, p_client_id, p_owner_id, v_client.client_user_id,
      ROUND(v_net_amount * 100)::BIGINT, v_payout_date
    );
    v_payout_scheduled := true;
  END IF;

  IF v_attr_cycle_id IS NOT NULL THEN
    SELECT status, label INTO v_cyc_close
    FROM ajo_cycles WHERE id = v_attr_cycle_id;

    IF FOUND AND v_cyc_close.status = 'completed' THEN
      v_cycle_net_bal := ajo_cycle_net_balance(v_attr_cycle_id);
      IF v_cycle_net_bal < 0.01 THEN
        UPDATE ajo_cycles
        SET status = 'settled'
        WHERE id = v_attr_cycle_id;
        v_cycle_just_closed := true;
        v_closed_label      := v_cyc_close.label;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok',                 true,
    'net_id',             v_net_id,
    'fee_id',              v_fee_id,
    'fee_amount',          v_fee_amount,
    'net_amount',          v_net_amount,
    'gross_amount',        p_gross_amount,
    'commission_collected', v_total_commission_due,
    'new_balance',         v_working_balance - p_gross_amount,
    'cycle_just_closed',   v_cycle_just_closed,
    'closed_cycle_id',     v_attr_cycle_id,
    'closed_cycle_label',  v_closed_label,
    'payout_scheduled',    v_payout_scheduled,
    'payout_date',         v_payout_date
  );
END;
$function$;
