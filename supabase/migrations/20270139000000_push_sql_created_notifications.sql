-- ═════════════════════════════════════════════════════════════════════════════
-- Notifications created by SQL (pg_cron jobs, triggers) never pushed.
--
-- Only the notify-send edge function talks to FCM. Everything the database
-- inserts on its own — low-stock and milestone sweeps, collection reminders,
-- Ajo payout / shortfall alerts — landed in the bell but never reached a phone
-- or a browser, even when marked priority 'high' (measured: low_stock 10
-- created / 0 pushed, ajo_payout 3 / 0, sales_milestone 3 / 0).
--
-- Fix: an AFTER INSERT trigger hands each such row to notify-send's new
-- 'push-existing' action over pg_net, authenticated with the same Vault
-- 'cron_secret' the other SQL → edge callers use (plus the public anon key,
-- which the Supabase gateway needs to let the request through because
-- notify-send verifies JWTs).
--
-- Rows that notify-send inserts itself carry origin = 'edge' and are skipped —
-- notify-send already pushes those. Everything else defaults to origin = 'sql'.
-- push-existing applies the user's preferences and a flood guard (max 3 pushes
-- per user per 5 minutes); the trigger itself never blocks or fails an insert.
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'sql';

COMMENT ON COLUMN public.notifications.origin IS
  '''edge'' = inserted by notify-send (which pushes it itself); ''sql'' = inserted by SQL/cron/trigger (pushed by trg_push_sql_created_notification).';

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
          body    := jsonb_build_object('action', 'push-existing', 'notification_id', NEW.id)
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- A push hiccup must never fail the insert that raised it.
      RAISE WARNING 'push_sql_created_notification: %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.push_sql_created_notification() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_push_sql_created_notification ON public.notifications;
CREATE TRIGGER trg_push_sql_created_notification
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  WHEN (NEW.priority = 'high' AND NEW.origin = 'sql')
  EXECUTE FUNCTION public.push_sql_created_notification();
