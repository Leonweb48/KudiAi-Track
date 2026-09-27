-- All three kyc_* switches were turned on together via the admin Feature Flags page (which offers every boolean in platform_config), not just
-- kyc_youverify_enabled. Confirmed with the owner: identity checks should stay on the SANDBOX (kyc_youverify_live = false — no real, billed lookups
-- until proven working) and should BLOCK rather than silently pass unverified if Youverify is unreachable (kyc_fail_open = false). Sets both back to
-- their safe defaults; leaves kyc_youverify_enabled exactly as it is (the owner's decision to switch checks on stands).
DO $$
DECLARE r record;
BEGIN
  UPDATE public.platform_config SET value = 'false' WHERE key = 'kyc_youverify_live' AND value <> 'false';
  UPDATE public.platform_config SET value = 'false' WHERE key = 'kyc_fail_open'       AND value <> 'false';
  FOR r IN SELECT key, value FROM public.platform_config WHERE key LIKE 'kyc_%' ORDER BY key LOOP
    RAISE NOTICE 'kyc config | % = %', r.key, r.value;
  END LOOP;
END $$;
