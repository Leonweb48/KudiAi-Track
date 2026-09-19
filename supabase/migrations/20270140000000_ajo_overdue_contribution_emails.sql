-- ═════════════════════════════════════════════════════════════════════════════
-- Wire the caller for the `ajo_contribution_overdue` email.
--
-- Both email pipelines had a finished "your contribution is overdue" template,
-- and nothing anywhere ever triggered it. This adds the missing caller:
--
--   pg_cron (daily) → ajo_trigger_overdue_emails() → pg_net → edge function
--   `ajo-overdue-reminders` (cron-secret auth) → admin email pipeline.
--
-- Selection (ajo_get_overdue_email_candidates):
--   • active client with an email address and a contribution amount
--   • next_contribution_date has PASSED, but by no more than 30 days
--     (older than that is a stale/abandoned plan, not a reminder)
--   • not already emailed in the last 7 days (last_overdue_email_on)
-- The function emails at most p_limit clients per run: the admin email route
-- rate-limits at 30 requests/minute/IP, and a daily reminder does not need a
-- burst. The backlog drains over successive days.
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.aso_clients
  ADD COLUMN IF NOT EXISTS last_overdue_email_on date;

CREATE OR REPLACE FUNCTION public.ajo_get_overdue_email_candidates(p_limit integer DEFAULT 25)
 RETURNS TABLE (
   client_id              uuid,
   client_name            text,
   client_email           text,
   contribution_amount    numeric,
   contribution_frequency text,
   next_contribution_date date,
   current_balance        numeric,
   business_name          text
 )
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT c.id,
         c.full_name::text,
         c.email::text,
         c.contribution_amount::numeric,
         c.contribution_frequency::text,
         c.next_contribution_date::date,
         c.current_balance::numeric,
         p.business_name::text
  FROM public.aso_clients c
  LEFT JOIN public.profiles p ON p.id = c.user_id
  WHERE c.status = 'active'
    AND COALESCE(c.email, '') <> ''
    AND COALESCE(c.contribution_amount, 0) > 0
    AND c.next_contribution_date IS NOT NULL
    AND c.next_contribution_date <  CURRENT_DATE
    AND c.next_contribution_date >= CURRENT_DATE - 30
    AND (c.last_overdue_email_on IS NULL OR c.last_overdue_email_on <= CURRENT_DATE - 7)
  ORDER BY c.next_contribution_date ASC
  LIMIT GREATEST(p_limit, 0)
$function$;

CREATE OR REPLACE FUNCTION public.ajo_mark_overdue_emailed(p_client_ids uuid[])
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE public.aso_clients SET last_overdue_email_on = CURRENT_DATE WHERE id = ANY(p_client_ids)
$function$;

-- pg_cron entry point: hands the job to the edge function over pg_net.
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
    body    := jsonb_build_object('limit', 25)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ajo_get_overdue_email_candidates(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ajo_mark_overdue_emailed(uuid[])           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ajo_trigger_overdue_emails()               FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ajo_get_overdue_email_candidates(integer) TO service_role;
GRANT  EXECUTE ON FUNCTION public.ajo_mark_overdue_emailed(uuid[])           TO service_role;
GRANT  EXECUTE ON FUNCTION public.ajo_trigger_overdue_emails()               TO service_role;

-- 7:40am UTC daily (~8:40am WAT) — after the 6:30 collection reminder, before the day's collections.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ajo-overdue-contribution-emails';
SELECT cron.schedule('ajo-overdue-contribution-emails', '40 7 * * *', 'SELECT public.ajo_trigger_overdue_emails()');

-- Visibility: how many clients would be emailed on the first run?
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.ajo_get_overdue_email_candidates(100000);
  RAISE NOTICE 'ajo overdue emails: % client(s) currently eligible (first run sends the oldest 25)', n;
END
$$;
