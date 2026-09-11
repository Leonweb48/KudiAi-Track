-- ═════════════════════════════════════════════════════════════════════════════
-- Withdrawal payouts move to the client's KudiAI Wallet, automatically, on the
-- next business working day (no weekends, no public holidays) — real money,
-- owner wallet → client wallet, not just aso_clients bookkeeping.
--
-- ajo_record_withdrawal still does the SAME bookkeeping it always has (books
-- the withdrawal/fee rows, decrements aso_clients.current_balance) the moment
-- the owner approves — that's the client's savings ledger and must update
-- immediately. What's NEW: if the client has a wallet-capable login, it also
-- schedules a real wallet-to-wallet payout row instead of assuming cash/manual
-- payment happened. A daily cron settles due payouts on business days only.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. Public holiday calendar ─────────────────────────────────────────────
-- Admin-maintained: an owner/admin can INSERT more rows later (e.g. Eid,
-- Maulud — Islamic dates shift yearly and aren't computed here). Christian
-- movable feasts (Good Friday / Easter Monday) ARE computed below via the
-- standard Gregorian Easter algorithm, not guessed.
CREATE TABLE IF NOT EXISTS public.public_holidays (
  holiday_date DATE PRIMARY KEY,
  name         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.public_holidays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS public_holidays_read_all ON public.public_holidays;
CREATE POLICY public_holidays_read_all ON public.public_holidays
  FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.public_holidays FROM PUBLIC, anon;
GRANT SELECT ON public.public_holidays TO authenticated;
GRANT ALL    ON public.public_holidays TO service_role;

-- Gregorian Easter Sunday (Meeus/Jones/Butcher algorithm) — deterministic,
-- not a guess. Used to seed Good Friday / Easter Monday below.
CREATE OR REPLACE FUNCTION public.ajo_easter_sunday(p_year INT)
RETURNS DATE LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  a INT; b INT; c INT; d INT; e INT; f INT; g INT; h INT; i INT; k INT; l INT; m INT;
  v_month INT; v_day INT;
BEGIN
  a := p_year % 19;
  b := p_year / 100;
  c := p_year % 100;
  d := b / 4;
  e := b % 4;
  f := (b + 8) / 25;
  g := (b - f + 1) / 3;
  h := (19*a + b - d - g + 15) % 30;
  i := c / 4;
  k := c % 4;
  l := (32 + 2*e + 2*i - h - k) % 7;
  m := (a + 11*h + 22*l) / 451;
  v_month := (h + l - 7*m + 114) / 31;
  v_day   := ((h + l - 7*m + 114) % 31) + 1;
  RETURN make_date(p_year, v_month, v_day);
END;
$$;

-- Seed fixed-date Nigerian public holidays + computed Christian movable feasts
-- for a working range of years. Islamic holidays (Eid al-Fitr, Eid al-Adha,
-- Maulud) are NOT seeded here — they shift on the lunar calendar and must be
-- added by an admin closer to each date (simple INSERT into this table).
DO $$
DECLARE v_year INT;
BEGIN
  FOR v_year IN 2025..2030 LOOP
    INSERT INTO public.public_holidays (holiday_date, name) VALUES
      (make_date(v_year, 1, 1),   'New Year''s Day'),
      (make_date(v_year, 5, 1),   'Workers'' Day'),
      (make_date(v_year, 6, 12),  'Democracy Day'),
      (make_date(v_year, 10, 1),  'Independence Day'),
      (make_date(v_year, 12, 25), 'Christmas Day'),
      (make_date(v_year, 12, 26), 'Boxing Day'),
      (public.ajo_easter_sunday(v_year) - 2, 'Good Friday'),
      (public.ajo_easter_sunday(v_year) + 1, 'Easter Monday')
    ON CONFLICT (holiday_date) DO NOTHING;
  END LOOP;
END $$;

-- ── 2. Business-day helpers ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ajo_is_business_day(p_date DATE)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXTRACT(ISODOW FROM p_date) < 6   -- Mon(1)..Fri(5); Sat=6, Sun=7
     AND NOT EXISTS (SELECT 1 FROM public.public_holidays WHERE holiday_date = p_date)
$$;

CREATE OR REPLACE FUNCTION public.ajo_next_business_day(p_from DATE DEFAULT CURRENT_DATE)
RETURNS DATE LANGUAGE plpgsql STABLE AS $$
DECLARE v_d DATE := p_from + 1;
BEGIN
  WHILE NOT public.ajo_is_business_day(v_d) LOOP
    v_d := v_d + 1;
  END LOOP;
  RETURN v_d;
END;
$$;

REVOKE ALL ON FUNCTION public.ajo_easter_sunday(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ajo_easter_sunday(INT) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.ajo_is_business_day(DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ajo_is_business_day(DATE) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.ajo_next_business_day(DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ajo_next_business_day(DATE) TO authenticated, service_role;

-- ── 3. Scheduled wallet payouts ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ajo_wallet_payouts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  withdrawal_id   UUID REFERENCES public.ajo_contributions(id),
  request_id      UUID REFERENCES public.ajo_withdrawal_requests(id),
  client_id       UUID NOT NULL REFERENCES public.aso_clients(id),
  owner_id        UUID NOT NULL,
  client_user_id  UUID NOT NULL,
  amount_kobo     BIGINT NOT NULL CHECK (amount_kobo > 0),
  scheduled_date  DATE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','cancelled')),
  paid_at         TIMESTAMPTZ,
  owner_ledger_id  UUID,
  client_ledger_id UUID,
  failure_reason  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ajo_wallet_payouts_due_idx
  ON public.ajo_wallet_payouts (scheduled_date) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS ajo_wallet_payouts_owner_idx  ON public.ajo_wallet_payouts (owner_id);
CREATE INDEX IF NOT EXISTS ajo_wallet_payouts_client_idx ON public.ajo_wallet_payouts (client_user_id);

ALTER TABLE public.ajo_wallet_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ajo_wallet_payouts_owner_select  ON public.ajo_wallet_payouts;
CREATE POLICY ajo_wallet_payouts_owner_select ON public.ajo_wallet_payouts
  FOR SELECT TO authenticated USING (owner_id = auth.uid());

DROP POLICY IF EXISTS ajo_wallet_payouts_client_select ON public.ajo_wallet_payouts;
CREATE POLICY ajo_wallet_payouts_client_select ON public.ajo_wallet_payouts
  FOR SELECT TO authenticated USING (client_user_id = auth.uid());

REVOKE ALL ON public.ajo_wallet_payouts FROM PUBLIC, anon;
GRANT SELECT ON public.ajo_wallet_payouts TO authenticated;
GRANT ALL    ON public.ajo_wallet_payouts TO service_role;

-- ── 4. Widen the wallet ledger source check for payout rows ────────────────
ALTER TABLE public.wallet_ledger DROP CONSTRAINT IF EXISTS wallet_ledger_source_check;
ALTER TABLE public.wallet_ledger ADD CONSTRAINT wallet_ledger_source_check
  CHECK (source IN (
    'topup','sale','bill_spend','bill_reversal',
    'withdrawal','withdrawal_reversal','adjustment',
    'ajo_contribution','ajo_collection','ajo_payout'));

-- ── 5. ajo_record_withdrawal — schedule a wallet payout instead of assuming
--       cash/manual payment. Bookkeeping (current_balance, total_withdrawn,
--       ajo_contributions rows) is UNCHANGED — only the new scheduling block
--       and two new RETURN fields are added. ──
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
  v_client            RECORD;
  v_esusu_locked      NUMERIC;
  v_cycle_locked      NUMERIC;
  v_group_locked      NUMERIC;
  v_withdrawable      NUMERIC;
  v_pct_fee           NUMERIC;
  v_fee_amount        NUMERIC;
  v_net_amount        NUMERIC;
  v_net_id            UUID;
  v_fee_id            UUID;
  v_lock_msg          TEXT;
  v_lock_parts        TEXT[];
  v_attr_cycle_id     UUID;
  v_attr_group_id     UUID;
  v_cycle_just_closed BOOLEAN := false;
  v_closed_label      TEXT;
  v_cyc_close         RECORD;
  v_cycle_net_bal     NUMERIC;
  -- wallet payout scheduling
  v_payout_scheduled  BOOLEAN := false;
  v_payout_date       DATE;
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
  v_group_locked := ajo_locked_group_amount(p_client_id);
  v_withdrawable := COALESCE(v_client.current_balance, 0)
                    - v_esusu_locked - v_cycle_locked - v_group_locked;

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

  -- ── NEW: schedule a real wallet-to-wallet payout, next business working day.
  --    Only when the client has their own login (client_user_id) — a client
  --    with no portal account has nowhere to receive a wallet credit, so the
  --    payout falls back to whatever off-app method the owner already uses
  --    (p_method), unchanged from before. ──
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
    'ok',                true,
    'net_id',            v_net_id,
    'fee_id',            v_fee_id,
    'fee_amount',        v_fee_amount,
    'net_amount',        v_net_amount,
    'gross_amount',      p_gross_amount,
    'new_balance',       COALESCE(v_client.current_balance, 0) - p_gross_amount,
    'cycle_just_closed', v_cycle_just_closed,
    'closed_cycle_id',   v_attr_cycle_id,
    'closed_cycle_label', v_closed_label,
    'payout_scheduled',  v_payout_scheduled,
    'payout_date',       v_payout_date
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ajo_record_withdrawal(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ajo_record_withdrawal(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, UUID, UUID, UUID)
  TO service_role;

-- ── 6. Daily settlement — pays every due, pending payout. Business days only:
--       both the cron schedule (weekdays) and this function's own guard
--       (weekday + not a holiday) skip weekends/holidays, so a manual re-run
--       on an off day is also a safe no-op. ──
CREATE OR REPLACE FUNCTION public.ajo_settle_due_wallet_payouts()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row            RECORD;
  v_owner_wallet   public.wallets;
  v_client_wallet  public.wallets;
  v_owner_new      BIGINT;
  v_client_new     BIGINT;
  v_owner_ledger   UUID;
  v_client_ledger  UUID;
BEGIN
  IF NOT public.ajo_is_business_day(CURRENT_DATE) THEN
    RETURN;
  END IF;

  FOR v_row IN
    SELECT * FROM public.ajo_wallet_payouts
    WHERE status = 'pending' AND scheduled_date <= CURRENT_DATE
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      SELECT * INTO v_owner_wallet FROM public.wallets WHERE user_id = v_row.owner_id FOR UPDATE;
      IF NOT FOUND OR v_owner_wallet.status <> 'active' OR v_owner_wallet.balance_kobo < v_row.amount_kobo THEN
        UPDATE public.ajo_wallet_payouts
        SET status = 'failed', failure_reason = 'Owner wallet balance insufficient at settlement time'
        WHERE id = v_row.id;
        CONTINUE;
      END IF;

      SELECT * INTO v_client_wallet FROM public.wallets WHERE user_id = v_row.client_user_id FOR UPDATE;
      IF NOT FOUND THEN
        PERFORM set_config('kudi.allow_wallet_write', '1', true);
        INSERT INTO public.wallets (user_id) VALUES (v_row.client_user_id)
        ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
        RETURNING * INTO v_client_wallet;
      END IF;

      PERFORM set_config('kudi.allow_wallet_write', '1', true);
      v_owner_new  := v_owner_wallet.balance_kobo  - v_row.amount_kobo;
      v_client_new := v_client_wallet.balance_kobo + v_row.amount_kobo;

      UPDATE public.wallets SET balance_kobo = v_owner_new  WHERE id = v_owner_wallet.id;
      UPDATE public.wallets SET balance_kobo = v_client_new WHERE id = v_client_wallet.id;

      INSERT INTO public.wallet_ledger (
        wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
        source, status, reference, narration, related_txn_id
      ) VALUES (
        v_owner_wallet.id, v_row.owner_id, 'debit', v_row.amount_kobo, v_owner_new,
        'ajo_payout', 'completed', v_row.id::text, 'Ajo withdrawal payout', v_row.withdrawal_id
      ) RETURNING id INTO v_owner_ledger;

      INSERT INTO public.wallet_ledger (
        wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
        source, status, reference, narration, related_txn_id
      ) VALUES (
        v_client_wallet.id, v_row.client_user_id, 'credit', v_row.amount_kobo, v_client_new,
        'ajo_payout', 'completed', v_row.id::text, 'Ajo withdrawal payout', v_row.withdrawal_id
      ) RETURNING id INTO v_client_ledger;

      UPDATE public.ajo_wallet_payouts
      SET status = 'paid', paid_at = now(), owner_ledger_id = v_owner_ledger, client_ledger_id = v_client_ledger
      WHERE id = v_row.id;

    EXCEPTION WHEN OTHERS THEN
      UPDATE public.ajo_wallet_payouts
      SET status = 'failed', failure_reason = SQLERRM
      WHERE id = v_row.id;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.ajo_settle_due_wallet_payouts() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ajo_settle_due_wallet_payouts() TO service_role;

-- Weekdays only, 7:30am UTC (~8:30am WAT) — the function's own holiday guard
-- covers the rest.
SELECT cron.schedule(
  'ajo-wallet-payout-settle',
  '30 7 * * 1-5',
  'SELECT public.ajo_settle_due_wallet_payouts()'
);
