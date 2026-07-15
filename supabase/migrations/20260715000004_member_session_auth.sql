-- Add member portal session token + PIN lockout columns.
-- member_session_token: issued by member-auth on successful PIN login; required by member-* actions.
-- portal_pin_attempts / portal_pin_locked_until: brute-force lockout for the 4-digit PIN.

ALTER TABLE org_members
  ADD COLUMN IF NOT EXISTS member_session_token          UUID,
  ADD COLUMN IF NOT EXISTS member_session_expires_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS portal_pin_attempts           INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS portal_pin_locked_until       TIMESTAMPTZ;
