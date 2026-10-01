-- Electricity token sweep (2026-10-01): every 2 minutes, the clubkonnect function's `electricity-sweep` finishes prepaid
-- electricity orders still saying "Token loading..." — the app only asks for ~2 minutes and only while its screen is open,
-- and nothing ever came back later (a 26 Sept order the provider REFUNDED sat as "Token loading" for days while the customer's
-- money was gone). Token → saved on the order + customer notified; cancelled/refunded by the provider → customer's wallet
-- refunded (its own linked debit only; otherwise admins are told to refund by hand), order marked failed, customer notified.
-- Same Vault cron_secret + verify_cron_secret pattern as security-selfie-cleanup (20270231) / flw_legacy_deadline_watch.
DO $$
BEGIN
  PERFORM cron.unschedule('electricity-token-sweep') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'electricity-token-sweep');
  PERFORM cron.schedule('electricity-token-sweep', '*/2 * * * *', $cron$
    DO $inner$
    DECLARE v_secret text;
    BEGIN
      SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret';
      IF v_secret IS NOT NULL THEN
        PERFORM net.http_post(
          url     := 'https://eztohcuzbxxxvnondxfz.supabase.co/functions/v1/clubkonnect',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
          body    := jsonb_build_object('action', 'electricity-sweep'),
          timeout_milliseconds := 120000
        );
      END IF;
    END $inner$;
  $cron$);
  RAISE NOTICE 'electricity sweep | scheduled every 2 minutes';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'electricity sweep | could not schedule (pg_cron unavailable?): %', SQLERRM;
END $$;
