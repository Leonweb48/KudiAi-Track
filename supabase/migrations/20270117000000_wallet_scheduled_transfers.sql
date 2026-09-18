-- ═════════════════════════════════════════════════════════════════════════════
-- Wallet banking-polish Phase D2: scheduled/recurring bank transfers.
--
-- Authorization model (confirmed with the owner before building this): the
-- interactive PIN gate has nothing to check at 3am, so a scheduled transfer
-- is authorized ONCE at creation (the owner enters their PIN to set up the
-- standing instruction, same pin-manager flow as an instant transfer) — never
-- again after that. Every unattended run still independently re-verifies
-- balance and BOTH caps (per-transfer + the daily cumulative cap from
-- 20261209000000_wallet_instant_transfer.sql) exactly like a manual transfer
-- would, via the same wallet_hold_transfer RPC, and always fires the Phase A
-- debit notification when money actually moves. A run that can't be covered
-- pauses the series (status='paused') rather than silently retrying forever
-- or skipping to the next period unnoticed.
--
-- This project has never called an edge function from pg_cron before — every
-- existing cron job (ajo-wallet-payout-settle, etc.) only ever moves money
-- internally via plain SQL. A scheduled BANK transfer needs an HTTP call out
-- to Flutterwave, which only the flutterwave edge function can make, so this
-- introduces pg_net for the first time. The HTTP call carries a shared
-- secret (Supabase Vault, name 'cron_secret' — set by the owner outside this
-- migration; this SQL never embeds the actual secret value) so the edge
-- function can tell an internal cron-triggered request apart from a public
-- one — defense in depth on top of the balance/cap re-checks, which remain
-- the real authority.
-- ═════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── 1. Table ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wallet_scheduled_transfers (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bank_code       TEXT        NOT NULL,
  account_number  TEXT        NOT NULL,
  account_name    TEXT        NOT NULL,
  amount_kobo     BIGINT      NOT NULL CHECK (amount_kobo >= 10000),
  narration       TEXT        NOT NULL DEFAULT '',
  book_expense    BOOLEAN     NOT NULL DEFAULT false,
  frequency       TEXT        NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  next_run_at     TIMESTAMPTZ NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'running', 'paused', 'cancelled')),
  last_run_at     TIMESTAMPTZ,
  last_run_status TEXT,
  last_run_error  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wallet_sched_due
  ON public.wallet_scheduled_transfers (status, next_run_at)
  WHERE status = 'active';

ALTER TABLE public.wallet_scheduled_transfers ENABLE ROW LEVEL SECURITY;

-- Read-only for the owner — every write (create/pause/resume/cancel) goes
-- through a SECURITY DEFINER RPC below, same discipline as wallet_ledger and
-- wallet_payment_requests (this table can move real money, unattended).
CREATE POLICY "wallet_sched_owner_select" ON public.wallet_scheduled_transfers
  FOR SELECT USING (owner_id = auth.uid());

-- ── 2. Create — owner-callable, called only AFTER PIN verification + name
--    resolution have already happened (flutterwave/index.ts's new
--    "schedule-transfer" action does both, same as an instant transfer,
--    before calling this) ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wallet_create_scheduled_transfer(
  p_bank_code      TEXT,
  p_account_number TEXT,
  p_account_name   TEXT,
  p_amount_kobo    BIGINT,
  p_narration      TEXT DEFAULT '',
  p_book_expense   BOOLEAN DEFAULT false,
  p_frequency      TEXT DEFAULT 'monthly',
  p_start_at       TIMESTAMPTZ DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_id   UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_amount_kobo IS NULL OR p_amount_kobo < 10000 THEN RAISE EXCEPTION 'Minimum transfer is ₦100'; END IF;
  IF COALESCE(p_bank_code, '') = '' OR COALESCE(p_account_number, '') = '' OR COALESCE(p_account_name, '') = '' THEN
    RAISE EXCEPTION 'Recipient details are required';
  END IF;
  IF p_frequency NOT IN ('daily', 'weekly', 'monthly') THEN RAISE EXCEPTION 'Invalid frequency'; END IF;

  INSERT INTO public.wallet_scheduled_transfers (
    owner_id, bank_code, account_number, account_name, amount_kobo,
    narration, book_expense, frequency, next_run_at
  ) VALUES (
    v_uid, p_bank_code, p_account_number, p_account_name, p_amount_kobo,
    COALESCE(NULLIF(trim(p_narration), ''), 'Scheduled transfer'), COALESCE(p_book_expense, false),
    p_frequency, COALESCE(p_start_at, now())
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.wallet_create_scheduled_transfer(TEXT, TEXT, TEXT, BIGINT, TEXT, BOOLEAN, TEXT, TIMESTAMPTZ) TO authenticated;

-- ── 3. Pause / resume / cancel — owner-callable ───────────────────────────────
CREATE OR REPLACE FUNCTION public.wallet_set_scheduled_transfer_status(p_id UUID, p_status TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_status NOT IN ('active', 'paused', 'cancelled') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  UPDATE public.wallet_scheduled_transfers
  SET status = p_status
  WHERE id = p_id AND owner_id = auth.uid() AND status <> 'cancelled' AND status <> 'running';
  IF NOT FOUND THEN RAISE EXCEPTION 'Scheduled transfer not found, already cancelled, or currently running'; END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.wallet_set_scheduled_transfer_status(UUID, TEXT) TO authenticated;

-- ── 4. Advance next_run_at by frequency, from whenever it was due (not "now")
--    so a late-running cron tick doesn't compound drift into future runs ────
CREATE OR REPLACE FUNCTION public.wallet_next_scheduled_run(p_from TIMESTAMPTZ, p_frequency TEXT)
RETURNS TIMESTAMPTZ LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_frequency
    WHEN 'daily'  THEN p_from + INTERVAL '1 day'
    WHEN 'weekly' THEN p_from + INTERVAL '7 days'
    ELSE               p_from + INTERVAL '1 month'
  END;
$$;

-- ── 5. Called by the edge function after it processes one run — books the
--    outcome and either advances to the next cycle or pauses the series.
--    Owner-facing money movement (wallet_hold_transfer, the actual disburse
--    call, the debit notification) all happens in the edge function itself,
--    exactly like an instant transfer — this only updates the schedule's own
--    bookkeeping, service-role only. ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wallet_record_scheduled_run(
  p_id UUID, p_success BOOLEAN, p_error TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.wallet_scheduled_transfers;
BEGIN
  SELECT * INTO v_row FROM public.wallet_scheduled_transfers WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF p_success THEN
    UPDATE public.wallet_scheduled_transfers
    SET status = 'active',
        next_run_at = public.wallet_next_scheduled_run(v_row.next_run_at, v_row.frequency),
        last_run_at = now(), last_run_status = 'success', last_run_error = NULL
    WHERE id = p_id;
  ELSE
    -- Pause, don't retry silently or skip to the next period unnoticed — the
    -- owner needs to see why and explicitly resume.
    UPDATE public.wallet_scheduled_transfers
    SET status = 'paused',
        last_run_at = now(), last_run_status = 'failed', last_run_error = p_error
    WHERE id = p_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_record_scheduled_run(UUID, BOOLEAN, TEXT) FROM PUBLIC, authenticated, anon;
GRANT  EXECUTE ON FUNCTION public.wallet_record_scheduled_run(UUID, BOOLEAN, TEXT) TO service_role;

-- ── 6. Cron dispatcher — finds due rows, hands each to the edge function via
--    pg_net (async), and self-heals any row stuck in 'running' because its
--    edge call never came back (network hiccup, cold start, etc.) ───────────
CREATE OR REPLACE FUNCTION public.wallet_run_scheduled_transfers()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row    RECORD;
  v_secret TEXT;
BEGIN
  -- Self-heal: a row stuck 'running' for >10 min never got a response back —
  -- release it so the next tick retries rather than leaving it stranded.
  UPDATE public.wallet_scheduled_transfers
  SET status = 'active'
  WHERE status = 'running' AND last_run_at < now() - INTERVAL '10 minutes';

  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret';
  IF v_secret IS NULL THEN
    RAISE WARNING 'wallet_run_scheduled_transfers: cron_secret not set in Vault yet — skipping this run';
    RETURN;
  END IF;

  FOR v_row IN
    SELECT id FROM public.wallet_scheduled_transfers
    WHERE status = 'active' AND next_run_at <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.wallet_scheduled_transfers SET status = 'running', last_run_at = now() WHERE id = v_row.id;

    PERFORM net.http_post(
      url     := 'https://eztohcuzbxxxvnondxfz.supabase.co/functions/v1/flutterwave',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
      body    := jsonb_build_object('action', 'process-scheduled-transfer', 'scheduled_transfer_id', v_row.id)
    );
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_run_scheduled_transfers() FROM PUBLIC, authenticated, anon;

-- Every 15 minutes — same-day latency for a due transfer, matching what an
-- unattended standing instruction reasonably needs (not real-time).
SELECT cron.schedule(
  'wallet-scheduled-transfers',
  '*/15 * * * *',
  'SELECT public.wallet_run_scheduled_transfers()'
);

-- ── 7. Service-role-only hold for an unattended run ───────────────────────────
-- A deliberate near-duplicate of wallet_hold_transfer
-- (20261209000000_wallet_instant_transfer.sql), not a refactor to share code
-- with it — that function resolves whose wallet to debit from auth.uid()
-- (the live user's own session), which is exactly right for an interactive
-- transfer and exactly wrong for a service-role-invoked unattended one (there
-- is no user session; auth.uid() would be NULL). Rather than weaken that
-- function's identity check to accept an overridable owner id — which would
-- let an authenticated caller potentially target someone else's wallet — this
-- takes p_owner_id explicitly and is granted to service_role only, never
-- authenticated, so it can't be called directly by any client. Same
-- balance / per-transfer-cap / daily-cap checks, same ledger + withdrawal
-- insert shape, source='withdrawal' so it renders through the exact same
-- receipt branch and is included in the exact same daily-cap sum a manual
-- transfer already uses — the only addition is meta.scheduled_transfer_id.
CREATE OR REPLACE FUNCTION public.wallet_hold_scheduled_transfer(
  p_owner_id       UUID,
  p_scheduled_id   UUID,
  p_amount_kobo    BIGINT,
  p_bank_code      TEXT,
  p_account_number TEXT,
  p_account_name   TEXT,
  p_narration      TEXT DEFAULT '',
  p_book_expense   BOOLEAN DEFAULT false
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wallet    public.wallets;
  v_ledger    public.wallet_ledger;
  v_new       BIGINT;
  v_wd_id     UUID;
  v_today_out BIGINT;
  v_narr      TEXT := COALESCE(NULLIF(trim(p_narration), ''), 'Scheduled transfer');
BEGIN
  IF p_amount_kobo IS NULL OR p_amount_kobo < 10000 THEN RAISE EXCEPTION 'Minimum transfer is ₦100'; END IF;
  IF COALESCE(p_bank_code, '') = '' OR COALESCE(p_account_number, '') = '' THEN
    RAISE EXCEPTION 'Bank and account number are required';
  END IF;
  IF p_amount_kobo > public.wallet_cfg('wallet_max_withdrawal_kobo', 5000000) THEN
    RAISE EXCEPTION 'That is above the per-transfer limit';
  END IF;

  PERFORM set_config('kudi.allow_wallet_write', '1', true);

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = p_owner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No wallet'; END IF;
  IF v_wallet.status <> 'active' THEN RAISE EXCEPTION 'Wallet is not active'; END IF;
  IF v_wallet.balance_kobo < p_amount_kobo THEN
    RAISE EXCEPTION 'Insufficient wallet balance' USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(SUM(amount_kobo), 0) INTO v_today_out
  FROM public.wallet_ledger
  WHERE user_id = p_owner_id AND source = 'withdrawal'
    AND status IN ('pending', 'completed')
    AND created_at >= date_trunc('day', now());
  IF v_today_out + p_amount_kobo > public.wallet_cfg('wallet_daily_withdrawal_cap_kobo', 10000000) THEN
    RAISE EXCEPTION 'Daily transfer limit reached';
  END IF;

  v_new := v_wallet.balance_kobo - p_amount_kobo;
  UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_wallet.id;

  INSERT INTO public.wallet_ledger (
    wallet_id, user_id, direction, amount_kobo, balance_after_kobo, source, status, narration, meta
  ) VALUES (
    v_wallet.id, p_owner_id, 'debit', p_amount_kobo, v_new, 'withdrawal', 'pending', v_narr,
    jsonb_build_object('scheduled_transfer_id', p_scheduled_id)
  ) RETURNING * INTO v_ledger;

  INSERT INTO public.wallet_withdrawals (
    wallet_id, user_id, amount_kobo, bank_code, account_number, account_name,
    status, ledger_id, narration, book_expense
  ) VALUES (
    v_wallet.id, p_owner_id, p_amount_kobo, p_bank_code, p_account_number, p_account_name,
    'processing', v_ledger.id, v_narr, COALESCE(p_book_expense, false)
  ) RETURNING id INTO v_wd_id;

  RETURN v_wd_id;
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_hold_scheduled_transfer(UUID, UUID, BIGINT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, authenticated, anon;
GRANT  EXECUTE ON FUNCTION public.wallet_hold_scheduled_transfer(UUID, UUID, BIGINT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO service_role;
