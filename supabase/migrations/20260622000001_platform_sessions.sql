-- Platform-wide session log (all user types)
CREATE TABLE IF NOT EXISTS platform_sessions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL,
  user_type   text        NOT NULL CHECK (user_type IN ('business','staff','ajo_client','org_member','marketer','admin')),
  username    text,
  email       text,
  ip_address  text,
  city        text,
  country     text,
  latitude    double precision,
  longitude   double precision,
  device_type text,
  browser     text,
  os_name     text,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_sessions_user_type ON platform_sessions (user_type);
CREATE INDEX IF NOT EXISTS idx_platform_sessions_created_at ON platform_sessions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_sessions_user_id    ON platform_sessions (user_id);

ALTER TABLE platform_sessions ENABLE ROW LEVEL SECURITY;

-- Users can insert their own sessions (needed by main app Supabase client)
CREATE POLICY "users_insert_own_session" ON platform_sessions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Only service_role (admin portal) can SELECT/DELETE
-- The admin portal uses supabaseAdmin (service_role) which bypasses RLS
