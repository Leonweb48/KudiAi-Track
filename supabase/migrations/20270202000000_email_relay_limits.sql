-- Per-user sending limits for the Vercel /api/email-trigger route.
--
-- Any logged-in user can call that route, and it can address emails to third parties (clients, staff, customers), so a
-- free account could use it as a spam / phishing relay from the company domain. The route now counts what each user
-- sends and refuses once they are over a generous hourly/daily allowance. Only the route's service-role client touches
-- these objects.

CREATE TABLE IF NOT EXISTS public.email_relay_usage (
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bucket      TIMESTAMPTZ NOT NULL,                 -- start of the UTC hour
  third_party INTEGER     NOT NULL DEFAULT 0,       -- emails to anyone other than the user themselves
  total       INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, bucket)
);

ALTER TABLE public.email_relay_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_relay_usage FROM PUBLIC, anon, authenticated;

-- What has this user sent recently?
CREATE OR REPLACE FUNCTION public.email_relay_quota(p_user UUID)
 RETURNS TABLE (hour_third INTEGER, hour_total INTEGER, day_third INTEGER)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(third_party) FILTER (WHERE bucket >= date_trunc('hour', now())), 0)::int,
         COALESCE(SUM(total)       FILTER (WHERE bucket >= date_trunc('hour', now())), 0)::int,
         COALESCE(SUM(third_party) FILTER (WHERE bucket >= now() - interval '24 hours'), 0)::int
    FROM public.email_relay_usage
   WHERE user_id = p_user AND bucket >= now() - interval '24 hours';
$function$;

-- Add to the user's counters for the current hour (and drop rows older than 3 days)
CREATE OR REPLACE FUNCTION public.email_relay_record(p_user UUID, p_third INTEGER, p_total INTEGER)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_user IS NULL OR COALESCE(p_total, 0) <= 0 THEN RETURN; END IF;
  INSERT INTO public.email_relay_usage (user_id, bucket, third_party, total)
  VALUES (p_user, date_trunc('hour', now()), GREATEST(COALESCE(p_third, 0), 0), p_total)
  ON CONFLICT (user_id, bucket)
  DO UPDATE SET third_party = public.email_relay_usage.third_party + EXCLUDED.third_party,
                total       = public.email_relay_usage.total + EXCLUDED.total;
  DELETE FROM public.email_relay_usage WHERE user_id = p_user AND bucket < now() - interval '3 days';
END;
$function$;

-- Server-only (explicit: Supabase's default grants would otherwise expose these to anon/authenticated)
REVOKE ALL ON FUNCTION public.email_relay_quota(UUID)                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_relay_record(UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.email_relay_quota(UUID)                   TO service_role;
GRANT  EXECUTE ON FUNCTION public.email_relay_record(UUID, INTEGER, INTEGER) TO service_role;
