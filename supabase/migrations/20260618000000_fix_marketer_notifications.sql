-- Fix: marketer_notifications was created without created_by in 20260613020000
-- The 20260616000000 migration tried CREATE TABLE IF NOT EXISTS (skipped) so the column is missing.
ALTER TABLE marketer_notifications ADD COLUMN IF NOT EXISTS created_by text;
