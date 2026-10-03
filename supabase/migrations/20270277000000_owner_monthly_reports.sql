-- ═════════════════════════════════════════════════════════════════════════════
-- Owner monthly reports (2026-10-03): on the 1st of every month each business owner is sent LAST month's
-- General Business Report and Wallet Statement — the same PDFs the Reports page makes (drawn on the server by the
-- app's own shared report code, src/shared → supabase/functions/_shared/app) — as an in-app notification + push and an
-- email with both PDFs attached. Each PDF carries a verify reference + QR code.
--
-- pg_cron (days 1–3, every 10 min, 07:05–21:55 WAT) → owner_reports_trigger() → pg_net → edge function
-- `owner-reports` (cron-secret auth). owner_monthly_reports records what went out (claimed before sending, never twice,
-- failed emails retried up to 3 times). Switches: platform_config owner_reports_enabled / owner_reports_first_month;
-- each owner can turn the email off on the Reports page (profiles.monthly_reports_email).
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS monthly_reports_email boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.owner_monthly_reports (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month        date        NOT NULL CHECK (month = date_trunc('month', month)::date),
  status       text        NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'failed')),
  attempts     integer     NOT NULL DEFAULT 1,
  business     jsonb,      -- headline figures only (revenue, gross/net profit, money in/out)
  wallet       jsonb,      -- opening, in, out, closing
  notified_at  timestamptz,
  emailed_at   timestamptz,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, month)
);
ALTER TABLE public.owner_monthly_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.owner_monthly_reports FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.owner_monthly_reports TO authenticated;
GRANT ALL ON public.owner_monthly_reports TO service_role;
DROP POLICY IF EXISTS owner_monthly_reports_read_own ON public.owner_monthly_reports;
CREATE POLICY owner_monthly_reports_read_own ON public.owner_monthly_reports
  FOR SELECT TO authenticated USING (owner_id = auth.uid());

INSERT INTO public.platform_config (key, value, description) VALUES
  ('owner_reports_enabled', 'true', 'Send business owners last month''s Business Report + Wallet Statement (in-app, push and email) on the 1st'),
  ('owner_reports_first_month', '2026-10', 'First month (YYYY-MM) the owner monthly reports are sent for')
ON CONFLICT (key) DO NOTHING;

-- Owners due their reports for p_month: a business, not a closed account, and either recorded something that month or
-- hold a wallet balance. Never twice: sent ones skipped, failed ones retried up to 3 times.
CREATE OR REPLACE FUNCTION public.owner_report_candidates(p_month date, p_limit integer DEFAULT 2)
 RETURNS TABLE (owner_id uuid, owner_email text, wants_email boolean, business_name text)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT COALESCE((SELECT value FROM public.platform_config WHERE key = 'owner_reports_enabled'), 'true') = 'true' AS on_,
           COALESCE((SELECT value FROM public.platform_config WHERE key = 'owner_reports_first_month'), '2026-10') AS first_m
  ), b AS (
    SELECT date_trunc('month', p_month)::date AS m,
           (date_trunc('month', p_month)::date + interval '1 month' - interval '1 day')::date AS last_day,
           (date_trunc('month', p_month)::date::text || ' 00:00:00+01')::timestamptz AS t0,
           ((date_trunc('month', p_month)::date + interval '1 month')::date::text || ' 00:00:00+01')::timestamptz AS t1
  )
  SELECT p.id, NULLIF(btrim(COALESCE(p.email, u.email, '')), '')::text, p.monthly_reports_email, p.business_name::text
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
    CROSS JOIN cfg
    CROSS JOIN b
   WHERE cfg.on_
     AND to_char(b.m, 'YYYY-MM') >= cfg.first_m
     AND btrim(COALESCE(p.business_name, '')) <> ''
     AND (u.banned_until IS NULL OR u.banned_until < now())          -- a deleted account is banned, never mailed
     AND COALESCE(u.email, '') NOT LIKE 'deleted+%'
     AND (
          EXISTS (SELECT 1 FROM public.transactions t
                   WHERE t.user_id = p.id AND t.transaction_date >= b.m AND t.transaction_date <= b.last_day)
       OR EXISTS (SELECT 1 FROM public.wallet_ledger l WHERE l.user_id = p.id AND l.created_at >= b.t0 AND l.created_at < b.t1)
       OR EXISTS (SELECT 1 FROM public.wallets w WHERE w.user_id = p.id AND w.balance_kobo > 0)
     )
     AND NOT EXISTS (
          SELECT 1 FROM public.owner_monthly_reports r
           WHERE r.owner_id = p.id AND r.month = b.m
             AND (r.status = 'sent' OR r.attempts >= 3
                  OR (r.status = 'sending' AND r.updated_at > now() - interval '30 minutes'))
     )
   ORDER BY p.id
   LIMIT GREATEST(p_limit, 0)
$function$;

CREATE OR REPLACE FUNCTION public.owner_report_claim(p_owner_id uuid, p_month date)
 RETURNS TABLE (report_id uuid, notified boolean, emailed boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  INSERT INTO public.owner_monthly_reports AS r (owner_id, month, status, attempts, updated_at)
  VALUES (p_owner_id, date_trunc('month', p_month)::date, 'sending', 1, now())
  ON CONFLICT (owner_id, month) DO UPDATE
     SET status = 'sending', attempts = r.attempts + 1, updated_at = now()
   WHERE r.attempts < 3
     AND (r.status = 'failed' OR (r.status = 'sending' AND r.updated_at < now() - interval '30 minutes'))
  RETURNING r.id, r.notified_at IS NOT NULL, r.emailed_at IS NOT NULL
$function$;

CREATE OR REPLACE FUNCTION public.owner_report_finish(
  p_id uuid, p_status text, p_business jsonb, p_wallet jsonb, p_notified boolean, p_emailed boolean, p_note text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE public.owner_monthly_reports
     SET status      = CASE WHEN p_status IN ('sent', 'failed') THEN p_status ELSE status END,
         business    = COALESCE(p_business, business),
         wallet      = COALESCE(p_wallet, wallet),
         notified_at = CASE WHEN p_notified THEN COALESCE(notified_at, now()) ELSE notified_at END,
         emailed_at  = CASE WHEN p_emailed  THEN COALESCE(emailed_at,  now()) ELSE emailed_at  END,
         note        = left(p_note, 300),
         updated_at  = now()
   WHERE id = p_id
$function$;

CREATE OR REPLACE FUNCTION public.owner_reports_trigger()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_secret text;
BEGIN
  IF COALESCE((SELECT value FROM public.platform_config WHERE key = 'owner_reports_enabled'), 'true') <> 'true' THEN
    RETURN;
  END IF;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret';
  IF v_secret IS NULL THEN
    RAISE WARNING 'owner_reports_trigger: no cron_secret in vault — skipped';
    RETURN;
  END IF;
  PERFORM net.http_post(
    url     := 'https://eztohcuzbxxxvnondxfz.supabase.co/functions/v1/owner-reports',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6dG9oY3V6Ynh4eHZub25keGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1MDgwMDMsImV4cCI6MjA5NjA4NDAwM30.YxqPCnNu5FjWmn7A3m9V7nFkomeGi6EyrNLzsHUfCt0',
      'x-cron-secret', v_secret
    ),
    body    := jsonb_build_object('limit', 2)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.owner_report_candidates(date, integer)                               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.owner_report_claim(uuid, date)                                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.owner_report_finish(uuid, text, jsonb, jsonb, boolean, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.owner_reports_trigger()                                              FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_report_candidates(date, integer)                               TO service_role;
GRANT EXECUTE ON FUNCTION public.owner_report_claim(uuid, date)                                       TO service_role;
GRANT EXECUTE ON FUNCTION public.owner_report_finish(uuid, text, jsonb, jsonb, boolean, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.owner_reports_trigger()                                              TO service_role;

-- Days 1–3, every 10 minutes 06:05–20:55 UTC (07:05–21:55 WAT, 5 minutes after the client statements): 2 owners a run.
DO $cron$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'owner-monthly-reports';
  PERFORM cron.schedule('owner-monthly-reports', '5-59/10 6-20 1-3 * *', 'SELECT public.owner_reports_trigger()');
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'owner-monthly-reports: cron not scheduled: %', SQLERRM;
END
$cron$;

-- Visibility (counts only)
DO $$
BEGIN
  RAISE NOTICE 'owner reports: % business owners; due for 2026-09 = % (first month is 2026-10); for 2026-10 so far = %',
    (SELECT count(*) FROM public.profiles WHERE btrim(COALESCE(business_name, '')) <> ''),
    (SELECT count(*) FROM public.owner_report_candidates('2026-09-01', 100000)),
    (SELECT count(*) FROM public.owner_report_candidates('2026-10-01', 100000));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'owner reports readout failed: %', SQLERRM;
END
$$;
