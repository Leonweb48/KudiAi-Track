-- Client-portal PIN brute-force protection, mirroring the owner's existing
-- profiles.txn_pin_attempts / txn_pin_locked_until pattern. aso_clients has a
-- portal_pin_hash column already but no lockout tracking at all today — the
-- edge-function PIN gate being added alongside this migration needs it.

ALTER TABLE aso_clients ADD COLUMN IF NOT EXISTS portal_pin_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE aso_clients ADD COLUMN IF NOT EXISTS portal_pin_locked_until TIMESTAMPTZ;
