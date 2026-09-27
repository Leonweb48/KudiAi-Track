-- New-device check: useAuth.logPlatformSession() compares this login's device type + browser (and city) with the
-- account's last 20 sessions. platform_sessions is readable only by the service role (it holds IPs and emails),
-- so the app's own SELECT always came back empty and EVERY login was flagged as a new device — the "New device
-- sign-in" selfie prompt appeared every time the app opened. This returns just the three fields the check needs,
-- for the caller's own sessions only; the table itself stays private.

CREATE OR REPLACE FUNCTION public.my_recent_session_devices()
RETURNS TABLE (device_type text, browser text, city text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.device_type, s.browser, s.city
    FROM public.platform_sessions s
   WHERE s.user_id = auth.uid()
   ORDER BY s.created_at DESC
   LIMIT 20;
$$;

REVOKE ALL ON FUNCTION public.my_recent_session_devices() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_recent_session_devices() TO authenticated, service_role;
