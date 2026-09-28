-- Switch the ClubKonnect V3 fallback OFF: V3 does not accept our account.
--
-- After the new API key went in (2026-09-28, ck-set-key workflow), the route check showed all 11 keys accepted on the
-- main route (V1), but V3 answers INVALID_CREDENTIALS to the same account and key — V3 appears to belong to a different
-- kind of ClubKonnect account (they run separate retail and enterprise logins). So the fallback can never succeed for
-- us, and leaving it on is worse than off: when V1 is down, the pre-charge check sees V3 "up" (its made-up-account
-- probe can't see a credentials problem) and lets customers through to be debited, then refunded — instead of stopping
-- them BEFORE they're charged. The fallback code stays in place (clubkonnect/index.ts, _shared/ckRoute.ts): if
-- ClubKonnect ever enables V3 for this account, prove it with one test purchase (ck_v3_force_services) and turn this
-- back on. The pre-charge outage check (ck_route_healthcheck_enabled) stays ON.
UPDATE public.platform_config
   SET value = 'false',
       description = 'When ClubKonnect''s main purchase route crashes, confirm no order was created and place it on the backup (V3) route instead. OFF since 2026-09-28: V3 answers INVALID_CREDENTIALS for our account. Only turn on after ClubKonnect enables V3 for this account and a test purchase (ck_v3_force_services) succeeds.'
 WHERE key = 'ck_v3_fallback_enabled';

DO $$
BEGIN
  IF (SELECT value FROM public.platform_config WHERE key = 'ck_v3_fallback_enabled') IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'ck_v3_fallback_enabled was not switched off';
  END IF;
  RAISE NOTICE 'ck routing | V3 fallback OFF (V3 rejects our credentials); pre-charge check = %',
    (SELECT value FROM public.platform_config WHERE key = 'ck_route_healthcheck_enabled');
END $$;
