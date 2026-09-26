-- Admin "access account": let an admin who signs in to a customer's account from the admin portal get past the
-- customer's app lock, PIN-setup screen and consent screen — without the customer's PIN, and without weakening
-- those gates for anyone else.
--
-- The admin portal (service role) creates a one-time grant and hands the admin a link carrying the grant's secret.
-- The app claims it right after the admin's sign-in; the claim binds the grant to that one login session (the JWT's
-- session_id). Only that session is treated as an admin session, and only until the grant expires. The customer's
-- own sessions — and anyone else holding the account — never are. Money still needs the customer's transaction PIN.

CREATE TABLE IF NOT EXISTS public.admin_access_grants (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL,
  token_hash      text        NOT NULL UNIQUE,          -- sha256 hex of the secret; the secret itself is never stored
  admin_id        text        NOT NULL,
  admin_username  text,
  admin_role      text,
  reason          text        NOT NULL,
  claim_before    timestamptz NOT NULL,                 -- the link must be opened before this
  access_minutes  int         NOT NULL DEFAULT 60 CHECK (access_minutes BETWEEN 5 AND 240),
  claimed_at      timestamptz,
  session_id      text,                                 -- auth session the grant is bound to once claimed
  expires_at      timestamptz,                          -- claimed_at + access_minutes
  ended_at        timestamptz,                          -- ended early (admin pressed "End admin session" or portal revoked)
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_access_grants_user_idx ON public.admin_access_grants (user_id, created_at DESC);

ALTER TABLE public.admin_access_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_access_grants FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.admin_access_grants TO service_role;

-- Claim a grant for the CURRENT session. Callable by the signed-in (impersonated) user; succeeds only for an unclaimed,
-- unexpired grant for this very user, and binds it to this session.
CREATE OR REPLACE FUNCTION public.admin_access_claim(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_session text := auth.jwt() ->> 'session_id';
  v_grant   public.admin_access_grants;
BEGIN
  IF v_uid IS NULL OR v_session IS NULL OR p_token IS NULL OR length(p_token) < 32 THEN
    RETURN jsonb_build_object('active', false);
  END IF;

  SELECT * INTO v_grant FROM public.admin_access_grants
   WHERE token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
   FOR UPDATE;

  IF NOT FOUND OR v_grant.user_id <> v_uid OR v_grant.ended_at IS NOT NULL THEN
    RETURN jsonb_build_object('active', false);
  END IF;

  IF v_grant.claimed_at IS NULL THEN
    IF v_grant.claim_before < now() THEN
      RETURN jsonb_build_object('active', false, 'reason', 'expired');
    END IF;
    UPDATE public.admin_access_grants
       SET claimed_at = now(), session_id = v_session, expires_at = now() + make_interval(mins => access_minutes)
     WHERE id = v_grant.id
    RETURNING * INTO v_grant;
  ELSIF v_grant.session_id IS DISTINCT FROM v_session THEN
    -- Already claimed by another session: the link can't be reused.
    RETURN jsonb_build_object('active', false);
  END IF;

  IF v_grant.expires_at <= now() THEN
    RETURN jsonb_build_object('active', false, 'reason', 'expired');
  END IF;

  RETURN jsonb_build_object('active', true, 'admin_username', v_grant.admin_username, 'expires_at', v_grant.expires_at);
END;
$$;

-- Is the current session an admin-access session? (Used after a reload, so the app never trusts local storage.)
CREATE OR REPLACE FUNCTION public.admin_access_status()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object('active', true, 'admin_username', g.admin_username, 'expires_at', g.expires_at)
       FROM public.admin_access_grants g
      WHERE g.user_id = auth.uid()
        AND g.session_id = auth.jwt() ->> 'session_id'
        AND g.ended_at IS NULL
        AND g.expires_at > now()
      ORDER BY g.claimed_at DESC
      LIMIT 1),
    jsonb_build_object('active', false));
$$;

-- End the current session's admin access early.
CREATE OR REPLACE FUNCTION public.admin_access_end()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.admin_access_grants
     SET ended_at = now()
   WHERE user_id = auth.uid()
     AND session_id = auth.jwt() ->> 'session_id'
     AND ended_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.admin_access_claim(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_access_status()    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_access_end()       FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_access_claim(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_access_status()    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_access_end()       TO authenticated, service_role;
