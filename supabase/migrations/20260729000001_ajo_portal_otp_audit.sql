-- OTP columns for profile and transaction PIN changes
ALTER TABLE aso_clients
  ADD COLUMN IF NOT EXISTS pending_otp              text,
  ADD COLUMN IF NOT EXISTS pending_otp_expires_at   timestamptz,
  ADD COLUMN IF NOT EXISTS portal_pin_changed_at    timestamptz;

-- Audit log for client profile edits
CREATE TABLE IF NOT EXISTS aso_client_profile_logs (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid        NOT NULL REFERENCES aso_clients(id) ON DELETE CASCADE,
  changed_by     text        NOT NULL DEFAULT 'client',
  fields_changed text[]      NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE aso_client_profile_logs ENABLE ROW LEVEL SECURITY;
-- Accessible only via service-role edge function; no client-facing policies needed
