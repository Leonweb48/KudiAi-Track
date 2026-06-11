-- ═══════════════════════════════════════════════════════════════
-- KUDITRACK SUPER ADMIN SYSTEM
-- ═══════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1. Admin Users ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_users (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  username          TEXT        UNIQUE NOT NULL,
  password_hash     TEXT        NOT NULL,
  email             TEXT,
  role              TEXT        DEFAULT 'support_admin'
                    CHECK (role IN ('super_admin','finance_admin','operations_admin',
                                   'support_admin','marketing_admin','compliance_admin')),
  can_create_admins BOOLEAN     DEFAULT false,
  is_active         BOOLEAN     DEFAULT true,
  last_login        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Seed first Super Admin: username=SuperAdmin, password=HI2026@pass1word
INSERT INTO admin_users (username, password_hash, email, role, can_create_admins)
VALUES (
  'SuperAdmin',
  extensions.crypt('HI2026@pass1word', extensions.gen_salt('bf')),
  'admin@kuditrack.app',
  'super_admin',
  true
) ON CONFLICT (username) DO NOTHING;

-- Helper RPC: verify password
CREATE OR REPLACE FUNCTION verify_admin_password(p_username TEXT, p_password TEXT)
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM admin_users
    WHERE username = p_username
      AND is_active = true
      AND password_hash = extensions.crypt(p_password, password_hash)
  );
$$;

-- Helper RPC: hash password (used when creating new admins)
CREATE OR REPLACE FUNCTION hash_admin_password(p_password TEXT)
RETURNS TEXT LANGUAGE SQL SECURITY DEFINER AS $$
  SELECT extensions.crypt(p_password, extensions.gen_salt('bf'));
$$;

-- ── 2. Admin Audit Log ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_id       UUID        REFERENCES admin_users(id) ON DELETE SET NULL,
  admin_username TEXT        NOT NULL,
  action         TEXT        NOT NULL,
  target_type    TEXT,
  target_id      TEXT,
  details        TEXT,
  ip_address     TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_admin  ON admin_audit_log(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON admin_audit_log(action, created_at DESC);

-- ── 3. Security Events ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS security_events (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type  TEXT        NOT NULL,
  description TEXT,
  ip_address  TEXT,
  user_id     UUID,
  severity    TEXT        DEFAULT 'medium'
              CHECK (severity IN ('critical','high','medium','low','info')),
  resolved    BOOLEAN     DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_severity ON security_events(severity, created_at DESC);

-- ── 4. System Errors ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_errors (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  error_type  TEXT        NOT NULL,
  message     TEXT,
  location    TEXT,
  severity    TEXT        DEFAULT 'medium',
  user_id     UUID,
  stack_trace TEXT,
  resolved    BOOLEAN     DEFAULT false,
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_errors_resolved ON system_errors(resolved, created_at DESC);

-- ── 5. Admin Broadcasts ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_broadcasts (
  id       UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  title    TEXT        NOT NULL,
  message  TEXT        NOT NULL,
  segment  TEXT        DEFAULT 'all',
  channel  TEXT        DEFAULT 'in_app',
  status   TEXT        DEFAULT 'pending',
  sent_at  TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── RLS: admin tables are not accessible by regular users ─────────────────────
ALTER TABLE admin_users       ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_log   ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_errors     ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_broadcasts  ENABLE ROW LEVEL SECURITY;

-- No public access — only service role key (used by admin dashboard) can access these tables
-- Service role bypasses RLS entirely, so no policies needed for the admin app.
-- Block all anon / authenticated access:
CREATE POLICY "admin_users_no_public"      ON admin_users       FOR ALL USING (false);
CREATE POLICY "audit_log_no_public"        ON admin_audit_log   FOR ALL USING (false);
CREATE POLICY "security_events_no_public"  ON security_events   FOR ALL USING (false);
CREATE POLICY "system_errors_no_public"    ON system_errors     FOR ALL USING (false);
CREATE POLICY "broadcasts_no_public"       ON admin_broadcasts  FOR ALL USING (false);
