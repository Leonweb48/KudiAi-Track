-- Login Audit Enhancements — 2026-07-27
-- Run in Supabase SQL Editor.
-- Adds anomaly detection columns to platform_sessions,
-- sets up 90-day retention via pg_cron, and adds a helper function.

-- 1. Add anomaly detection columns (safe — IF NOT EXISTS)
ALTER TABLE public.platform_sessions
  ADD COLUMN IF NOT EXISTS is_new_device   BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_new_location BOOLEAN DEFAULT FALSE;

-- 2. Index so anomaly queries and the retention purge are fast
CREATE INDEX IF NOT EXISTS platform_sessions_user_created_idx
  ON public.platform_sessions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS platform_sessions_created_at_idx
  ON public.platform_sessions(created_at);

CREATE INDEX IF NOT EXISTS platform_sessions_anomaly_idx
  ON public.platform_sessions(is_new_device, is_new_location)
  WHERE is_new_device = TRUE OR is_new_location = TRUE;

-- 3. 90-day retention — scheduled daily at 03:00 UTC via pg_cron.
--    Requires the pg_cron extension to be enabled in Supabase.
--    Enable it first: Database → Extensions → pg_cron → Enable.
--
--    If pg_cron is not available on your plan, use the "Purge >90d"
--    button in the Admin → Security → All User Sessions tab instead.
SELECT cron.schedule(
  'purge-platform-sessions-90d',
  '0 3 * * *',
  $$DELETE FROM public.platform_sessions WHERE created_at < now() - INTERVAL '90 days'$$
);

-- 4. Privacy: set any stored precise coordinates to NULL.
--    New sessions no longer store lat/lon (coarse city/country only).
UPDATE public.platform_sessions SET latitude = NULL, longitude = NULL
  WHERE latitude IS NOT NULL OR longitude IS NOT NULL;

-- 5. Helper: count anomaly logins by user (useful for ad-hoc queries)
CREATE OR REPLACE FUNCTION public.anomaly_login_count(p_user_id UUID)
RETURNS BIGINT LANGUAGE SQL STABLE AS $$
  SELECT COUNT(*) FROM public.platform_sessions
  WHERE user_id = p_user_id
    AND (is_new_device = TRUE OR is_new_location = TRUE)
    AND created_at > now() - INTERVAL '90 days';
$$;
