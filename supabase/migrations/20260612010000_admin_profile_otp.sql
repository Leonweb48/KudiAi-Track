-- ═══════════════════════════════════════════════════════════════
-- ADMIN FULL PROFILE + OTP SYSTEM
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Extend admin_users with full profile ───────────────────────
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS full_name           TEXT;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS phone               TEXT;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS date_of_birth       DATE;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS gender              TEXT CHECK (gender IN ('male','female','other'));
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS address             TEXT;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS state               TEXT;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS lga                 TEXT;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS ward                TEXT;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS nin_number          TEXT;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS profile_picture_url TEXT;
-- Next of Kin
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS nok_name            TEXT;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS nok_phone           TEXT;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS nok_email           TEXT;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS nok_relation        TEXT;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS nok_address         TEXT;
-- Auth state
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS email_verified      BOOLEAN DEFAULT false;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT false;

-- Mark SuperAdmin as already verified
UPDATE admin_users SET email_verified = true, must_change_password = false
WHERE username = 'SuperAdmin';

-- ── 2. Email OTP Table ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_email_otps (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_id   UUID        REFERENCES admin_users(id) ON DELETE CASCADE NOT NULL,
  email      TEXT        NOT NULL,
  otp_code   TEXT        NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN     DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_otp_admin ON admin_email_otps(admin_id, used, expires_at);

ALTER TABLE admin_email_otps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "otps_admin_only" ON admin_email_otps FOR ALL USING (is_admin());

-- ── 3. Impersonation Log ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_impersonation_log (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_id         UUID        REFERENCES admin_users(id) ON DELETE SET NULL,
  admin_username   TEXT        NOT NULL,
  target_user_id   TEXT,
  target_user_type TEXT,    -- 'business','org_member','ajo_client','staff','admin'
  target_email     TEXT,
  reason           TEXT,
  ip_address       TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE admin_impersonation_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "impersonation_log_admin_only" ON admin_impersonation_log FOR ALL USING (is_admin());
