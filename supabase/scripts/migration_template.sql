-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION TEMPLATE
-- Copy → rename to YYYYMMDDHHMMSS_description.sql → fill in the blanks.
--
-- Push command (db push / migration repair are broken on SASL auth):
--   supabase db query --linked --file supabase/migrations/YYYYMMDDHHMMSS_description.sql
--
-- After pushing, verify the migration is registered:
--   supabase db query --linked --file supabase/scripts/check_latest_migration.sql
--
-- If you added or modified a SECURITY DEFINER function, run the grant audit:
--   supabase db query --linked --file supabase/scripts/audit_fn_grants.sql
--   (Zero rows = clean. Any row = fix with REVOKE before shipping.)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── SQL body ─────────────────────────────────────────────────────────────────

-- CREATE TABLE IF NOT EXISTS ...
-- ALTER TABLE ...
-- CREATE INDEX IF NOT EXISTS ...
-- CREATE OR REPLACE FUNCTION ...

-- ── SECURITY DEFINER boilerplate (delete if not creating a function) ──────────
-- REVOKE ALL    ON FUNCTION fn_name(arg_type) FROM public;
-- REVOKE EXECUTE ON FUNCTION fn_name(arg_type) FROM anon, authenticated;
-- GRANT  EXECUTE ON FUNCTION fn_name(arg_type) TO service_role;

-- ── Register migration (REQUIRED — replaces supabase db push) ────────────────
-- CRITICAL: missing this INSERT means the migration applies but is unregistered;
-- supabase will try to re-run it on the next push attempt.
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  'YYYYMMDDHHMMSS',   -- ← replace with the timestamp in the filename
  'description',       -- ← replace with the filename suffix (no .sql, no timestamp)
  ARRAY[
    'PASTE EACH DDL STATEMENT AS A STRING HERE'
    -- add more array elements for multi-statement migrations
  ]
)
ON CONFLICT (version) DO NOTHING;
