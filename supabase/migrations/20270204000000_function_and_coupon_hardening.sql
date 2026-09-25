-- Follow-ups from the 2026-09-25 security review.
--
-- 1. submit_approval_request has two overloads. The app only ever calls the 4-argument one (requester = auth.uid()).
--    The 6-argument one takes the requester and business as PARAMETERS and checks nothing, so any logged-in user could
--    file an admin approval request in someone else's name (e.g. "delete this credit"). Nothing calls it: make it
--    server-only.
-- 2. coupons was readable by everyone (policy coupons_read_all, USING true), so anyone could list every coupon code and
--    its terms. The app never reads the table directly — it goes through check_coupon / validate_coupon / redeem_coupon,
--    which are SECURITY DEFINER — and the admin portal uses the service role. Drop the open read policy.

DO $$
BEGIN
  REVOKE ALL ON FUNCTION public.submit_approval_request(text, uuid, text, uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.submit_approval_request(text, uuid, text, uuid, jsonb, text) TO service_role;
  RAISE NOTICE 'hardening | 6-arg submit_approval_request is now server-only';
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE 'hardening | 6-arg submit_approval_request not present — skipped';
END $$;

DROP POLICY IF EXISTS "coupons_read_all" ON public.coupons;

DO $$
BEGIN
  RAISE NOTICE 'hardening | coupons policies now: %',
    (SELECT coalesce(string_agg(policyname || ' [' || roles::text || ']', ', '), 'none') FROM pg_policies WHERE schemaname = 'public' AND tablename = 'coupons');
  RAISE NOTICE 'hardening | 4-arg submit_approval_request still callable by authenticated: %',
    has_function_privilege('authenticated', 'public.submit_approval_request(text, uuid, jsonb, text)'::regprocedure, 'EXECUTE');
  RAISE NOTICE 'hardening | 6-arg submit_approval_request callable by authenticated: %',
    has_function_privilege('authenticated', 'public.submit_approval_request(text, uuid, text, uuid, jsonb, text)'::regprocedure, 'EXECUTE');
END $$;
