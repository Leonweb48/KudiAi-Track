-- JWT token denylist: individual token revocation on logout
CREATE TABLE IF NOT EXISTS public.admin_token_denylist (
  jti        TEXT        PRIMARY KEY,
  admin_id   UUID        REFERENCES public.admin_users(id) ON DELETE CASCADE,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_token_denylist_expires ON public.admin_token_denylist (expires_at);

-- tokens_valid_after: revoke-all-sessions support (any token issued before this timestamp is rejected)
ALTER TABLE public.admin_users ADD COLUMN IF NOT EXISTS tokens_valid_after TIMESTAMPTZ;

-- Persistent rate-limiter: survives cold starts
CREATE TABLE IF NOT EXISTS public.admin_login_attempts (
  rate_key   TEXT        PRIMARY KEY,
  count      INTEGER     NOT NULL DEFAULT 1,
  first_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Soft-delete columns on impersonation log (P1-09: replace bulk hard delete)
ALTER TABLE public.admin_impersonation_log
  ADD COLUMN IF NOT EXISTS is_deleted      BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_reason  TEXT,
  ADD COLUMN IF NOT EXISTS deleted_by_id   UUID        REFERENCES public.admin_users(id),
  ADD COLUMN IF NOT EXISTS deleted_by_name TEXT,
  ADD COLUMN IF NOT EXISTS deleted_at      TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_admin_impersonation_log_active ON public.admin_impersonation_log (is_deleted, created_at DESC);

-- Purge function called by cron to keep the denylist lean
CREATE OR REPLACE FUNCTION public.purge_expired_admin_tokens()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  n INTEGER;
BEGIN
  DELETE FROM public.admin_token_denylist WHERE expires_at < now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Record migration
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  '20261103000003',
  'jwt_security',
  ARRAY[
    'CREATE TABLE public.admin_token_denylist',
    'ALTER TABLE public.admin_users ADD COLUMN tokens_valid_after',
    'CREATE TABLE public.admin_login_attempts',
    'ALTER TABLE public.admin_impersonation_log ADD soft-delete columns',
    'CREATE FUNCTION public.purge_expired_admin_tokens()'
  ]
)
ON CONFLICT (version) DO NOTHING;
