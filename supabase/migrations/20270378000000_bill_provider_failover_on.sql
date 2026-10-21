-- Owner, 2026-10-21: Bigisub is the backup for airtime and data, so orders must be allowed to move to it when
-- ClubKonnect confirms it can't take them. The failover switch had been turned off (Admin portal → Bill provider); with
-- it off no backup is ever used. VTpass is unaffected: it can't serve customers until its keys are live.
UPDATE public.platform_config SET value = 'true', updated_at = now() WHERE key = 'bill_provider_failover';
DO $$
BEGIN
  RAISE NOTICE 'switch | failover=% bigisub=% main=%',
    (SELECT value FROM public.platform_config WHERE key = 'bill_provider_failover'),
    (SELECT value FROM public.platform_config WHERE key = 'bill_provider_bigisub'),
    (SELECT value FROM public.platform_config WHERE key = 'bill_provider');
END $$;
