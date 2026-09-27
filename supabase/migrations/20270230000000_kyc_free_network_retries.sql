-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Identity checks: a network / provider failure must never cost a try. `kyc_check_begin` (20270225000000) has always
-- counted EVERY attempt in the last 24 hours toward `kyc_max_checks_per_day`, including ones that never got a real
-- answer — a Youverify timeout, their API being briefly down, or our own provider wallet being empty ('unavailable' /
-- 'no_funds'), or an attempt that was started but never finished at all. None of those are the customer's doing, and
-- none reveal anything about anyone's BVN/NIN — so a rough patch on Youverify's side could lock a real, honest
-- customer out of verifying at all for the rest of the day. From now on, only an attempt that actually got a real,
-- informative answer from the provider — verified, mismatch, or genuinely not found — counts against the daily limit.
-- Retrying after a network hiccup is now free, for real; abuse/anti-enumeration protection is unchanged for anyone
-- who actually reaches the provider and gets an answer.
--
-- kyc_check_begin's parameter list is unchanged, so this simply replaces its one existing overload — no DROP needed.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.kyc_check_begin(p_user uuid, p_kind text, p_hmac text, p_max_per_day int, p_consent_version text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_n int;
BEGIN
  IF p_user IS NULL OR p_kind NOT IN ('bvn', 'nin') OR COALESCE(p_hmac, '') = '' THEN RAISE EXCEPTION 'bad identity check request'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('kyc:' || p_user::text));       -- two parallel requests cannot both slip under the limit
  -- Only a resolved, informative outcome counts — never a 'started' row still in flight (or abandoned), a network /
  -- provider failure ('unavailable'), or our own empty provider wallet ('no_funds'). Those are free to retry.
  SELECT count(*) INTO v_n FROM public.kyc_checks
   WHERE user_id = p_user AND created_at > now() - interval '24 hours' AND outcome IN ('verified', 'mismatch', 'not_found');
  IF COALESCE(p_max_per_day, 0) <= 0 OR v_n >= p_max_per_day THEN RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited'); END IF;
  INSERT INTO public.kyc_checks (user_id, kind, id_hmac, consent_version) VALUES (p_user, p_kind, p_hmac, left(p_consent_version, 40)) RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;

UPDATE public.platform_config
   SET description = 'Most identity lookups that actually get a real answer (found + matched, found + didn''t match, or genuinely not found) one person can trigger in 24 hours. A network failure, a Youverify outage, or our own empty provider wallet is never the customer''s fault and is always free to retry — it does not count here.'
 WHERE key = 'kyc_max_checks_per_day' AND description <> 'Most identity lookups that actually get a real answer (found + matched, found + didn''t match, or genuinely not found) one person can trigger in 24 hours. A network failure, a Youverify outage, or our own empty provider wallet is never the customer''s fault and is always free to retry — it does not count here.';

-- ── self-test (rolled back): failures never cost a try; a real answer still does; an in-flight attempt never blocks ──
DO $$
DECLARE u uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); r jsonb; v_err text;
BEGIN
  -- three genuine failures in a row, limit of 2 — none of them should count against it
  r := public.kyc_check_begin(u, 'bvn', 'h1', 2, 'v1'); IF NOT (r ->> 'ok')::boolean THEN RAISE EXCEPTION 'kyc free-retry self-test: attempt 1 refused'; END IF;
  PERFORM public.kyc_check_finish((r ->> 'id')::uuid, 'unavailable', NULL, NULL, false);
  r := public.kyc_check_begin(u, 'bvn', 'h2', 2, 'v1'); IF NOT (r ->> 'ok')::boolean THEN RAISE EXCEPTION 'kyc free-retry self-test: a network failure counted against the limit'; END IF;
  PERFORM public.kyc_check_finish((r ->> 'id')::uuid, 'no_funds', NULL, NULL, false);
  r := public.kyc_check_begin(u, 'bvn', 'h3', 2, 'v1'); IF NOT (r ->> 'ok')::boolean THEN RAISE EXCEPTION 'kyc free-retry self-test: an empty provider wallet counted against the limit'; END IF;
  -- a genuine "not found" answer DOES count — real information was returned
  PERFORM public.kyc_check_finish((r ->> 'id')::uuid, 'not_found', NULL, NULL, false);
  r := public.kyc_check_begin(u, 'bvn', 'h4', 2, 'v1'); IF NOT (r ->> 'ok')::boolean THEN RAISE EXCEPTION 'kyc free-retry self-test: first real answer wrongly refused a second attempt'; END IF;
  PERFORM public.kyc_check_finish((r ->> 'id')::uuid, 'mismatch', false, NULL, true);
  -- the limit of 2 is now used up by two REAL answers (not_found + mismatch) — a third real attempt is refused
  IF (public.kyc_check_begin(u, 'bvn', 'h5', 2, 'v1') ->> 'ok')::boolean THEN RAISE EXCEPTION 'kyc free-retry self-test: the limit did not hold once real answers were given'; END IF;
  -- an attempt that is still 'started' (never finished — abandoned, or genuinely still in flight) does not count either
  r := public.kyc_check_begin(u2, 'nin', 'h6', 1, 'v1'); IF NOT (r ->> 'ok')::boolean THEN RAISE EXCEPTION 'kyc free-retry self-test: first attempt for a fresh person refused'; END IF;
  r := public.kyc_check_begin(u2, 'nin', 'h7', 1, 'v1'); IF NOT (r ->> 'ok')::boolean THEN RAISE EXCEPTION 'kyc free-retry self-test: an unresolved attempt blocked a second one under the same limit'; END IF;
  -- the rewritten function still refuses everyone under a limit of 0 or a missing limit — never unlimited
  IF (public.kyc_check_begin(gen_random_uuid(), 'nin', 'h', 0, 'v1') ->> 'ok')::boolean THEN RAISE EXCEPTION 'kyc free-retry self-test: a limit of 0 must still refuse'; END IF;
  IF (public.kyc_check_begin(gen_random_uuid(), 'nin', 'h', NULL, 'v1') ->> 'ok')::boolean THEN RAISE EXCEPTION 'kyc free-retry self-test: a missing limit must still refuse'; END IF;
  RAISE EXCEPTION 'kyc free-retry self-test passed (rolled back)';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
  IF v_err NOT LIKE 'kyc free-retry self-test passed%' THEN RAISE; END IF;
  RAISE NOTICE 'kyc | free-retry self-test passed';
END $$;
