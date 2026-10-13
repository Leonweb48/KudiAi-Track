-- Transfer recheck on pg_cron (2026-10-13): the GitHub Actions schedule for transfer-recheck.yml never fired, so open bank
-- transfers were only rechecked by hand. Every 30 minutes the flutterwave function's `recheck-open-transfers` now runs from
-- here (Vault cron_secret, same pattern as bill-charge-sweep): transfers still pending/processing after 10 minutes are
-- looked up at Flutterwave and only those Flutterwave reports as FINAL are settled (paid → completed; failed/reversed →
-- refunded with their charges). It never refunds a transfer Flutterwave still has open or has no record of.
DO $$
BEGIN
  PERFORM cron.unschedule('transfer-recheck') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'transfer-recheck');
  PERFORM cron.schedule('transfer-recheck', '7,37 * * * *', $cron$
    DO $inner$
    DECLARE v_secret text;
    BEGIN
      SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret';
      IF v_secret IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.wallet_withdrawals WHERE status IN ('pending', 'processing') AND created_at < now() - interval '10 minutes'
      ) THEN
        PERFORM net.http_post(
          url     := 'https://eztohcuzbxxxvnondxfz.supabase.co/functions/v1/flutterwave',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
          body    := jsonb_build_object('action', 'recheck-open-transfers'),
          timeout_milliseconds := 120000
        );
      END IF;
    END $inner$;
  $cron$);
  RAISE NOTICE 'transfer recheck | scheduled at :07 and :37 (only calls out when a transfer is open)';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'transfer recheck | could not schedule (pg_cron unavailable?): %', SQLERRM;
END $$;
