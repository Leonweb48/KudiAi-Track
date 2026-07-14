-- Extended profile fields for aso_clients.
-- These columns are referenced in CLIENT_SELECT and the update-profile edge function
-- but were never explicitly migrated (used IF NOT EXISTS so it's safe to re-run).

ALTER TABLE public.aso_clients
  ADD COLUMN IF NOT EXISTS address              TEXT,
  ADD COLUMN IF NOT EXISTS state                TEXT,
  ADD COLUMN IF NOT EXISTS lga                  TEXT,
  ADD COLUMN IF NOT EXISTS ward                 TEXT,
  ADD COLUMN IF NOT EXISTS nin                  TEXT,
  ADD COLUMN IF NOT EXISTS next_of_kin_name     TEXT,
  ADD COLUMN IF NOT EXISTS next_of_kin_phone    TEXT,
  ADD COLUMN IF NOT EXISTS next_of_kin_email    TEXT,
  ADD COLUMN IF NOT EXISTS next_of_kin_address  TEXT;
