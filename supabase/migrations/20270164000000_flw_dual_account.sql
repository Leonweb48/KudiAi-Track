-- ════════════════════════════════════════════════════════════════════════════
-- Two Flutterwave accounts at once (legacy = the personal account, business = the newly approved one).
--
-- A virtual account and a customer belong to the Flutterwave merchant that created them, so wallets that already
-- have a number keep living on the legacy account. This adds the bookkeeping to move them across safely:
--   • wallets.flw_account          which account this wallet's CURRENT number belongs to ('legacy' | 'business')
--   • wallets.legacy_flw_*         the previous number, kept after a wallet moves so deposits made to it during the
--                                  grace period still credit the right wallet
--   • platform_config.flw_active_account      which account new numbers / payouts use — 'legacy' until the switch
--   • platform_config.flw_legacy_grace_until  ISO deadline for the legacy account after the switch (empty = none)
--   • wallet_migrate_account()     moves a wallet's number to the business account (service role only)
--   • flw_switch_to_business()     THE SWITCH: flips the active account, starts the grace period, notifies holders
--
-- Nothing here changes behaviour by itself: every existing wallet is 'legacy', the active account stays 'legacy'.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS flw_account                   text        NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS legacy_flw_customer_id        text,
  ADD COLUMN IF NOT EXISTS legacy_flw_virtual_account_id text,
  ADD COLUMN IF NOT EXISTS legacy_flw_account_number     text,
  ADD COLUMN IF NOT EXISTS legacy_flw_account_bank       text,
  ADD COLUMN IF NOT EXISTS legacy_migrated_at            timestamptz,
  ADD COLUMN IF NOT EXISTS migration_notified_at         timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wallets_flw_account_check') THEN
    ALTER TABLE public.wallets ADD CONSTRAINT wallets_flw_account_check CHECK (flw_account IN ('legacy', 'business'));
  END IF;
END $$;

-- the webhook resolves a wallet from the customer id / account number on the event
CREATE INDEX IF NOT EXISTS wallets_flw_customer_idx        ON public.wallets (flw_customer_id)             WHERE flw_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS wallets_flw_account_number_idx  ON public.wallets (flw_account_number)          WHERE flw_account_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS wallets_legacy_customer_idx     ON public.wallets (legacy_flw_customer_id)      WHERE legacy_flw_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS wallets_legacy_account_no_idx   ON public.wallets (legacy_flw_account_number)   WHERE legacy_flw_account_number IS NOT NULL;

INSERT INTO public.platform_config (key, value) VALUES ('flw_active_account', 'legacy')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.platform_config (key, value) VALUES ('flw_legacy_grace_until', '')
ON CONFLICT (key) DO NOTHING;

-- ── wallet_persist_account: same as before, plus which account the number belongs to ───────────────────────────────
-- (the 6-argument version stays as it is; the edge function moves to this one)
CREATE OR REPLACE FUNCTION public.wallet_persist_account(
  p_user_id      UUID,
  p_customer_id  TEXT,
  p_va_id        TEXT,
  p_account_no   TEXT,
  p_account_bank TEXT,
  p_account_name TEXT,
  p_account      TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_account IS NOT NULL AND p_account NOT IN ('legacy', 'business') THEN
    RAISE EXCEPTION 'unknown Flutterwave account %', p_account;
  END IF;
  PERFORM set_config('kudi.allow_wallet_write', '1', true);
  UPDATE public.wallets SET
    flw_customer_id        = COALESCE(p_customer_id,  flw_customer_id),
    flw_virtual_account_id = COALESCE(p_va_id,        flw_virtual_account_id),
    flw_account_number     = COALESCE(p_account_no,   flw_account_number),
    flw_account_bank       = COALESCE(p_account_bank, flw_account_bank),
    flw_account_name       = COALESCE(p_account_name, flw_account_name),
    flw_account            = COALESCE(p_account,      flw_account)
  WHERE user_id = p_user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_persist_account(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.wallet_persist_account(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- ── wallet_migrate_account: move a wallet's number to the business account ─────────────────────────────────────────
-- ONE statement, so the old number is remembered and the new one installed atomically. Idempotent: a wallet that is
-- already on the business account (or has no number) is left alone and false is returned.
CREATE OR REPLACE FUNCTION public.wallet_migrate_account(
  p_user_id      UUID,
  p_customer_id  TEXT,
  p_va_id        TEXT,
  p_account_no   TEXT,
  p_account_bank TEXT,
  p_account_name TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rows integer;
BEGIN
  IF COALESCE(p_customer_id, '') = '' OR COALESCE(p_va_id, '') = '' OR COALESCE(p_account_no, '') = '' THEN
    RAISE EXCEPTION 'wallet_migrate_account needs the new customer id, virtual account id and account number';
  END IF;
  PERFORM set_config('kudi.allow_wallet_write', '1', true);
  UPDATE public.wallets SET
    legacy_flw_customer_id        = flw_customer_id,
    legacy_flw_virtual_account_id = flw_virtual_account_id,
    legacy_flw_account_number     = flw_account_number,
    legacy_flw_account_bank       = flw_account_bank,
    legacy_migrated_at            = now(),
    flw_customer_id        = p_customer_id,
    flw_virtual_account_id = p_va_id,
    flw_account_number     = p_account_no,
    flw_account_bank       = COALESCE(p_account_bank, flw_account_bank),
    flw_account_name       = COALESCE(p_account_name, flw_account_name),
    flw_account            = 'business'
  WHERE user_id = p_user_id
    AND flw_account = 'legacy'
    AND flw_account_number IS NOT NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_migrate_account(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.wallet_migrate_account(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- ── flw_switch_to_business: THE SWITCH (called deliberately, once, when the business account is ready) ─────────────
-- Makes the business account the active one, starts the grace period for the legacy account, and tells every holder of
-- a legacy number (bell + push) that a new number is available. Returns the grace deadline.
CREATE OR REPLACE FUNCTION public.flw_switch_to_business(p_grace interval DEFAULT interval '7 days')
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_until timestamptz := now() + p_grace;
  v_when  text;
BEGIN
  UPDATE public.platform_config SET value = 'business' WHERE key = 'flw_active_account';
  UPDATE public.platform_config SET value = to_char(v_until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') WHERE key = 'flw_legacy_grace_until';

  v_when := to_char(v_until AT TIME ZONE 'Africa/Lagos', 'FMDD Mon YYYY');

  INSERT INTO public.notifications (user_id, type, title, body, deep_link, priority, category, dedupe_key)
  SELECT w.user_id,
         'wallet_account_change',
         'Your wallet has a new account number',
         'Verify your BVN in Wallet to get it. Your current number keeps working until ' || v_when || '.',
         jsonb_build_object('tab', 'wallet', 'openWallet', true),
         'high', 'money',
         'wallet_account_change:' || w.user_id::text
    FROM public.wallets w
   WHERE w.flw_account = 'legacy'
     AND w.flw_account_number IS NOT NULL
     AND w.migration_notified_at IS NULL;

  PERFORM set_config('kudi.allow_wallet_write', '1', true);
  UPDATE public.wallets SET migration_notified_at = now()
   WHERE flw_account = 'legacy' AND flw_account_number IS NOT NULL AND migration_notified_at IS NULL;

  RETURN v_until;
END;
$$;
REVOKE ALL ON FUNCTION public.flw_switch_to_business(interval) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.flw_switch_to_business(interval) TO service_role;

-- ── flw_switch_back_to_legacy: emergency brake for the flag only (wallets already moved stay on their own account) ─
CREATE OR REPLACE FUNCTION public.flw_switch_back_to_legacy()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.platform_config SET value = 'legacy' WHERE key = 'flw_active_account';
  UPDATE public.platform_config SET value = ''       WHERE key = 'flw_legacy_grace_until';
$$;
REVOKE ALL ON FUNCTION public.flw_switch_back_to_legacy() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.flw_switch_back_to_legacy() TO service_role;

-- ── flw_account_status: counts for the migration (no names, no account numbers) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.flw_account_status()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'active_account',   (SELECT value FROM public.platform_config WHERE key = 'flw_active_account'),
    'grace_until',      (SELECT NULLIF(value, '') FROM public.platform_config WHERE key = 'flw_legacy_grace_until'),
    'wallets_total',    (SELECT count(*) FROM public.wallets),
    'on_legacy',        (SELECT count(*) FROM public.wallets WHERE flw_account = 'legacy'   AND flw_account_number IS NOT NULL),
    'on_business',      (SELECT count(*) FROM public.wallets WHERE flw_account = 'business' AND flw_account_number IS NOT NULL),
    'no_number',        (SELECT count(*) FROM public.wallets WHERE flw_account_number IS NULL),
    'legacy_balance_ngn', (SELECT COALESCE(sum(balance_kobo), 0) / 100.0 FROM public.wallets WHERE flw_account = 'legacy' AND flw_account_number IS NOT NULL),
    'total_balance_ngn',  (SELECT COALESCE(sum(balance_kobo), 0) / 100.0 FROM public.wallets)
  );
$$;
REVOKE ALL ON FUNCTION public.flw_account_status() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.flw_account_status() TO service_role;

DO $$
BEGIN
  RAISE NOTICE 'flw_account_status: %', public.flw_account_status();
END $$;
