-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Identity checks (BVN / NIN) through Youverify — the database side. Logic: supabase/functions/_shared/idCheck.ts.
--
--   kyc_checks     one row per provider attempt: who, which kind, a KEYED HASH of the number (never the number), how it ended, whether it was billed.
--                  This is the audit trail, the cost record and the rate limiter (a person gets a few attempts a day).
--   kyc_verified   what is currently verified for a person: (user, kind) → the keyed hash of the number that was verified + the name it belongs to.
--                  A later request with the SAME number is answered from here — no provider call, no charge.
--
-- Everything is service-role only. Nothing changes for customers by deploying this: platform_config.kyc_youverify_enabled stays 'false' until a super admin turns it on (Feature Flags page).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.kyc_checks (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL,
  kind            text        NOT NULL CHECK (kind IN ('bvn', 'nin')),
  id_hmac         text        NOT NULL,                       -- HMAC of the number, same scheme as wallet_kyc; the number itself is never stored
  provider        text        NOT NULL DEFAULT 'youverify',
  outcome         text        NOT NULL DEFAULT 'started' CHECK (outcome IN ('started', 'verified', 'mismatch', 'not_found', 'unavailable', 'no_funds')),
  name_matched    boolean,                                    -- null = no personal name on file to compare with
  provider_ref    text,
  billed          boolean     NOT NULL DEFAULT false,         -- did this attempt cost money (a real lookup answered)?
  consent_version text,                                       -- which consent wording the customer agreed to
  consented_at    timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);
CREATE INDEX IF NOT EXISTS kyc_checks_user_idx ON public.kyc_checks (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.kyc_verified (
  user_id       uuid        NOT NULL,
  kind          text        NOT NULL CHECK (kind IN ('bvn', 'nin')),
  id_hmac       text        NOT NULL,
  verified_name text        NOT NULL,
  provider      text        NOT NULL DEFAULT 'youverify',
  provider_ref  text,
  check_id      uuid,
  name_matched  boolean,
  verified_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind)
);

ALTER TABLE public.kyc_checks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_verified ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kyc_checks, public.kyc_verified FROM PUBLIC, anon, authenticated;

INSERT INTO public.platform_config (key, value, description) VALUES
  ('kyc_youverify_enabled','false',                             'Identity checks for BVN / NIN through Youverify. false = off (numbers are self-declared, as before). Nothing changes for customers until this is true.'),
  ('kyc_youverify_live',   'false',                             'Youverify environment: false = SANDBOX (test data, no real lookups), true = LIVE (real lookups, billed). Turn on only after the sandbox checks pass and the API token is the live one.'),
  ('kyc_max_checks_per_day','6',                                 'Most identity lookups one person can trigger in 24 hours (each costs money, and unlimited tries would let someone guess other people''s numbers).'),
  ('kyc_fail_open',         'false',                             'If the identity provider is down or out of funds: false = customers cannot open / upgrade a wallet until it is back; true = they can, unverified.'),
  ('kyc_consent_version',   '2026-09',                           'Version of the consent wording shown when a customer agrees to an identity check (stored with each check).')
ON CONFLICT (key) DO NOTHING;

-- ── record an attempt; refuse when the person has used up today's tries (atomic per person) ─────────────────────────
CREATE OR REPLACE FUNCTION public.kyc_check_begin(p_user uuid, p_kind text, p_hmac text, p_max_per_day int, p_consent_version text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_n int;
BEGIN
  IF p_user IS NULL OR p_kind NOT IN ('bvn', 'nin') OR COALESCE(p_hmac, '') = '' THEN RAISE EXCEPTION 'bad identity check request'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('kyc:' || p_user::text));       -- two parallel requests cannot both slip under the limit
  SELECT count(*) INTO v_n FROM public.kyc_checks WHERE user_id = p_user AND created_at > now() - interval '24 hours';
  IF COALESCE(p_max_per_day, 0) <= 0 OR v_n >= p_max_per_day THEN RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited'); END IF;
  INSERT INTO public.kyc_checks (user_id, kind, id_hmac, consent_version) VALUES (p_user, p_kind, p_hmac, left(p_consent_version, 40)) RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;

-- ── close an attempt (once) ─────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kyc_check_finish(p_id uuid, p_outcome text, p_matched boolean, p_provider_ref text, p_billed boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_outcome NOT IN ('verified', 'mismatch', 'not_found', 'unavailable', 'no_funds') THEN RAISE EXCEPTION 'bad outcome %', p_outcome; END IF;
  UPDATE public.kyc_checks SET outcome = p_outcome, name_matched = p_matched, provider_ref = left(p_provider_ref, 80), billed = COALESCE(p_billed, false), finished_at = now()
   WHERE id = p_id AND outcome = 'started';
END $$;

-- ── remember a verification, and reflect it in the flags the app already reads ──────────────────────────────────────
-- p_table says which table holds this person's identity (profiles = a business owner, aso_clients = an Ajo client, staff = staff / manager). A BVN sets
-- the same "BVN verified" flag + name the wallet screens already use; a NIN sets profiles.nin_verified (the owner-verification screen's flag).
CREATE OR REPLACE FUNCTION public.kyc_save_verified(
  p_user uuid, p_kind text, p_hmac text, p_name text, p_provider_ref text, p_check_id uuid, p_matched boolean, p_table text DEFAULT 'profiles'
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_kind NOT IN ('bvn', 'nin') OR COALESCE(p_hmac, '') = '' OR COALESCE(btrim(p_name), '') = '' THEN RAISE EXCEPTION 'bad verification'; END IF;
  INSERT INTO public.kyc_verified (user_id, kind, id_hmac, verified_name, provider_ref, check_id, name_matched, verified_at)
  VALUES (p_user, p_kind, p_hmac, left(p_name, 200), left(p_provider_ref, 80), p_check_id, p_matched, now())
  ON CONFLICT (user_id, kind) DO UPDATE SET id_hmac = EXCLUDED.id_hmac, verified_name = EXCLUDED.verified_name, provider_ref = EXCLUDED.provider_ref,
    check_id = EXCLUDED.check_id, name_matched = EXCLUDED.name_matched, verified_at = EXCLUDED.verified_at;

  IF p_kind = 'bvn' THEN
    IF p_table = 'profiles' THEN UPDATE public.profiles SET bvn_verified = true, bvn_verified_at = now(), verified_name = left(p_name, 200) WHERE id = p_user;
    ELSIF p_table = 'aso_clients' THEN UPDATE public.aso_clients SET bvn_verified = true, bvn_verified_at = now(), bvn_verified_name = left(p_name, 200) WHERE client_user_id = p_user;
    ELSIF p_table = 'staff' THEN UPDATE public.staff SET bvn_verified = true, bvn_verified_at = now(), bvn_verified_name = left(p_name, 200) WHERE user_id = p_user;
    END IF;
  ELSIF p_kind = 'nin' AND p_table = 'profiles' THEN
    UPDATE public.profiles SET nin_verified = true, verified_name = COALESCE(NULLIF(verified_name, ''), left(p_name, 200)) WHERE id = p_user;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.kyc_check_begin(uuid, text, text, int, text), public.kyc_check_finish(uuid, text, boolean, text, boolean),
  public.kyc_save_verified(uuid, text, text, text, text, uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kyc_check_begin(uuid, text, text, int, text), public.kyc_check_finish(uuid, text, boolean, text, boolean),
  public.kyc_save_verified(uuid, text, text, text, text, uuid, boolean, text) TO service_role;

-- ── self-test (rolled back): the daily limit holds, an attempt closes once, a verification is remembered and replaced ───────────────────────────
DO $$
DECLARE u uuid := gen_random_uuid(); r jsonb; v_err text; v_hm text;
BEGIN
  r := public.kyc_check_begin(u, 'bvn', 'h1', 2, 'v1');  IF NOT (r ->> 'ok')::boolean THEN RAISE EXCEPTION 'kyc self-test: first attempt refused'; END IF;
  PERFORM public.kyc_check_finish((r ->> 'id')::uuid, 'not_found', NULL, NULL, false);
  PERFORM public.kyc_check_finish((r ->> 'id')::uuid, 'verified', true, 'x', true);                                   -- a second close must change nothing
  IF (SELECT outcome FROM public.kyc_checks WHERE id = (r ->> 'id')::uuid) <> 'not_found' THEN RAISE EXCEPTION 'kyc self-test: an attempt was closed twice'; END IF;
  r := public.kyc_check_begin(u, 'nin', 'h2', 2, 'v1');  IF NOT (r ->> 'ok')::boolean THEN RAISE EXCEPTION 'kyc self-test: second attempt refused'; END IF;
  r := public.kyc_check_begin(u, 'nin', 'h3', 2, 'v1');  IF (r ->> 'ok')::boolean THEN RAISE EXCEPTION 'kyc self-test: the daily limit did not hold'; END IF;
  IF (public.kyc_check_begin(gen_random_uuid(), 'nin', 'h', 0, 'v1') ->> 'ok')::boolean THEN RAISE EXCEPTION 'kyc self-test: a limit of 0 must refuse'; END IF;
  PERFORM public.kyc_save_verified(u, 'bvn', 'h1', 'Amaka Okonkwo', 'p1', NULL, true, 'profiles');
  PERFORM public.kyc_save_verified(u, 'bvn', 'h9', 'Amaka C Okonkwo', 'p2', NULL, true, 'profiles');                    -- a new number replaces the old one
  SELECT id_hmac INTO v_hm FROM public.kyc_verified WHERE user_id = u AND kind = 'bvn';
  IF v_hm <> 'h9' OR (SELECT count(*) FROM public.kyc_verified WHERE user_id = u) <> 1 THEN RAISE EXCEPTION 'kyc self-test: verification not replaced'; END IF;
  BEGIN PERFORM public.kyc_check_finish(u, 'nonsense', NULL, NULL, false); RAISE EXCEPTION 'kyc self-test: a bad outcome was accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'kyc self-test%' THEN RAISE; END IF; END;
  RAISE EXCEPTION 'kyc self-test passed (rolled back)';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
  IF v_err NOT LIKE 'kyc self-test passed%' THEN RAISE; END IF;
  RAISE NOTICE 'kyc | self-test passed';
END $$;
