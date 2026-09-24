-- Automates the old-wallet-number deadline so nothing depends on anyone remembering it.
--
-- flw_legacy_deadline_watch() runs HOURLY. While the business account is active, a grace deadline is set and some wallets still
-- have an OLD number, it:
--   • inside the last 48 h (and again inside the last 12 h) sends each of those holders an in-app reminder (bell + push where they
--     have a device), once per threshold — and once more after the deadline has passed;
--   • from 48 h out, asks the flutterwave function to email each of them a reminder (remind-migration; idempotent per wallet);
--   • from 48 h out, puts ONE alert per day in the admin notifications saying how many wallets still haven't moved.
-- It does nothing before that window, once every wallet has moved, or when no deadline is set.

ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS migration_reminded_at timestamptz;

CREATE OR REPLACE FUNCTION public.flw_mark_migration_reminded(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('kudi.allow_wallet_write', '1', true);   -- wallets is write-guarded
  UPDATE public.wallets SET migration_reminded_at = now() WHERE user_id = p_user_id AND migration_reminded_at IS NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.flw_mark_migration_reminded(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.flw_mark_migration_reminded(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.flw_legacy_deadline_watch()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE
  v_active text;
  v_until  timestamptz;
  v_left   integer;
  v_secret text;
  v_when   text;
  v_tag    text;
BEGIN
  SELECT value INTO v_active FROM public.platform_config WHERE key = 'flw_active_account';
  BEGIN
    SELECT NULLIF(value, '')::timestamptz INTO v_until FROM public.platform_config WHERE key = 'flw_legacy_grace_until';
  EXCEPTION WHEN others THEN v_until := NULL;   -- an unreadable deadline never triggers anything
  END;
  IF COALESCE(v_active, '') <> 'business' OR v_until IS NULL THEN RETURN; END IF;

  SELECT count(*) INTO v_left FROM public.wallets WHERE flw_account = 'legacy' AND flw_account_number IS NOT NULL;
  IF v_left = 0 THEN RETURN; END IF;
  IF now() < v_until - interval '48 hours' THEN RETURN; END IF;

  v_when := to_char(v_until AT TIME ZONE 'Africa/Lagos', 'FMDD Mon YYYY "at" FMHH12:MI AM') || ' WAT';

  -- ── in-app reminder to each holder, once per threshold ───────────────────────────────────────────────────────────
  v_tag := CASE WHEN now() >= v_until THEN 'expired' WHEN now() >= v_until - interval '12 hours' THEN '12h' ELSE '48h' END;
  INSERT INTO public.notifications (user_id, type, title, body, deep_link, priority, category, dedupe_key)
  SELECT w.user_id, 'wallet_account_change',
         CASE WHEN v_tag = 'expired' THEN 'Your old wallet number has stopped working' ELSE 'Your old wallet number stops working soon' END,
         CASE WHEN v_tag = 'expired' THEN 'Log in and get your new number to receive money into your wallet again.'
              ELSE 'Get your new number before ' || v_when || ' or transfers to the old one will no longer reach your wallet.' END,
         jsonb_build_object('tab', 'wallet', 'openWallet', true), 'high', 'money',
         'wallet_account_change:' || v_tag || ':' || w.user_id::text
    FROM public.wallets w
   WHERE w.flw_account = 'legacy' AND w.flw_account_number IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.notifications n
                      WHERE n.user_id = w.user_id AND n.dedupe_key = 'wallet_account_change:' || v_tag || ':' || w.user_id::text);

  -- ── email reminder (the function marks each wallet, so this is a no-op once everyone has had one) ─────────────────────
  IF EXISTS (SELECT 1 FROM public.wallets WHERE flw_account = 'legacy' AND flw_account_number IS NOT NULL AND migration_reminded_at IS NULL) THEN
    SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret';
    IF v_secret IS NOT NULL THEN
      PERFORM net.http_post(
        url     := 'https://eztohcuzbxxxvnondxfz.supabase.co/functions/v1/flutterwave',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
        body    := jsonb_build_object('action', 'remind-migration'),
        timeout_milliseconds := 55000
      );
    ELSE
      RAISE WARNING 'flw_legacy_deadline_watch: cron_secret is not in Vault — email reminders skipped';
    END IF;
  END IF;

  -- ── one admin alert per day ───────────────────────────────────────────────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM public.admin_notifications WHERE title LIKE 'Old wallet numbers:%' AND created_at >= date_trunc('day', now())) THEN
    INSERT INTO public.admin_notifications (type, category, title, message, metadata)
    VALUES (CASE WHEN now() >= v_until THEN 'error' ELSE 'warning' END, 'finance',
            'Old wallet numbers: ' || v_left || ' wallet(s) still not moved',
            CASE WHEN now() >= v_until
                 THEN 'The grace period ended ' || v_when || '. Deposits to old numbers are now HELD, not credited. Chase the holders, or extend flw_legacy_grace_until to accept them again.'
                 ELSE 'Old wallet numbers stop crediting on ' || v_when || '. ' || v_left || ' wallet(s) are still on an old number. Extend flw_legacy_grace_until if they need longer.' END,
            jsonb_build_object('remaining', v_left, 'deadline', v_until));
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.flw_legacy_deadline_watch() FROM PUBLIC, anon, authenticated;

-- hourly, at :07 (off the quarter-hour so it doesn't queue behind the scheduled-transfer job)
SELECT cron.unschedule('flw-legacy-deadline-watch') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'flw-legacy-deadline-watch');
SELECT cron.schedule('flw-legacy-deadline-watch', '7 * * * *', 'SELECT public.flw_legacy_deadline_watch()');

DO $$
BEGIN
  PERFORM public.flw_legacy_deadline_watch();   -- a live dry call: outside the 48-hour window it must do nothing
  RAISE NOTICE 'deadline watch installed; scheduled jobs: %', (SELECT string_agg(jobname || ' [' || schedule || ']', ', ') FROM cron.job WHERE jobname = 'flw-legacy-deadline-watch');
END $$;
