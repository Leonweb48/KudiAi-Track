-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Switches for ClubKonnect purchase routing (clubkonnect/index.ts ckBuy + bill-preflight; logic in _shared/ckRoute.ts).
--
-- On 2026-09-28 ClubKonnect's main purchase scripts (V1/V2) crashed for ~3 hours while their V3 scripts and the order
-- lookup stayed up; every customer purchase failed and was refunded. Two protections, both switchable here without
-- an app update:
--   • fallback — when the main route crashes, confirm via the order lookup that no order was created, then place the
--     same order on V3 with the same RequestID (no double charge possible);
--   • pre-charge outage check — before a customer is debited, a free probe (made-up account, never ours) checks the
--     purchase route is up; if it's down and no working backup is enabled for that service, the customer is told to
--     try later and is NOT charged.
-- Admins are emailed + notified (at most hourly) whenever either kicks in.
--
-- Default services: airtime, cable, betting, smile — simple answers (status + order id). NOT data: in June 2026 V3
-- rejected our data plan IDs (INVALID_DATAPLAN), and listing it would let the pre-charge check wave customers through
-- to a debit that V3 then refuses. NOT electricity / e-PINs / WAEC / JAMB: they return tokens, PINs and card details
-- whose V3 format isn't proven. Add any of them once a real test purchase on V3 works (ck_v3_force_services).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
INSERT INTO public.platform_config (key, value, description) VALUES
  ('ck_v3_fallback_enabled', 'true',
   'When ClubKonnect''s main purchase route crashes, confirm no order was created and place it on the backup (V3) route instead. false = no fallback (the customer is refunded, as before).'),
  ('ck_v3_fallback_services', 'airtime,cable,betting,smile',
   'Services allowed to fall back to V3, comma-separated (airtime, data, cable, electricity, betting, waec, jamb, spectranet, smile, print-airtime, print-data). Add data / electricity / e-PINs / WAEC / JAMB only after a real test purchase on V3 works.'),
  ('ck_v3_force_services', '',
   'TEST ONLY — services listed here skip the main route and go straight to V3, for one supervised test purchase. Leave empty otherwise.'),
  ('ck_route_healthcheck_enabled', 'true',
   'Before charging a customer, check (free, with a made-up account) that ClubKonnect''s purchase route is up. If it''s down and no working backup is enabled for that service, the customer is told to try later and is NOT charged.')
ON CONFLICT (key) DO NOTHING;

DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.platform_config
   WHERE key IN ('ck_v3_fallback_enabled', 'ck_v3_fallback_services', 'ck_v3_force_services', 'ck_route_healthcheck_enabled');
  IF v_n <> 4 THEN RAISE EXCEPTION 'ck routing switches: expected 4 keys, found %', v_n; END IF;
  RAISE NOTICE 'ck routing | switches present: fallback=%, services=%, force=%, healthcheck=%',
    (SELECT value FROM public.platform_config WHERE key = 'ck_v3_fallback_enabled'),
    (SELECT value FROM public.platform_config WHERE key = 'ck_v3_fallback_services'),
    (SELECT value FROM public.platform_config WHERE key = 'ck_v3_force_services'),
    (SELECT value FROM public.platform_config WHERE key = 'ck_route_healthcheck_enabled');
END $$;
