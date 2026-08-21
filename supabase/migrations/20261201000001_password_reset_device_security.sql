-- Migration: password reset OTPs, device verify OTPs, marketer rate limiting + audit
-- Applied via: supabase db query --linked --file

-- ── New tables ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.admin_password_reset_otps (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id   UUID        NOT NULL REFERENCES public.admin_users(id) ON DELETE CASCADE,
  otp_hash   TEXT        NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_password_reset_otps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_password_reset_otps FROM PUBLIC;
REVOKE ALL ON public.admin_password_reset_otps FROM anon;
REVOKE ALL ON public.admin_password_reset_otps FROM authenticated;
GRANT ALL ON public.admin_password_reset_otps TO service_role;

CREATE TABLE IF NOT EXISTS public.admin_device_verify_otps (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id   UUID        NOT NULL REFERENCES public.admin_users(id) ON DELETE CASCADE,
  otp_hash   TEXT        NOT NULL,
  attempts   INT         NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_device_verify_otps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_device_verify_otps FROM PUBLIC;
REVOKE ALL ON public.admin_device_verify_otps FROM anon;
REVOKE ALL ON public.admin_device_verify_otps FROM authenticated;
GRANT ALL ON public.admin_device_verify_otps TO service_role;

CREATE TABLE IF NOT EXISTS public.marketer_password_reset_otps (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  marketer_id UUID        NOT NULL REFERENCES public.brm_marketers(id) ON DELETE CASCADE,
  otp_hash    TEXT        NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.marketer_password_reset_otps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketer_password_reset_otps FROM PUBLIC;
REVOKE ALL ON public.marketer_password_reset_otps FROM anon;
REVOKE ALL ON public.marketer_password_reset_otps FROM authenticated;
GRANT ALL ON public.marketer_password_reset_otps TO service_role;

CREATE TABLE IF NOT EXISTS public.marketer_login_attempts (
  rate_key   TEXT        PRIMARY KEY,
  count      INT         NOT NULL DEFAULT 1,
  first_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.marketer_login_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketer_login_attempts FROM PUBLIC;
REVOKE ALL ON public.marketer_login_attempts FROM anon;
REVOKE ALL ON public.marketer_login_attempts FROM authenticated;
GRANT ALL ON public.marketer_login_attempts TO service_role;

CREATE TABLE IF NOT EXISTS public.marketer_login_audit (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  marketer_id UUID,
  email       TEXT        NOT NULL,
  outcome     TEXT        NOT NULL,
  ip_address  TEXT,
  user_agent  TEXT,
  device_fp   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.marketer_login_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketer_login_audit FROM PUBLIC;
REVOKE ALL ON public.marketer_login_audit FROM anon;
REVOKE ALL ON public.marketer_login_audit FROM authenticated;
GRANT ALL ON public.marketer_login_audit TO service_role;

-- ── Add columns to admin_users ────────────────────────────────────────────────

ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS last_device_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS device_verified_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_login_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_until             TIMESTAMPTZ;

-- ── Add columns to brm_marketers ─────────────────────────────────────────────

ALTER TABLE public.brm_marketers
  ADD COLUMN IF NOT EXISTS last_device_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS last_login_at            TIMESTAMPTZ;

-- ── Migration registration ────────────────────────────────────────────────────

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('20261201000001', 'password_reset_device_security', ARRAY['see file'])
ON CONFLICT DO NOTHING;
