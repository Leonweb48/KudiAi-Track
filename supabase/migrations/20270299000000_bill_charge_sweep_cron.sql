-- Stuck bill-charge sweep (2026-10-12, owner approved): every 15 minutes the clubkonnect function's `bill-charge-sweep`
-- looks at wallet bill charges still pending after 30 minutes and asks the provider by the charge's own reference —
-- delivered → settled (no money moves); the provider confirms there is no order, or refused it → refunded to the wallet
-- and the customer told; unclear → left alone (admins alerted once after 48 h). First run by hand settled one delivered
-- charge and refunded the 4 Oct double charge. Same Vault cron_secret pattern as the electricity sweep (20270254).
DO $$
BEGIN
  PERFORM cron.unschedule('bill-charge-sweep') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bill-charge-sweep');
  PERFORM cron.schedule('bill-charge-sweep', '*/15 * * * *', $cron$
    DO $inner$
    DECLARE v_secret text;
    BEGIN
      SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret';
      IF v_secret IS NOT NULL THEN
        PERFORM net.http_post(
          url     := 'https://eztohcuzbxxxvnondxfz.supabase.co/functions/v1/clubkonnect',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
          body    := jsonb_build_object('action', 'bill-charge-sweep'),
          timeout_milliseconds := 120000
        );
      END IF;
    END $inner$;
  $cron$);
  RAISE NOTICE 'bill charge sweep | scheduled every 15 minutes';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'bill charge sweep | could not schedule (pg_cron unavailable?): %', SQLERRM;
END $$;
