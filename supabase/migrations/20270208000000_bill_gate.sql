-- Server-side gate for bill purchases (see supabase/functions/_shared/billGate.ts for the why).
--   bill_gate_claims — one row per accepted order: which payment (base_ref) paid for what (params_hash), by whom
--   bill_gate_log    — every refusal / would-be refusal, for review
--   bill_gate_wallet_paid() — how much of this user's wallet went to this bill reference
--   bill_gate_claim()       — atomically bind payment ↔ order and check the price floor
-- Everything here is server-only (service_role); users never touch it.

CREATE TABLE IF NOT EXISTS public.bill_gate_claims (
  request_id     TEXT        PRIMARY KEY,
  base_ref       TEXT        NOT NULL,
  user_id        UUID        NOT NULL,
  cat            TEXT        NOT NULL,
  params_hash    TEXT        NOT NULL,
  face_kobo      BIGINT      NOT NULL DEFAULT 0,
  paid_kobo      BIGINT      NOT NULL DEFAULT 0,
  allowance_kobo BIGINT      NOT NULL DEFAULT 0,
  coupon_code    TEXT,
  verdict        TEXT        NOT NULL DEFAULT 'ok',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bill_gate_claims_base_ref_idx ON public.bill_gate_claims (base_ref);
CREATE INDEX IF NOT EXISTS bill_gate_claims_user_idx     ON public.bill_gate_claims (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.bill_gate_log (
  id            BIGSERIAL   PRIMARY KEY,
  request_id    TEXT,
  user_id       UUID,
  cat           TEXT,
  reason        TEXT,
  face_kobo     BIGINT,
  paid_kobo     BIGINT,
  required_kobo BIGINT,
  enforced      BOOLEAN,
  detail        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.bill_gate_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_gate_log    ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bill_gate_claims, public.bill_gate_log FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.bill_gate_log_id_seq FROM PUBLIC, anon, authenticated;

-- Gate settings (admins can change them in the portal). enforce = block, log = only record, off = disabled.
INSERT INTO public.platform_config (key, value, description) VALUES
  ('bills_gate_mode',           'enforce', 'Bill purchase gate: proof of payment + order binding. enforce | log | off.'),
  ('bills_gate_floor_mode',     'log',     'Bill purchase price floor (payment must cover ~80% of face value). log = record only, enforce = block.'),
  ('bills_gate_floor_pct',      '80',      'Share of an order''s face value the payment must cover (percent).'),
  ('bills_gate_tolerance_kobo', '20000',   'Slack (kobo) allowed under the floor for small legitimate discounts such as cashback.')
ON CONFLICT (key) DO NOTHING;

-- Naira the user's wallet has actually spent on this bill reference (debits that are still standing)
CREATE OR REPLACE FUNCTION public.bill_gate_wallet_paid(p_user UUID, p_ref TEXT)
 RETURNS BIGINT
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(amount_kobo), 0)::bigint
    FROM public.wallet_ledger
   WHERE user_id = p_user AND source = 'bill_spend' AND direction = 'debit'
     AND reference = p_ref AND status IN ('pending', 'completed')
$function$;

CREATE OR REPLACE FUNCTION public.bill_gate_claim(
  p_request_id TEXT, p_base_ref TEXT, p_user UUID, p_cat TEXT, p_hash TEXT,
  p_face_kobo BIGINT, p_paid_kobo BIGINT, p_allowance_kobo BIGINT,
  p_coupon TEXT, p_coupon_one_per_user BOOLEAN,
  p_floor_pct INTEGER, p_tolerance_kobo BIGINT, p_enforce_floor BOOLEAN
) RETURNS JSONB
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing   public.bill_gate_claims%ROWTYPE;
  v_face_total BIGINT;
  v_allow_tot  BIGINT;
  v_required   BIGINT;
  v_verdict    TEXT := 'ok';
BEGIN
  IF p_request_id IS NULL OR p_base_ref IS NULL OR p_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_ref'); END IF;

  -- serialise concurrent claims on the same payment (the four sub-orders of an airtime bundle arrive together)
  PERFORM pg_advisory_xact_lock(hashtext(p_base_ref));

  SELECT * INTO v_existing FROM public.bill_gate_claims WHERE request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.user_id <> p_user     THEN RETURN jsonb_build_object('ok', false, 'reason', 'ref_owned_by_other'); END IF;
    IF v_existing.params_hash <> p_hash THEN RETURN jsonb_build_object('ok', false, 'reason', 'ref_reused'); END IF;
    RETURN jsonb_build_object('ok', true, 'replay', true, 'verdict', v_existing.verdict);   -- a safe retry of the same order
  END IF;

  IF EXISTS (SELECT 1 FROM public.bill_gate_claims WHERE base_ref = p_base_ref AND user_id <> p_user) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ref_owned_by_other');
  END IF;

  -- a coupon that pays for the whole order can be used once per user when the coupon says so
  IF p_coupon IS NOT NULL AND p_paid_kobo = 0 AND COALESCE(p_coupon_one_per_user, true) THEN
    IF EXISTS (SELECT 1 FROM public.bill_gate_claims WHERE user_id = p_user AND upper(coupon_code) = upper(p_coupon) AND paid_kobo = 0 AND base_ref <> p_base_ref) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_used');
    END IF;
  END IF;

  -- price floor over everything this one payment is being used for
  SELECT COALESCE(SUM(face_kobo), 0) + COALESCE(p_face_kobo, 0), COALESCE(SUM(allowance_kobo), 0) + COALESCE(p_allowance_kobo, 0)
    INTO v_face_total, v_allow_tot
    FROM public.bill_gate_claims WHERE base_ref = p_base_ref;
  v_required := GREATEST(0, (v_face_total * COALESCE(p_floor_pct, 80) / 100) - v_allow_tot - COALESCE(p_tolerance_kobo, 0));

  IF COALESCE(p_paid_kobo, 0) < v_required THEN
    IF p_enforce_floor THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'underpaid', 'required_kobo', v_required, 'paid_kobo', p_paid_kobo);
    END IF;
    v_verdict := 'would_block_floor';
  END IF;

  INSERT INTO public.bill_gate_claims (request_id, base_ref, user_id, cat, params_hash, face_kobo, paid_kobo, allowance_kobo, coupon_code, verdict)
  VALUES (p_request_id, p_base_ref, p_user, p_cat, p_hash, COALESCE(p_face_kobo, 0), COALESCE(p_paid_kobo, 0), COALESCE(p_allowance_kobo, 0), p_coupon, v_verdict);

  RETURN jsonb_build_object('ok', true, 'verdict', v_verdict, 'required_kobo', v_required);
END;
$function$;

REVOKE ALL ON FUNCTION public.bill_gate_wallet_paid(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bill_gate_claim(TEXT, TEXT, UUID, TEXT, TEXT, BIGINT, BIGINT, BIGINT, TEXT, BOOLEAN, INTEGER, BIGINT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.bill_gate_wallet_paid(UUID, TEXT) TO service_role;
GRANT  EXECUTE ON FUNCTION public.bill_gate_claim(TEXT, TEXT, UUID, TEXT, TEXT, BIGINT, BIGINT, BIGINT, TEXT, BOOLEAN, INTEGER, BIGINT, BOOLEAN) TO service_role;
GRANT  ALL ON public.bill_gate_claims, public.bill_gate_log TO service_role;
GRANT  USAGE, SELECT ON SEQUENCE public.bill_gate_log_id_seq TO service_role;
