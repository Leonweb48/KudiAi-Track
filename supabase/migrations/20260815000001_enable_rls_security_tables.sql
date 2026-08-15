-- Enable RLS on three service-role-only tables flagged by the linter.
--
-- Access audit (confirmed):
--   admin_token_denylist    — supabaseAdmin only (logout route, auth middleware)
--   admin_login_attempts    — supabaseAdmin only (login route rate-limiter)
--   org_manual_savings_claims — coop-portal edge function service-role client only
--
-- No client policies needed: service role bypasses RLS, so all existing
-- functionality is preserved. Anon/authenticated keys return nothing.

ALTER TABLE public.admin_token_denylist      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_login_attempts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_manual_savings_claims ENABLE ROW LEVEL SECURITY;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  '20260815000001',
  'enable_rls_security_tables',
  ARRAY[
    'ALTER TABLE public.admin_token_denylist ENABLE ROW LEVEL SECURITY',
    'ALTER TABLE public.admin_login_attempts ENABLE ROW LEVEL SECURITY',
    'ALTER TABLE public.org_manual_savings_claims ENABLE ROW LEVEL SECURITY'
  ]
)
ON CONFLICT (version) DO NOTHING;
