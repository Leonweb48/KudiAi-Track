-- ═══════════════════════════════════════════════════════════════
-- MARKETER FULL PROFILE EXTENSION
-- Adds the same rich profile columns that admin_users has
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE brm_marketers ADD COLUMN IF NOT EXISTS username       TEXT UNIQUE;
ALTER TABLE brm_marketers ADD COLUMN IF NOT EXISTS date_of_birth  DATE;
ALTER TABLE brm_marketers ADD COLUMN IF NOT EXISTS gender         TEXT CHECK (gender IN ('male','female','other'));
ALTER TABLE brm_marketers ADD COLUMN IF NOT EXISTS address        TEXT;
ALTER TABLE brm_marketers ADD COLUMN IF NOT EXISTS state          TEXT;
ALTER TABLE brm_marketers ADD COLUMN IF NOT EXISTS lga            TEXT;
ALTER TABLE brm_marketers ADD COLUMN IF NOT EXISTS ward           TEXT;
ALTER TABLE brm_marketers ADD COLUMN IF NOT EXISTS nin_number     TEXT;

-- Next of Kin
ALTER TABLE brm_marketers ADD COLUMN IF NOT EXISTS nok_name       TEXT;
ALTER TABLE brm_marketers ADD COLUMN IF NOT EXISTS nok_phone      TEXT;
ALTER TABLE brm_marketers ADD COLUMN IF NOT EXISTS nok_email      TEXT;
ALTER TABLE brm_marketers ADD COLUMN IF NOT EXISTS nok_relation   TEXT;
ALTER TABLE brm_marketers ADD COLUMN IF NOT EXISTS nok_address    TEXT;

-- Auth flow state
ALTER TABLE brm_marketers ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT true;
