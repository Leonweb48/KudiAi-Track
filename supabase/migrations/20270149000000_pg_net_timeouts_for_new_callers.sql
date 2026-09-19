-- pg_net gives up on a request after 5 seconds by default. That is fine for a
-- quick lookup but not for the two callers added in this work:
--   • ajo_trigger_overdue_emails(): the edge function paces itself (2.2s per
--     client, 25 clients ≈ a minute) to respect the email route's 30/min limit,
--     so it needs a long timeout — otherwise the response is cut off mid-run.
--   • push_sql_created_notification(): FCM fan-out to several devices can take a
--     couple of seconds.
-- Only the timeout changes; bodies are otherwise identical to 20270140 / 20270139.

CREATE OR REPLACE FUNCTION public.ajo_trigger_overdue_emails()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret';
  IF v_secret IS NULL THEN
    RAISE WARNING 'ajo_trigger_overdue_emails: no cron_secret in vault — skipped';
    RETURN;
  END IF;
  PERFORM net.http_post(
    url     := 'https://eztohcuzbxxxvnondxfz.supabase.co/functions/v1/ajo-overdue-reminders',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6dG9oY3V6Ynh4eHZub25keGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1MDgwMDMsImV4cCI6MjA5NjA4NDAwM30.YxqPCnNu5FjWmn7A3m9V7nFkomeGi6EyrNLzsHUfCt0',
      'x-cron-secret', v_secret
    ),
    body    := jsonb_build_object('limit', 25),
    timeout_milliseconds := 150000
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.push_sql_created_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_secret text;
BEGIN
  IF NEW.priority = 'high' AND NEW.origin = 'sql' AND NEW.last_push_at IS NULL THEN
    BEGIN
      SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret';
      IF v_secret IS NOT NULL THEN
        PERFORM net.http_post(
          url     := 'https://eztohcuzbxxxvnondxfz.supabase.co/functions/v1/notify-send',
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6dG9oY3V6Ynh4eHZub25keGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1MDgwMDMsImV4cCI6MjA5NjA4NDAwM30.YxqPCnNu5FjWmn7A3m9V7nFkomeGi6EyrNLzsHUfCt0',
            'x-cron-secret', v_secret
          ),
          body    := jsonb_build_object('action', 'push-existing', 'notification_id', NEW.id),
          timeout_milliseconds := 20000
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'push_sql_created_notification: %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.ajo_trigger_overdue_emails()       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_sql_created_notification()    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ajo_trigger_overdue_emails()   TO service_role;
