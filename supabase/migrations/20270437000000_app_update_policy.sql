-- App update gate (2026-10-28): the admin decides which Android builds may still be used.
--   min_build    — an installed app whose build (Play versionCode = APK run number, e.g. 192) is BELOW this shows a
--                  full-screen "Update required" page with a button to the Play Store and can't be used until updated.
--   latest_build — below this (but not below min_build) the app shows a dismissible "A new version is available" bar.
--   message      — optional extra line from the admin on the update page.
-- 0 switches either one off. Only the Android app checks it (the website is always the latest version).
-- The gate itself reaches phones through the automatic (Capgo) update, so it protects every build from 192 on.
-- Read: anyone (the app checks before sign-in) — holiday_caps / receipt_themes pattern. Write: service role (admin portal).
CREATE TABLE IF NOT EXISTS public.app_update_policy (
  id           smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  min_build    integer NOT NULL DEFAULT 0 CHECK (min_build BETWEEN 0 AND 100000),
  latest_build integer NOT NULL DEFAULT 0 CHECK (latest_build BETWEEN 0 AND 100000),
  message      text CHECK (message IS NULL OR length(btrim(message)) BETWEEN 1 AND 160),
  updated_by   text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_update_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_update_policy FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, min_build, latest_build, message, updated_at) ON public.app_update_policy TO anon, authenticated;
GRANT ALL ON public.app_update_policy TO service_role;

DROP POLICY IF EXISTS app_update_policy_read ON public.app_update_policy;
CREATE POLICY app_update_policy_read ON public.app_update_policy FOR SELECT TO anon, authenticated USING (true);

-- 192 = the current Play build (1.192.0). No phone on 192 or newer is blocked by this; it only arms the gate.
INSERT INTO public.app_update_policy (id, min_build, latest_build, updated_by)
VALUES (1, 192, 192, 'setup')
ON CONFLICT (id) DO NOTHING;
