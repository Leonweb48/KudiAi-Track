-- Business posters (2026-10-27): owners print / share two posters made in the app.
--   • "Pay by transfer" — the business wallet's account number, bank and the account name Flutterwave registered.
--   • "Ajo & Esusu available" — a "scan to join" QR that opens wallet sign-up with this business already chosen.
-- Both posters carry a QR to kudiai.app/pay/<code> or kudiai.app/join/<code>. Those public pages read the business LIVE
-- through business_poster_lookup, so a customer can check that the number on a poster really is this business's
-- (someone sticking their own number over a shop's poster is the fraud this guards against).
--
--   profiles.poster_code          8 characters, A–Z and 2–9 without look-alikes (no I, L, O, 0, 1); made on first use
--   owner_poster_code()           the signed-in business owner's code (creates it once) — authenticated only
--   business_poster_lookup(code)  public: business name, published registration fee, and the wallet account ONLY while
--                                 it can receive money (wallet active, number not on a retired legacy account)

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS poster_code text;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_poster_code_key ON public.profiles (poster_code) WHERE poster_code IS NOT NULL;

CREATE OR REPLACE FUNCTION public.owner_poster_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_code  text;
  v_biz   text;
  v_abc   constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  i       int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501'; END IF;
  SELECT poster_code, NULLIF(btrim(business_name), '') INTO v_code, v_biz FROM public.profiles WHERE id = v_uid;
  IF v_biz IS NULL THEN RAISE EXCEPTION 'Only a business account has posters' USING ERRCODE = '42501'; END IF;
  IF v_code IS NOT NULL THEN RETURN v_code; END IF;
  LOOP
    v_code := '';
    FOR i IN 1..8 LOOP
      v_code := v_code || substr(v_abc, 1 + floor(random() * length(v_abc))::int, 1);
    END LOOP;
    BEGIN
      UPDATE public.profiles SET poster_code = v_code WHERE id = v_uid AND poster_code IS NULL;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      -- another business already holds this code: draw again
    END;
  END LOOP;
  -- a concurrent call may have set it first; return whatever is stored
  SELECT poster_code INTO v_code FROM public.profiles WHERE id = v_uid;
  RETURN v_code;
END;
$function$;

REVOKE ALL ON FUNCTION public.owner_poster_code() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.owner_poster_code() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.business_poster_lookup(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_code   text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  p        record;
  w        record;
  v_active text;
  v_grace  text;
  v_until  timestamptz;
  v_acct   jsonb := NULL;
BEGIN
  IF v_code !~ '^[A-HJKMNP-Z2-9]{8}$' THEN RETURN jsonb_build_object('ok', false); END IF;
  SELECT id, NULLIF(btrim(business_name), '') AS business_name, ajo_registration_fee
    INTO p FROM public.profiles WHERE poster_code = v_code;
  IF NOT FOUND OR p.business_name IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;

  SELECT status, flw_account_number, flw_account_bank, flw_account_name, flw_virtual_account_id, flw_account
    INTO w FROM public.wallets WHERE user_id = p.id;
  IF FOUND AND w.status = 'active' AND w.flw_virtual_account_id IS NOT NULL AND NULLIF(w.flw_account_number, '') IS NOT NULL THEN
    -- Same rule as src/utils/walletAccount.js: a number on the legacy account stops crediting once the business
    -- account is active and the grace deadline has passed. A missing or unreadable deadline never retires anything.
    SELECT value INTO v_active FROM public.platform_config WHERE key = 'flw_active_account';
    SELECT value INTO v_grace  FROM public.platform_config WHERE key = 'flw_legacy_grace_until';
    BEGIN v_until := NULLIF(btrim(v_grace), '')::timestamptz; EXCEPTION WHEN OTHERS THEN v_until := NULL; END;
    IF NOT (coalesce(w.flw_account, 'legacy') <> 'business' AND lower(coalesce(v_active, '')) = 'business'
            AND v_until IS NOT NULL AND now() > v_until) THEN
      v_acct := jsonb_build_object('number', w.flw_account_number, 'bank', w.flw_account_bank, 'name', w.flw_account_name);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'business_id', p.id,
    'business_name', p.business_name,
    'registration_fee', coalesce(p.ajo_registration_fee, 0),
    'account', v_acct
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.business_poster_lookup(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.business_poster_lookup(text) TO anon, authenticated, service_role;

-- The anon-revoke healer (20270199) must leave this public lookup alone, like the receipt-verification page's.
CREATE OR REPLACE FUNCTION public.security_revoke_anon_definer()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r      record;
  n      integer := 0;
  v_auth boolean;
  -- Functions that unauthenticated visitors legitimately call: the public receipt-verification page, plan lookup,
  -- and the business-poster pages (kudiai.app/pay/<code>, /join/<code>).
  v_anon_ok text[] := ARRAY['verify_receipt', 'is_free_plan', 'business_poster_lookup'];
BEGIN
  FOR r IN
    SELECT p.oid AS fn_oid, p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.prokind = 'f' AND p.prosecdef
       AND p.prorettype <> 'trigger'::regtype
       AND NOT (p.proname = ANY (v_anon_ok))
       AND has_function_privilege('anon', p.oid, 'EXECUTE')
  LOOP
    v_auth := has_function_privilege('authenticated', r.fn_oid, 'EXECUTE');
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);   -- anon inherits from PUBLIC
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    -- never take access away from logged-in users, or from the server
    IF v_auth AND NOT has_function_privilege('authenticated', r.fn_oid, 'EXECUTE') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$function$;

REVOKE ALL ON FUNCTION public.security_revoke_anon_definer() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.security_revoke_anon_definer() TO service_role;
