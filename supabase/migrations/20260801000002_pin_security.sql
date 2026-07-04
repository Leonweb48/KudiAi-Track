-- ── Two-tier PIN security: app lock PIN (6-digit) + transaction PIN (4-digit) ──
-- Both are stored as bcrypt hashes server-side, never in plaintext.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS app_pin_hash           text,
  ADD COLUMN IF NOT EXISTS app_pin_attempts        integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS app_pin_locked_until    timestamptz,
  ADD COLUMN IF NOT EXISTS app_pin_lockout_count   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS txn_pin_hash            text,
  ADD COLUMN IF NOT EXISTS txn_pin_attempts        integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS txn_pin_locked_until    timestamptz,
  ADD COLUMN IF NOT EXISTS txn_pin_lockout_count   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS txn_pin_reset_at        timestamptz,
  ADD COLUMN IF NOT EXISTS biometric_enabled       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_lock_timeout       integer NOT NULL DEFAULT 5;
-- auto_lock_timeout is in minutes (default 5)
