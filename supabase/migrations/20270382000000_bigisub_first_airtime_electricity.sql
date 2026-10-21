-- Owner (2026-10-21): ClubKonnect has been charging for bills that never arrive while reporting success. Until further
-- notice Bigisub is the MAIN provider for airtime and electricity; ClubKonnect stays their backup (an order moves to it
-- only when Bigisub confirms it placed nothing — e.g. its wallet can't cover it). Data and everything else are unchanged.
-- Comma-separated services; '' puts ClubKonnect back first.
INSERT INTO public.platform_config (key, value, description) VALUES
  ('bill_bigisub_first', 'airtime,electricity',
   'Services where Bigisub is the main bill provider and ClubKonnect its backup (comma-separated: airtime, data, electricity). Empty = ClubKonnect first.')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

DO $$
BEGIN
  RAISE NOTICE 'bigisub-first | services=% | bigisub=% | failover=%',
    (SELECT value FROM public.platform_config WHERE key = 'bill_bigisub_first'),
    (SELECT value FROM public.platform_config WHERE key = 'bill_provider_bigisub'),
    (SELECT value FROM public.platform_config WHERE key = 'bill_provider_failover');
END $$;
