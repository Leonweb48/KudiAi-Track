-- ─── Admin Sessions ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_sessions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id        uuid        REFERENCES admin_users(id) ON DELETE CASCADE,
  admin_username  text,
  ip_address      text,
  user_agent      text,
  device_type     text        DEFAULT 'unknown',
  browser         text,
  os_name         text,
  location_city   text,
  location_country text,
  latitude        double precision,
  longitude       double precision,
  is_active       boolean     DEFAULT true,
  created_at      timestamptz DEFAULT now(),
  last_active_at  timestamptz DEFAULT now(),
  revoked_at      timestamptz,
  revoked_by      text
);
ALTER TABLE admin_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_sessions_service" ON admin_sessions USING (auth.role() = 'service_role');

-- ─── TOTP Secrets ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_totp_secrets (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    uuid        UNIQUE REFERENCES admin_users(id) ON DELETE CASCADE,
  secret      text        NOT NULL,
  is_enabled  boolean     DEFAULT false,
  enabled_at  timestamptz,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE admin_totp_secrets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_totp_service" ON admin_totp_secrets USING (auth.role() = 'service_role');

-- ─── Backup Codes ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_backup_codes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    uuid        REFERENCES admin_users(id) ON DELETE CASCADE,
  code_hash   text        NOT NULL,
  is_used     boolean     DEFAULT false,
  used_at     timestamptz,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE admin_backup_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_backup_codes_service" ON admin_backup_codes USING (auth.role() = 'service_role');

-- ─── Trusted Devices ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_trusted_devices (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id            uuid        REFERENCES admin_users(id) ON DELETE CASCADE,
  device_name         text        NOT NULL,
  device_fingerprint  text        NOT NULL,
  ip_address          text,
  user_agent          text,
  last_used_at        timestamptz DEFAULT now(),
  trusted_at          timestamptz DEFAULT now(),
  is_revoked          boolean     DEFAULT false,
  revoked_at          timestamptz
);
ALTER TABLE admin_trusted_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_trusted_devices_service" ON admin_trusted_devices USING (auth.role() = 'service_role');

-- ─── Add 2FA fields to admin_users ───────────────────────────────────────────
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS pin_hash        text;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS pin_enabled     boolean DEFAULT false;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS totp_enabled    boolean DEFAULT false;

-- ─── Extend support_tickets for cross-platform ───────────────────────────────
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS source          text DEFAULT 'admin';
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS platform_user_id text;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS submitter_type  text DEFAULT 'admin';
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS auto_assigned_role text;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS notified_at     timestamptz;

-- ─── Fix security_events: add resolved status update support ─────────────────
ALTER TABLE security_events ADD COLUMN IF NOT EXISTS resolved_at   timestamptz;
ALTER TABLE security_events ADD COLUMN IF NOT EXISTS resolved_by   text;
