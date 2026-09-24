-- DRY RUN #2 ("soft switch"): make the BUSINESS Flutterwave account the active one again — payouts, new numbers and name
-- enquiries go through it — WITHOUT starting the grace period and WITHOUT notifying anyone.
-- Why now: the customer-name fix is deployed, the owner set the transfer source on the business dashboard, and the
-- legacy account no longer holds the float (₦37.58 vs ₦14,790 on business), so payouts on legacy fail with insufficient_balance.
--   • flw_legacy_grace_until stays empty, so nothing is ever treated as "retired" (old numbers keep crediting)
--   • no notification / email is sent (that is flw_switch_to_business(), run later on purpose)
-- Rollback: SELECT public.flw_switch_back_to_legacy();  — but only after checking where the float is.
UPDATE public.platform_config SET value = 'business' WHERE key = 'flw_active_account';
UPDATE public.platform_config SET value = ''         WHERE key = 'flw_legacy_grace_until';

DO $$
BEGIN
  RAISE NOTICE 'soft switch #2 applied: %', public.flw_account_status();
END $$;
