-- Owner (2026-10-23): ClubKonnect is the PRIMARY bill provider again for every bill; Bigisub is the backup. This undoes
-- 20270382 (Bigisub first for airtime and electricity). Bigisub still takes an airtime / data / electricity / exam order
-- whenever ClubKonnect confirms it placed nothing (rule 1), and data plans still come from Bigisub when ClubKonnect's
-- wallet can't cover them.
UPDATE public.platform_config SET value = '', updated_at = now() WHERE key = 'bill_bigisub_first';

DO $$
BEGIN
  RAISE NOTICE 'providers | main=% | bigisub first for=[%] | bigisub backup on=% | failover=%',
    (SELECT value FROM public.platform_config WHERE key = 'bill_provider'),
    (SELECT value FROM public.platform_config WHERE key = 'bill_bigisub_first'),
    (SELECT value FROM public.platform_config WHERE key = 'bill_provider_bigisub'),
    (SELECT value FROM public.platform_config WHERE key = 'bill_provider_failover');
END $$;
