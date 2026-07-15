-- Add server-side PIN reset token columns to profiles.
-- These are issued by pin-manager/authorize_pin_reset immediately after OTP verification
-- and consumed (then cleared) by reset_app_pin and reset_txn_pin.
-- A valid JWT alone can no longer reset a PIN — the short-lived token is also required.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS pin_reset_token          UUID,
  ADD COLUMN IF NOT EXISTS pin_reset_token_expires_at TIMESTAMPTZ;
