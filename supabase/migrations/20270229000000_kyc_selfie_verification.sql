-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Identity checks, part 2: a live selfie compared against the ID's file photo (Youverify's own comparison — see
-- supabase/functions/_shared/idCheck.ts for the request/response shape, confirmed against their real sandbox before
-- this was written, using only an inert placeholder image, never anyone's real photo).
--
-- WHY: a name matching the ID alone doesn't prove the person typing it IS the ID holder — anyone who knows someone
-- else's BVN/NIN and real name could pass. The selfie proves the face in front of the camera matches the face NIBSS
-- / NIMC has on file. Off by default (kyc_selfie_required = 'false'): nothing changes for customers until it is
-- turned on, and even then only actions the app itself asks a selfie for are affected.
--
-- Both new functions REPLACE the 5- / 8-argument versions from 20270225000000 with EXTENDED ones (new trailing
-- parameters, all with defaults) — the old parameter lists are DROPPED first so there is exactly one overload of
-- each, never two.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.kyc_checks
  ADD COLUMN IF NOT EXISTS selfie_submitted boolean NOT NULL DEFAULT false,   -- did THIS attempt include a selfie photo at all
  ADD COLUMN IF NOT EXISTS selfie_matched   boolean,                          -- the provider's verdict; null = no selfie, or no verdict came back
  ADD COLUMN IF NOT EXISTS selfie_confidence smallint;                        -- 0–100, for audit only — never the image
ALTER TABLE public.kyc_checks DROP CONSTRAINT IF EXISTS kyc_checks_selfie_confidence_check;
ALTER TABLE public.kyc_checks ADD CONSTRAINT kyc_checks_selfie_confidence_check CHECK (selfie_confidence IS NULL OR selfie_confidence BETWEEN 0 AND 100);

ALTER TABLE public.kyc_verified ADD COLUMN IF NOT EXISTS selfie_matched boolean;   -- true only once a submitted selfie has actually matched

INSERT INTO public.platform_config (key, value, description) VALUES
  ('kyc_selfie_required', 'false', 'Require a live selfie (compared against the BVN/NIN file photo by Youverify) in addition to the name match, for the actions that collect one. false = name-match only, as before.')
ON CONFLICT (key) DO NOTHING;

DROP FUNCTION IF EXISTS public.kyc_check_finish(uuid, text, boolean, text, boolean);
CREATE FUNCTION public.kyc_check_finish(
  p_id uuid, p_outcome text, p_matched boolean, p_provider_ref text, p_billed boolean,
  p_selfie_submitted boolean DEFAULT false, p_selfie_matched boolean DEFAULT NULL, p_selfie_confidence int DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_outcome NOT IN ('verified', 'mismatch', 'not_found', 'unavailable', 'no_funds') THEN RAISE EXCEPTION 'bad outcome %', p_outcome; END IF;
  UPDATE public.kyc_checks SET
    outcome = p_outcome, name_matched = p_matched, provider_ref = left(p_provider_ref, 80), billed = COALESCE(p_billed, false),
    selfie_submitted = COALESCE(p_selfie_submitted, false), selfie_matched = p_selfie_matched,
    selfie_confidence = CASE WHEN p_selfie_confidence BETWEEN 0 AND 100 THEN p_selfie_confidence ELSE NULL END,
    finished_at = now()
   WHERE id = p_id AND outcome = 'started';
END $$;

DROP FUNCTION IF EXISTS public.kyc_save_verified(uuid, text, text, text, text, uuid, boolean, text);
CREATE FUNCTION public.kyc_save_verified(
  p_user uuid, p_kind text, p_hmac text, p_name text, p_provider_ref text, p_check_id uuid, p_matched boolean, p_table text DEFAULT 'profiles',
  p_selfie_matched boolean DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_kind NOT IN ('bvn', 'nin') OR COALESCE(p_hmac, '') = '' OR COALESCE(btrim(p_name), '') = '' THEN RAISE EXCEPTION 'bad verification'; END IF;
  INSERT INTO public.kyc_verified (user_id, kind, id_hmac, verified_name, provider_ref, check_id, name_matched, selfie_matched, verified_at)
  VALUES (p_user, p_kind, p_hmac, left(p_name, 200), left(p_provider_ref, 80), p_check_id, p_matched, p_selfie_matched, now())
  ON CONFLICT (user_id, kind) DO UPDATE SET id_hmac = EXCLUDED.id_hmac, verified_name = EXCLUDED.verified_name, provider_ref = EXCLUDED.provider_ref,
    check_id = EXCLUDED.check_id, name_matched = EXCLUDED.name_matched, selfie_matched = EXCLUDED.selfie_matched, verified_at = EXCLUDED.verified_at;

  IF p_kind = 'bvn' THEN
    IF p_table = 'profiles' THEN UPDATE public.profiles SET bvn_verified = true, bvn_verified_at = now(), verified_name = left(p_name, 200) WHERE id = p_user;
    ELSIF p_table = 'aso_clients' THEN UPDATE public.aso_clients SET bvn_verified = true, bvn_verified_at = now(), bvn_verified_name = left(p_name, 200) WHERE client_user_id = p_user;
    ELSIF p_table = 'staff' THEN UPDATE public.staff SET bvn_verified = true, bvn_verified_at = now(), bvn_verified_name = left(p_name, 200) WHERE user_id = p_user;
    END IF;
  ELSIF p_kind = 'nin' AND p_table = 'profiles' THEN
    UPDATE public.profiles SET nin_verified = true, verified_name = COALESCE(NULLIF(verified_name, ''), left(p_name, 200)) WHERE id = p_user;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.kyc_check_finish(uuid, text, boolean, text, boolean, boolean, boolean, int),
  public.kyc_save_verified(uuid, text, text, text, text, uuid, boolean, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kyc_check_finish(uuid, text, boolean, text, boolean, boolean, boolean, int),
  public.kyc_save_verified(uuid, text, text, text, text, uuid, boolean, text, boolean) TO service_role;

-- ── self-test (rolled back): a selfie result is recorded; a cached "no selfie" state does not silently pass as a match; the confidence bound holds ──
DO $$
DECLARE u uuid := gen_random_uuid(); r jsonb; v_err text; v_row public.kyc_checks%ROWTYPE;
BEGIN
  r := public.kyc_check_begin(u, 'bvn', 'sh1', 5, 'v1');
  PERFORM public.kyc_check_finish((r ->> 'id')::uuid, 'verified', true, 'p1', true, true, true, 91);
  SELECT * INTO v_row FROM public.kyc_checks WHERE id = (r ->> 'id')::uuid;
  IF NOT (v_row.selfie_submitted AND v_row.selfie_matched AND v_row.selfie_confidence = 91) THEN RAISE EXCEPTION 'kyc self-test: selfie result not recorded'; END IF;

  r := public.kyc_check_begin(u, 'bvn', 'sh2', 5, 'v1');
  PERFORM public.kyc_check_finish((r ->> 'id')::uuid, 'verified', true, 'p2', true);   -- old-style call, no selfie args
  SELECT selfie_submitted, selfie_matched INTO v_row.selfie_submitted, v_row.selfie_matched FROM public.kyc_checks WHERE id = (r ->> 'id')::uuid;
  IF v_row.selfie_submitted OR v_row.selfie_matched IS NOT NULL THEN RAISE EXCEPTION 'kyc self-test: a call with no selfie args must record none'; END IF;

  PERFORM public.kyc_save_verified(u, 'bvn', 'sh1', 'Amaka Okonkwo', 'p1', NULL, true, 'profiles', true);
  IF (SELECT selfie_matched FROM public.kyc_verified WHERE user_id = u AND kind = 'bvn') IS NOT TRUE THEN RAISE EXCEPTION 'kyc self-test: selfie_matched not saved'; END IF;
  PERFORM public.kyc_save_verified(u, 'bvn', 'sh1', 'Amaka Okonkwo', 'p1', NULL, true, 'profiles');   -- re-verified with no selfie this time
  IF (SELECT selfie_matched FROM public.kyc_verified WHERE user_id = u AND kind = 'bvn') IS NOT NULL THEN RAISE EXCEPTION 'kyc self-test: a re-save without a selfie must clear the old selfie state, not keep a stale pass'; END IF;

  -- an out-of-range confidence is clamped to NULL rather than rejected or stored as-is
  r := public.kyc_check_begin(u, 'nin', 'sh3', 5, 'v1');
  PERFORM public.kyc_check_finish((r ->> 'id')::uuid, 'verified', true, NULL, true, true, true, 101);
  IF (SELECT selfie_confidence FROM public.kyc_checks WHERE id = (r ->> 'id')::uuid) IS NOT NULL THEN
    RAISE EXCEPTION 'kyc self-test: an out-of-range confidence was not clamped to null';
  END IF;

  RAISE EXCEPTION 'kyc self-test passed (rolled back)';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
  IF v_err NOT LIKE 'kyc self-test passed%' THEN RAISE; END IF;
  RAISE NOTICE 'kyc | selfie self-test passed';
END $$;
