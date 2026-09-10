-- ═════════════════════════════════════════════════════════════════════════════
-- Digital wallet (Flutterwave sandbox test build)
--
-- A prefunded closed-loop wallet: the owner tops up once by bank transfer into a
-- Flutterwave virtual account, then spends the balance on bills with zero gateway
-- fee. Bill failures reverse straight back to the wallet. Cash-out ("withdraw to
-- bank") is a Flutterwave payout that an admin must approve first.
--
-- Everything here is dormant until platform_config.wallet_enabled = 'true'.
-- All amounts are kobo (bigint) — never floats.
--
-- Defence in depth: wallets + wallet_ledger are RPC-only for end users. A trigger
-- rejects any direct write from an authenticated session unless the SECURITY
-- DEFINER RPCs (which set kudi.allow_wallet_write) are the caller.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. Tables ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.wallets (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  balance_kobo           BIGINT NOT NULL DEFAULT 0 CHECK (balance_kobo >= 0),
  currency               TEXT NOT NULL DEFAULT 'NGN',
  status                 TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','frozen','closed')),
  flw_customer_id        TEXT,
  flw_virtual_account_id TEXT,
  flw_account_number     TEXT,
  flw_account_bank       TEXT,
  flw_account_name       TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wallet_ledger (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id          UUID NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL,                       -- denormalised for RLS
  direction          TEXT NOT NULL CHECK (direction IN ('credit','debit')),
  amount_kobo        BIGINT NOT NULL CHECK (amount_kobo > 0),
  balance_after_kobo BIGINT NOT NULL,
  source             TEXT NOT NULL CHECK (source IN (
                       'topup','bill_spend','bill_reversal',
                       'withdrawal','withdrawal_reversal','adjustment')),
  status             TEXT NOT NULL DEFAULT 'completed' CHECK (status IN (
                       'pending','completed','failed','reversed')),
  reference          TEXT,                                -- our reference (bill ref, withdrawal id…)
  flw_reference      TEXT,                                -- Flutterwave charge / transfer id
  related_txn_id     UUID,                                -- link into public.transactions for bill spends
  narration          TEXT,
  meta               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Webhook idempotency: one credit per Flutterwave reference per source.
CREATE UNIQUE INDEX IF NOT EXISTS wallet_ledger_flw_ref_uniq
  ON public.wallet_ledger (source, flw_reference)
  WHERE flw_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS wallet_ledger_user_created
  ON public.wallet_ledger (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.wallet_withdrawals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id           UUID NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL,
  amount_kobo         BIGINT NOT NULL CHECK (amount_kobo > 0),
  fee_kobo            BIGINT NOT NULL DEFAULT 0,
  bank_code           TEXT NOT NULL,
  account_number      TEXT NOT NULL,
  account_name        TEXT,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                        'pending','processing','successful','failed','reversed')),
  flw_transfer_id     TEXT,
  flw_reference       TEXT,
  ledger_id           UUID REFERENCES public.wallet_ledger(id),
  approval_request_id UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wallet_withdrawals_user   ON public.wallet_withdrawals (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wallet_withdrawals_flw_tr ON public.wallet_withdrawals (flw_transfer_id);

-- Mirrors paystack_webhook_log — dedupe for the Flutterwave webhook.
CREATE TABLE IF NOT EXISTS public.wallet_webhook_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event          TEXT NOT NULL,
  flw_webhook_id TEXT NOT NULL UNIQUE,
  flw_reference  TEXT,
  payload        JSONB,
  processed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE public.wallets            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_ledger      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_webhook_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wallet_owner_select     ON public.wallets;
DROP POLICY IF EXISTS wallet_ledger_select    ON public.wallet_ledger;
DROP POLICY IF EXISTS wallet_withdraw_select  ON public.wallet_withdrawals;
DROP POLICY IF EXISTS wallet_service_all      ON public.wallets;
DROP POLICY IF EXISTS wallet_ledger_svc_all   ON public.wallet_ledger;
DROP POLICY IF EXISTS wallet_withdraw_svc_all ON public.wallet_withdrawals;
DROP POLICY IF EXISTS wallet_hook_svc_all     ON public.wallet_webhook_log;

CREATE POLICY wallet_owner_select    ON public.wallets            FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY wallet_ledger_select   ON public.wallet_ledger      FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY wallet_withdraw_select ON public.wallet_withdrawals FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY wallet_service_all      ON public.wallets            FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY wallet_ledger_svc_all   ON public.wallet_ledger      FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY wallet_withdraw_svc_all ON public.wallet_withdrawals FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY wallet_hook_svc_all     ON public.wallet_webhook_log FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 3. Write-guard trigger (pattern: guard_subscription_plan_writes) ─────────
-- Blocks any authenticated session from touching wallets / wallet_ledger
-- directly. service_role, the SECURITY DEFINER RPCs (which set the flag) and
-- migrations pass through.

CREATE OR REPLACE FUNCTION public.guard_wallet_writes()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_role TEXT;
BEGIN
  v_role := COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');

  IF v_role <> 'authenticated'
     OR current_setting('kudi.allow_wallet_write', true) = '1' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  RAISE EXCEPTION 'Wallet balances can only be changed through the wallet RPCs'
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_wallet_writes        ON public.wallets;
DROP TRIGGER IF EXISTS trg_guard_wallet_ledger_writes ON public.wallet_ledger;
CREATE TRIGGER trg_guard_wallet_writes
  BEFORE INSERT OR UPDATE OR DELETE ON public.wallets
  FOR EACH ROW EXECUTE FUNCTION public.guard_wallet_writes();
CREATE TRIGGER trg_guard_wallet_ledger_writes
  BEFORE INSERT OR UPDATE OR DELETE ON public.wallet_ledger
  FOR EACH ROW EXECUTE FUNCTION public.guard_wallet_writes();

-- keep updated_at fresh
CREATE OR REPLACE FUNCTION public.touch_wallet_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_touch_wallets ON public.wallets;
CREATE TRIGGER trg_touch_wallets BEFORE UPDATE ON public.wallets
  FOR EACH ROW EXECUTE FUNCTION public.touch_wallet_updated_at();

-- ── 4. Config knobs ─────────────────────────────────────────────────────────

INSERT INTO public.platform_config (key, value, description) VALUES
  ('wallet_enabled',                 'false',    'Master switch — show the wallet feature to users'),
  ('wallet_test_mode',               'true',     'Show the "test mode" banner + enable the simulate-topup button'),
  ('wallet_min_topup_kobo',          '10000',    'Minimum top-up (kobo) — ₦100'),
  ('wallet_max_balance_kobo',        '20000000', 'Max wallet balance during the test (kobo) — ₦200,000'),
  ('wallet_max_withdrawal_kobo',     '5000000',  'Max single withdrawal (kobo) — ₦50,000'),
  ('wallet_daily_withdrawal_cap_kobo','10000000','Max withdrawals per day (kobo) — ₦100,000')
ON CONFLICT (key) DO NOTHING;

-- ── 5. admin_approval_requests: add wallet_withdrawal ───────────────────────
ALTER TABLE public.admin_approval_requests
  DROP CONSTRAINT IF EXISTS admin_approval_requests_request_type_check;
ALTER TABLE public.admin_approval_requests
  ADD CONSTRAINT admin_approval_requests_request_type_check
  CHECK (request_type IN (
    'group_edit','group_delete','credit_delete','client_archive','org_archive',
    'client_reactivation','org_member_reactivation','org_reactivation',
    'subscription_upgrade','wallet_withdrawal'
  ));

-- ═══════════════════════ RPCs ═══════════════════════════════════════════════

-- helper: read an integer platform_config value with a fallback
CREATE OR REPLACE FUNCTION public.wallet_cfg(p_key TEXT, p_default BIGINT)
RETURNS BIGINT LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(NULLIF(value, '')::bigint, p_default)
  FROM public.platform_config WHERE key = p_key
  UNION ALL SELECT p_default
  LIMIT 1;
$$;

-- ── 6. wallet_get_or_create — owner-callable ────────────────────────────────
CREATE OR REPLACE FUNCTION public.wallet_get_or_create()
RETURNS public.wallets LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_row public.wallets;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_row FROM public.wallets WHERE user_id = v_uid;
  IF FOUND THEN RETURN v_row; END IF;

  PERFORM set_config('kudi.allow_wallet_write', '1', true);
  INSERT INTO public.wallets (user_id) VALUES (v_uid)
  ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.wallet_get_or_create() TO authenticated;

-- ── 7. wallet_credit — service-role only (webhook) ──────────────────────────
CREATE OR REPLACE FUNCTION public.wallet_credit(
  p_user_id       UUID,
  p_amount_kobo   BIGINT,
  p_source        TEXT,
  p_flw_reference TEXT,
  p_narration     TEXT DEFAULT NULL,
  p_meta          JSONB DEFAULT '{}'::jsonb
) RETURNS public.wallet_ledger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wallet public.wallets;
  v_row    public.wallet_ledger;
  v_new    BIGINT;
BEGIN
  IF p_amount_kobo IS NULL OR p_amount_kobo <= 0 THEN
    RAISE EXCEPTION 'credit amount must be positive';
  END IF;

  -- idempotency: return the existing row if this reference was already credited
  IF p_flw_reference IS NOT NULL THEN
    SELECT * INTO v_row FROM public.wallet_ledger
     WHERE source = p_source AND flw_reference = p_flw_reference;
    IF FOUND THEN RETURN v_row; END IF;
  END IF;

  PERFORM set_config('kudi.allow_wallet_write', '1', true);

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.wallets (user_id) VALUES (p_user_id) RETURNING * INTO v_wallet;
  END IF;

  v_new := v_wallet.balance_kobo + p_amount_kobo;

  -- Insert the ledger row first. If a concurrent call already credited this
  -- reference the partial unique index rejects it → no row back → do NOT touch
  -- the balance, just return the row that won.
  IF p_flw_reference IS NOT NULL THEN
    INSERT INTO public.wallet_ledger (
      wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
      source, status, flw_reference, narration, meta
    ) VALUES (
      v_wallet.id, p_user_id, 'credit', p_amount_kobo, v_new,
      p_source, 'completed', p_flw_reference, p_narration, COALESCE(p_meta, '{}'::jsonb)
    )
    ON CONFLICT (source, flw_reference) WHERE flw_reference IS NOT NULL DO NOTHING
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
      SELECT * INTO v_row FROM public.wallet_ledger
       WHERE source = p_source AND flw_reference = p_flw_reference;
      RETURN v_row;
    END IF;
  ELSE
    INSERT INTO public.wallet_ledger (
      wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
      source, status, flw_reference, narration, meta
    ) VALUES (
      v_wallet.id, p_user_id, 'credit', p_amount_kobo, v_new,
      p_source, 'completed', NULL, p_narration, COALESCE(p_meta, '{}'::jsonb)
    )
    RETURNING * INTO v_row;
  END IF;

  UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_wallet.id;
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_credit(UUID, BIGINT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wallet_credit(UUID, BIGINT, TEXT, TEXT, TEXT, JSONB) TO service_role;

-- ── 8. wallet_debit_for_bill — owner-callable, returns ledger id ────────────
CREATE OR REPLACE FUNCTION public.wallet_debit_for_bill(
  p_amount_kobo BIGINT,
  p_reference   TEXT,
  p_narration   TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_wallet public.wallets;
  v_row    public.wallet_ledger;
  v_new    BIGINT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_amount_kobo IS NULL OR p_amount_kobo <= 0 THEN RAISE EXCEPTION 'Invalid amount'; END IF;

  -- resend of the same bill reference → return the existing pending debit
  IF p_reference IS NOT NULL AND p_reference <> '' THEN
    SELECT * INTO v_row FROM public.wallet_ledger
     WHERE user_id = v_uid AND source = 'bill_spend' AND reference = p_reference
     ORDER BY created_at DESC LIMIT 1;
    IF FOUND AND v_row.status IN ('pending','completed') THEN RETURN v_row.id; END IF;
  END IF;

  PERFORM set_config('kudi.allow_wallet_write', '1', true);

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No wallet — activate your wallet first'; END IF;
  IF v_wallet.status <> 'active' THEN RAISE EXCEPTION 'Wallet is not active'; END IF;
  IF v_wallet.balance_kobo < p_amount_kobo THEN
    RAISE EXCEPTION 'Insufficient wallet balance' USING ERRCODE = 'check_violation';
  END IF;

  v_new := v_wallet.balance_kobo - p_amount_kobo;
  UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_wallet.id;

  INSERT INTO public.wallet_ledger (
    wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
    source, status, reference, narration
  ) VALUES (
    v_wallet.id, v_uid, 'debit', p_amount_kobo, v_new,
    'bill_spend', 'pending', p_reference, p_narration
  ) RETURNING * INTO v_row;

  RETURN v_row.id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.wallet_debit_for_bill(BIGINT, TEXT, TEXT) TO authenticated;

-- ── 9. wallet_settle_bill — mark a pending bill debit completed ─────────────
CREATE OR REPLACE FUNCTION public.wallet_settle_bill(p_ledger_id UUID, p_txn_id UUID DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_row public.wallet_ledger;
BEGIN
  SELECT * INTO v_row FROM public.wallet_ledger WHERE id = p_ledger_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ledger row not found'; END IF;
  IF v_uid IS NOT NULL AND v_row.user_id <> v_uid THEN RAISE EXCEPTION 'Not your ledger row'; END IF;
  IF v_row.source <> 'bill_spend' THEN RAISE EXCEPTION 'Not a bill debit'; END IF;
  IF v_row.status <> 'pending' THEN RETURN; END IF;   -- already settled / reversed

  PERFORM set_config('kudi.allow_wallet_write', '1', true);
  UPDATE public.wallet_ledger
     SET status = 'completed', related_txn_id = COALESCE(p_txn_id, related_txn_id)
   WHERE id = p_ledger_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.wallet_settle_bill(UUID, UUID) TO authenticated;

-- ── 10. wallet_reverse_bill — credit a failed bill back ─────────────────────
CREATE OR REPLACE FUNCTION public.wallet_reverse_bill(p_ledger_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_row    public.wallet_ledger;
  v_wallet public.wallets;
  v_new    BIGINT;
BEGIN
  SELECT * INTO v_row FROM public.wallet_ledger WHERE id = p_ledger_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ledger row not found'; END IF;
  IF v_uid IS NOT NULL AND v_row.user_id <> v_uid THEN RAISE EXCEPTION 'Not your ledger row'; END IF;
  IF v_row.source <> 'bill_spend' THEN RAISE EXCEPTION 'Not a bill debit'; END IF;
  IF v_row.status = 'reversed' THEN RETURN; END IF;   -- idempotent

  PERFORM set_config('kudi.allow_wallet_write', '1', true);

  SELECT * INTO v_wallet FROM public.wallets WHERE id = v_row.wallet_id FOR UPDATE;
  v_new := v_wallet.balance_kobo + v_row.amount_kobo;
  UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_wallet.id;

  UPDATE public.wallet_ledger SET status = 'reversed' WHERE id = p_ledger_id;

  INSERT INTO public.wallet_ledger (
    wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
    source, status, reference, narration, meta
  ) VALUES (
    v_wallet.id, v_row.user_id, 'credit', v_row.amount_kobo, v_new,
    'bill_reversal', 'completed', v_row.reference,
    COALESCE(p_reason, 'Bill delivery failed — refunded to wallet'),
    jsonb_build_object('reversed_ledger_id', p_ledger_id)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.wallet_reverse_bill(UUID, TEXT) TO authenticated, service_role;

-- ── 11. wallet_submit_withdrawal — owner-callable, holds funds + raises approval
CREATE OR REPLACE FUNCTION public.wallet_submit_withdrawal(
  p_amount_kobo    BIGINT,
  p_bank_code      TEXT,
  p_account_number TEXT,
  p_account_name   TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_wallet    public.wallets;
  v_ledger    public.wallet_ledger;
  v_new       BIGINT;
  v_business  TEXT;
  v_req_id    UUID;
  v_wd_id     UUID;
  v_today_out BIGINT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_amount_kobo IS NULL OR p_amount_kobo <= 0 THEN RAISE EXCEPTION 'Invalid amount'; END IF;
  IF COALESCE(p_bank_code,'') = '' OR COALESCE(p_account_number,'') = '' THEN
    RAISE EXCEPTION 'Bank and account number are required';
  END IF;
  IF p_amount_kobo > public.wallet_cfg('wallet_max_withdrawal_kobo', 5000000) THEN
    RAISE EXCEPTION 'Amount exceeds the per-withdrawal limit';
  END IF;

  PERFORM set_config('kudi.allow_wallet_write', '1', true);

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No wallet'; END IF;
  IF v_wallet.balance_kobo < p_amount_kobo THEN
    RAISE EXCEPTION 'Insufficient wallet balance' USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(SUM(amount_kobo), 0) INTO v_today_out
  FROM public.wallet_ledger
  WHERE user_id = v_uid AND source = 'withdrawal'
    AND status IN ('pending','completed')
    AND created_at >= date_trunc('day', now());
  IF v_today_out + p_amount_kobo > public.wallet_cfg('wallet_daily_withdrawal_cap_kobo', 10000000) THEN
    RAISE EXCEPTION 'Daily withdrawal limit reached';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.admin_approval_requests
    WHERE requester = v_uid AND request_type = 'wallet_withdrawal' AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'You already have a withdrawal awaiting approval';
  END IF;

  -- hold the funds now
  v_new := v_wallet.balance_kobo - p_amount_kobo;
  UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_wallet.id;

  INSERT INTO public.wallet_ledger (
    wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
    source, status, narration
  ) VALUES (
    v_wallet.id, v_uid, 'debit', p_amount_kobo, v_new,
    'withdrawal', 'pending', 'Withdrawal to bank — awaiting admin approval'
  ) RETURNING * INTO v_ledger;

  INSERT INTO public.wallet_withdrawals (
    wallet_id, user_id, amount_kobo, bank_code, account_number, account_name, status, ledger_id
  ) VALUES (
    v_wallet.id, v_uid, p_amount_kobo, p_bank_code, p_account_number, p_account_name, 'pending', v_ledger.id
  ) RETURNING id INTO v_wd_id;

  SELECT business_name INTO v_business FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.admin_approval_requests(
    request_type, requester, business, target_id, payload, reason, status
  ) VALUES (
    'wallet_withdrawal', v_uid, COALESCE(v_business, ''), v_wd_id,
    jsonb_build_object(
      'withdrawal_id',  v_wd_id,
      'ledger_id',      v_ledger.id,
      'amount_kobo',    p_amount_kobo,
      'bank_code',      p_bank_code,
      'account_number', p_account_number,
      'account_name',   p_account_name,
      'submitted_at',   now()
    ),
    'Wallet withdrawal — awaiting admin approval',
    'pending'
  ) RETURNING id INTO v_req_id;

  UPDATE public.wallet_withdrawals SET approval_request_id = v_req_id WHERE id = v_wd_id;

  RETURN v_req_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.wallet_submit_withdrawal(BIGINT, TEXT, TEXT, TEXT) TO authenticated;

-- ── 12. execute_wallet_withdrawal — service-role (admin API, after disburse) ─
CREATE OR REPLACE FUNCTION public.execute_wallet_withdrawal(
  p_request_id    UUID,
  p_admin_id      UUID DEFAULT NULL,
  p_decision_note TEXT DEFAULT NULL,
  p_flw_transfer_id TEXT DEFAULT NULL,
  p_fee_kobo      BIGINT DEFAULT 0
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req public.admin_approval_requests%ROWTYPE;
  v_wd_id UUID;
BEGIN
  SELECT * INTO v_req FROM public.admin_approval_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF v_req.status <> 'pending' THEN RAISE EXCEPTION 'Request is not pending (%)' , v_req.status; END IF;
  IF v_req.request_type <> 'wallet_withdrawal' THEN RAISE EXCEPTION 'Request type mismatch'; END IF;

  v_wd_id := (v_req.payload ->> 'withdrawal_id')::uuid;

  PERFORM set_config('kudi.allow_wallet_write', '1', true);

  UPDATE public.wallet_withdrawals SET
    status = 'processing',
    flw_transfer_id = COALESCE(p_flw_transfer_id, flw_transfer_id),
    fee_kobo = COALESCE(NULLIF(p_fee_kobo, 0), fee_kobo),
    updated_at = now()
  WHERE id = v_wd_id;

  UPDATE public.admin_approval_requests SET
    status = 'approved', decided_at = now(), decided_by = p_admin_id, decision_note = p_decision_note
  WHERE id = p_request_id;
END;
$$;
REVOKE ALL ON FUNCTION public.execute_wallet_withdrawal(UUID, UUID, TEXT, TEXT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.execute_wallet_withdrawal(UUID, UUID, TEXT, TEXT, BIGINT) TO service_role;

-- ── 13. wallet_reject_withdrawal — service-role, refunds the held funds ─────
CREATE OR REPLACE FUNCTION public.wallet_reject_withdrawal(
  p_request_id    UUID,
  p_admin_id      UUID DEFAULT NULL,
  p_decision_note TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req    public.admin_approval_requests%ROWTYPE;
  v_wd     public.wallet_withdrawals%ROWTYPE;
  v_wallet public.wallets;
  v_new    BIGINT;
BEGIN
  SELECT * INTO v_req FROM public.admin_approval_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF v_req.status <> 'pending' THEN RAISE EXCEPTION 'Request is not pending (%)', v_req.status; END IF;
  IF v_req.request_type <> 'wallet_withdrawal' THEN RAISE EXCEPTION 'Request type mismatch'; END IF;

  SELECT * INTO v_wd FROM public.wallet_withdrawals
   WHERE id = (v_req.payload ->> 'withdrawal_id')::uuid FOR UPDATE;

  PERFORM set_config('kudi.allow_wallet_write', '1', true);

  IF v_wd.id IS NOT NULL AND v_wd.status IN ('pending','processing') THEN
    SELECT * INTO v_wallet FROM public.wallets WHERE id = v_wd.wallet_id FOR UPDATE;
    v_new := v_wallet.balance_kobo + v_wd.amount_kobo;
    UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_wallet.id;

    UPDATE public.wallet_ledger SET status = 'reversed' WHERE id = v_wd.ledger_id;
    INSERT INTO public.wallet_ledger (
      wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
      source, status, narration
    ) VALUES (
      v_wallet.id, v_wd.user_id, 'credit', v_wd.amount_kobo, v_new,
      'withdrawal_reversal', 'completed', 'Withdrawal declined — refunded to wallet'
    );
    UPDATE public.wallet_withdrawals SET status = 'failed', updated_at = now() WHERE id = v_wd.id;
  END IF;

  UPDATE public.admin_approval_requests SET
    status = 'rejected', decided_at = now(), decided_by = p_admin_id, decision_note = p_decision_note
  WHERE id = p_request_id;
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_reject_withdrawal(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wallet_reject_withdrawal(UUID, UUID, TEXT) TO service_role;

-- ── 14. wallet_mark_withdrawal — service-role (webhook finaliser) ───────────
CREATE OR REPLACE FUNCTION public.wallet_mark_withdrawal(p_flw_transfer_id TEXT, p_status TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wd     public.wallet_withdrawals%ROWTYPE;
  v_wallet public.wallets;
  v_new    BIGINT;
BEGIN
  SELECT * INTO v_wd FROM public.wallet_withdrawals WHERE flw_transfer_id = p_flw_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE WARNING 'wallet_mark_withdrawal: no withdrawal for %', p_flw_transfer_id; RETURN; END IF;

  PERFORM set_config('kudi.allow_wallet_write', '1', true);

  IF p_status = 'successful' AND v_wd.status <> 'successful' THEN
    UPDATE public.wallet_withdrawals SET status = 'successful', updated_at = now() WHERE id = v_wd.id;
    UPDATE public.wallet_ledger SET status = 'completed' WHERE id = v_wd.ledger_id AND status = 'pending';

  ELSIF p_status IN ('failed','reversed') AND v_wd.status NOT IN ('failed','reversed') THEN
    SELECT * INTO v_wallet FROM public.wallets WHERE id = v_wd.wallet_id FOR UPDATE;
    v_new := v_wallet.balance_kobo + v_wd.amount_kobo;
    UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_wallet.id;
    UPDATE public.wallet_ledger SET status = 'reversed' WHERE id = v_wd.ledger_id;
    INSERT INTO public.wallet_ledger (
      wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
      source, status, narration
    ) VALUES (
      v_wallet.id, v_wd.user_id, 'credit', v_wd.amount_kobo, v_new,
      'withdrawal_reversal', 'completed', 'Bank payout failed — refunded to wallet'
    );
    UPDATE public.wallet_withdrawals SET status = p_status, updated_at = now() WHERE id = v_wd.id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_mark_withdrawal(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wallet_mark_withdrawal(TEXT, TEXT) TO service_role;

-- ── 15. wallet_persist_account — service-role (edge fn stores VA details) ───
CREATE OR REPLACE FUNCTION public.wallet_persist_account(
  p_user_id      UUID,
  p_customer_id  TEXT,
  p_va_id        TEXT,
  p_account_no   TEXT,
  p_account_bank TEXT,
  p_account_name TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('kudi.allow_wallet_write', '1', true);
  UPDATE public.wallets SET
    flw_customer_id        = COALESCE(p_customer_id,  flw_customer_id),
    flw_virtual_account_id = COALESCE(p_va_id,        flw_virtual_account_id),
    flw_account_number     = COALESCE(p_account_no,   flw_account_number),
    flw_account_bank       = COALESCE(p_account_bank, flw_account_bank),
    flw_account_name       = COALESCE(p_account_name, flw_account_name)
  WHERE user_id = p_user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_persist_account(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wallet_persist_account(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- ── 16. wallet_reconcile — read-only drift check (ops / tests) ──────────────
CREATE OR REPLACE FUNCTION public.wallet_reconcile()
RETURNS TABLE (user_id UUID, stored_kobo BIGINT, ledger_kobo BIGINT, drift_kobo BIGINT)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  -- Every ledger row that actually moved money counts, including 'reversed' ones:
  -- a reversed debit really happened and is offset by a later reversal credit, so
  -- both belong in the sum. Only 'failed' rows (movement never occurred) are excluded.
  WITH agg AS (
    SELECT w.id, w.user_id, w.balance_kobo,
      COALESCE(SUM(CASE
        WHEN l.status = 'failed' THEN 0
        WHEN l.direction = 'credit' THEN  l.amount_kobo
        WHEN l.direction = 'debit'  THEN -l.amount_kobo
        ELSE 0 END), 0) AS ledger_kobo
    FROM public.wallets w
    LEFT JOIN public.wallet_ledger l ON l.wallet_id = w.id
    GROUP BY w.id, w.user_id, w.balance_kobo
  )
  SELECT user_id, balance_kobo AS stored_kobo, ledger_kobo,
         balance_kobo - ledger_kobo AS drift_kobo
  FROM agg;
$$;
REVOKE ALL ON FUNCTION public.wallet_reconcile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wallet_reconcile() TO service_role;
