-- Post-push check: confirm the most recent migration is registered.
-- Run after every supabase db query --linked --file push.
-- Usage: supabase db query --linked --file supabase/scripts/check_latest_migration.sql

SELECT version, name, inserted_at
FROM supabase_migrations.schema_migrations
ORDER BY version DESC
LIMIT 5;
