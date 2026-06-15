-- Add geolocation + admin_role to admin_impersonation_log
ALTER TABLE admin_impersonation_log
  ADD COLUMN IF NOT EXISTS admin_role  TEXT,
  ADD COLUMN IF NOT EXISTS city        TEXT,
  ADD COLUMN IF NOT EXISTS country     TEXT,
  ADD COLUMN IF NOT EXISTS latitude    DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude   DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS idx_impersonation_log_created
  ON admin_impersonation_log(created_at DESC);
