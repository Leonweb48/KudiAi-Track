-- ═════════════════════════════════════════════════════════════════════════════
-- Phase 1 verification — fires two test requests over pg_net. Changes no data.
--
--  1. ajo-overdue-reminders in override mode: runs the WHOLE chain (edge function
--     → admin email pipeline → SMTP) but addresses the single reminder to the
--     business owner's own inbox, and never marks any client as emailed.
--  2. notify-send `push-existing` with a random notification id: proves the
--     database → edge-function path and its cron-secret gate are wired (the
--     expected answer is HTTP 404 "notification not found" — i.e. it got past
--     authentication and looked the row up).
--
-- pg_net delivers after this transaction commits; the next migration
-- (…143) waits and prints what came back.
-- ═════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_secret text;
  v_email  text;
  v_id     bigint;
BEGIN
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret';
  IF v_secret IS NULL THEN
    RAISE NOTICE 'no cron_secret in vault — nothing fired';
    RETURN;
  END IF;

  SELECT email INTO v_email FROM public.profiles WHERE id = 'fef18c36-867b-4740-926d-7399e6aa6596';
  IF v_email IS NULL THEN
    RAISE NOTICE 'owner profile has no email — overdue chain test skipped';
  ELSE
    SELECT net.http_post(
      url     := 'https://eztohcuzbxxxvnondxfz.supabase.co/functions/v1/ajo-overdue-reminders',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6dG9oY3V6Ynh4eHZub25keGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1MDgwMDMsImV4cCI6MjA5NjA4NDAwM30.YxqPCnNu5FjWmn7A3m9V7nFkomeGi6EyrNLzsHUfCt0', 'x-cron-secret', v_secret),
      body    := jsonb_build_object('override_email', v_email)
    ) INTO v_id;
    RAISE NOTICE 'fired ajo-overdue-reminders (test override, to the owner''s own inbox): request %', v_id;
  END IF;

  SELECT net.http_post(
    url     := 'https://eztohcuzbxxxvnondxfz.supabase.co/functions/v1/notify-send',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6dG9oY3V6Ynh4eHZub25keGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1MDgwMDMsImV4cCI6MjA5NjA4NDAwM30.YxqPCnNu5FjWmn7A3m9V7nFkomeGi6EyrNLzsHUfCt0', 'x-cron-secret', v_secret),
    body    := jsonb_build_object('action', 'push-existing', 'notification_id', gen_random_uuid())
  ) INTO v_id;
  RAISE NOTICE 'fired notify-send push-existing (random id): request %', v_id;
END
$$;
