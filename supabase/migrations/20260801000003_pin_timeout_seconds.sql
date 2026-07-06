-- Convert auto_lock_timeout from minutes to seconds so 30s is a first-class value.
-- 0 (Never) stays 0.  Existing per-row values are multiplied by 60.
-- New default: 300 seconds (5 minutes, same as the old default of 5 minutes).

UPDATE profiles
  SET auto_lock_timeout = auto_lock_timeout * 60
  WHERE auto_lock_timeout > 0;

ALTER TABLE profiles
  ALTER COLUMN auto_lock_timeout SET DEFAULT 300;

-- Comment: auto_lock_timeout is in SECONDS (0 = Never, 30–3600 valid range)
