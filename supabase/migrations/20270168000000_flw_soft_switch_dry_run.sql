-- DRY RUN ("soft switch"): make the BUSINESS Flutterwave account the active one — new numbers, payouts and name
-- enquiries go through it — WITHOUT starting the grace period and WITHOUT notifying anyone.
--   • flw_legacy_grace_until stays empty, so nothing is ever treated as "retired" (old numbers keep crediting)
--   • no notification / email is sent (that is flw_switch_to_business(), run later on purpose)
-- Rollback: SELECT public.flw_switch_back_to_legacy();   (or a migration doing the same)
UPDATE public.platform_config SET value = 'business' WHERE key = 'flw_active_account';
UPDATE public.platform_config SET value = ''         WHERE key = 'flw_legacy_grace_until';

DO $$
BEGIN
  RAISE NOTICE 'soft switch applied: %', public.flw_account_status();
END $$;
