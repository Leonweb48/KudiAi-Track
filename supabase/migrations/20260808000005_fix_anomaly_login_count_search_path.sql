-- anomaly_login_count was re-created without search_path when
-- 20260727_login_audit_enhancements.sql was re-applied during migration
-- repair. Pin it here; the source file is also updated so future
-- re-applications are idempotent.
ALTER FUNCTION public.anomaly_login_count(uuid)
  SET search_path TO 'public', 'pg_temp';
