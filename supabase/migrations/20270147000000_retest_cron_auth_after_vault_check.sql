-- Re-fires the two Phase 1 probes after the functions were changed to check the
-- Vault (verify_cron_secret). Expected now:
--   push-existing (random id)         -> HTTP 404 "notification not found"   (auth accepted, row not found)
--   ajo-overdue-reminders (override)  -> HTTP 200 {"ok":true,...}            (auth accepted; one test email to the owner)
-- Harmless: the override run never marks a client as emailed.
DO $$
DECLARE
  v_secret text;
  v_email  text;
  v_id     bigint;
BEGIN
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret';
  IF v_secret IS NULL THEN RAISE NOTICE 'no cron_secret'; RETURN; END IF;

  SELECT net.http_post(
    url     := 'https://eztohcuzbxxxvnondxfz.supabase.co/functions/v1/notify-send',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6dG9oY3V6Ynh4eHZub25keGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1MDgwMDMsImV4cCI6MjA5NjA4NDAwM30.YxqPCnNu5FjWmn7A3m9V7nFkomeGi6EyrNLzsHUfCt0', 'x-cron-secret', v_secret),
    body    := jsonb_build_object('action', 'push-existing', 'notification_id', gen_random_uuid())
  ) INTO v_id;
  RAISE NOTICE 'RETEST-B notify-send push-existing (random id) = request %', v_id;

  SELECT email INTO v_email FROM public.profiles WHERE id = 'fef18c36-867b-4740-926d-7399e6aa6596';
  IF v_email IS NOT NULL THEN
    SELECT net.http_post(
      url     := 'https://eztohcuzbxxxvnondxfz.supabase.co/functions/v1/ajo-overdue-reminders',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6dG9oY3V6Ynh4eHZub25keGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1MDgwMDMsImV4cCI6MjA5NjA4NDAwM30.YxqPCnNu5FjWmn7A3m9V7nFkomeGi6EyrNLzsHUfCt0', 'x-cron-secret', v_secret),
      body    := jsonb_build_object('override_email', v_email)
    ) INTO v_id;
    RAISE NOTICE 'RETEST-C ajo-overdue-reminders (test override) = request %', v_id;
  END IF;
END
$$;
