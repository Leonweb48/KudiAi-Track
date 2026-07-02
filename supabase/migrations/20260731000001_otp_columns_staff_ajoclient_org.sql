-- Add OTP columns for first-login email verification flow
-- Used by: manage-staff-account, manage-ajo-client-account, coop-portal (setup-org-portal)

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS otp_code         TEXT,
  ADD COLUMN IF NOT EXISTS otp_expires_at   TIMESTAMPTZ;

ALTER TABLE aso_clients
  ADD COLUMN IF NOT EXISTS otp_code         TEXT,
  ADD COLUMN IF NOT EXISTS otp_expires_at   TIMESTAMPTZ;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS otp_code         TEXT,
  ADD COLUMN IF NOT EXISTS otp_expires_at   TIMESTAMPTZ;
