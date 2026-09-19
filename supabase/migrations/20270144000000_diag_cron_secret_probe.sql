-- READ-ONLY-EFFECT DIAGNOSTIC — fires three harmless probes over pg_net (no data changes).
--
-- Both Phase 1 probes answered HTTP 401 from our own functions, i.e. the
-- x-cron-secret they were sent did not match the CRON_SECRET function secret.
-- To tell "my new functions are wrong" from "the Vault secret and the function
-- secret disagree everywhere", probe the OLDER, already-live mechanism too:
--   • flutterwave `process-scheduled-transfer` with a random id — answers 404
--     ("Scheduled transfer not found") if the secret is accepted, 401 if not.
--   • notify-send `push-existing` with a random id — 404 if accepted, 401 if not.
--   • ajo-overdue-reminders with no body and NO secret header — must be 401
--     (proves the gate itself works).
-- Also reports whether the Vault secret exists and its length (never its value).
DO $$
DECLARE
  v_secret text;
  v_id     bigint;
BEGIN
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret';
  RAISE NOTICE 'vault cron_secret present: %, length: %', (v_secret IS NOT NULL), coalesce(length(v_secret), 0);
  IF v_secret IS NULL THEN RETURN; END IF;

  SELECT net.http_post(
    url     := 'https://eztohcuzbxxxvnondxfz.supabase.co/functions/v1/flutterwave',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body    := jsonb_build_object('action', 'process-scheduled-transfer', 'scheduled_transfer_id', gen_random_uuid())
  ) INTO v_id;
  RAISE NOTICE 'PROBE-A flutterwave process-scheduled-transfer (random id) = request %', v_id;

  SELECT net.http_post(
    url     := 'https://eztohcuzbxxxvnondxfz.supabase.co/functions/v1/notify-send',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6dG9oY3V6Ynh4eHZub25keGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1MDgwMDMsImV4cCI6MjA5NjA4NDAwM30.YxqPCnNu5FjWmn7A3m9V7nFkomeGi6EyrNLzsHUfCt0', 'x-cron-secret', v_secret),
    body    := jsonb_build_object('action', 'push-existing', 'notification_id', gen_random_uuid())
  ) INTO v_id;
  RAISE NOTICE 'PROBE-B notify-send push-existing (random id) = request %', v_id;

  SELECT net.http_post(
    url     := 'https://eztohcuzbxxxvnondxfz.supabase.co/functions/v1/ajo-overdue-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6dG9oY3V6Ynh4eHZub25keGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1MDgwMDMsImV4cCI6MjA5NjA4NDAwM30.YxqPCnNu5FjWmn7A3m9V7nFkomeGi6EyrNLzsHUfCt0'),
    body    := '{}'::jsonb
  ) INTO v_id;
  RAISE NOTICE 'PROBE-C ajo-overdue-reminders with NO secret = request %', v_id;
END
$$;
