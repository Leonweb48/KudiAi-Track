-- ═════════════════════════════════════════════════════════════════════════════
-- Private switch for the auth-email-hook enforcement mode.
--
-- platform_config is publicly readable (anon + authenticated may SELECT it), so a
-- security switch must not live there: anyone could read whether the hook is
-- still in shadow mode. internal_flags has row-level security ON and NO policies,
-- so only the service role (which bypasses RLS) can read or change it.
--
-- auth_hook_enforce starts as 'false' (SHADOW): the hook verifies every request's
-- signature and logs the verdict to email_delivery_log ("[auth-hook] signature
-- VERIFIED / REJECTED"), but still processes the request, so a HOOK_SECRET that
-- does not match the dashboard cannot silently stop signup, login and
-- password-reset emails. It is flipped to 'true' by a later migration only after
-- a VERIFIED row has been observed from real Supabase traffic.
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.internal_flags (
  key         text        PRIMARY KEY,
  value       text        NOT NULL DEFAULT '',
  description text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.internal_flags ENABLE ROW LEVEL SECURITY;
-- Deliberately NO policies: anon/authenticated get nothing; service_role bypasses RLS.
REVOKE ALL ON public.internal_flags FROM PUBLIC, anon, authenticated;

INSERT INTO public.internal_flags (key, value, description)
VALUES (
  'auth_hook_enforce', 'false',
  'auth-email-hook: ''true'' = reject unsigned/forged requests (fail closed). Flip only after a "[auth-hook] signature VERIFIED" row appears in email_delivery_log.'
)
ON CONFLICT (key) DO NOTHING;
