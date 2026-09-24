-- THE REAL SWITCH (run once, deliberately, on the owner's instruction after dry run #2 passed: payouts, new numbers, deposits and
-- the business webhook all verified). The business Flutterwave account is already active; this sets the 7-DAY grace deadline for
-- the legacy account's numbers and sends the in-app notice (bell + push) to every holder of an old number.
--   • old numbers keep crediting wallets until the deadline; afterwards deposits to them are held for review (flutterwave-webhook)
--   • wallets are forced to move at login (WalletMigrationGate) and emailed (announce-migration / send-account-details)
-- Rollback of the deadline only: UPDATE platform_config SET value = '' WHERE key = 'flw_legacy_grace_until';
DO $$
DECLARE v_until timestamptz;
BEGIN
  v_until := public.flw_switch_to_business('7 days');
  RAISE NOTICE 'real switch done — legacy grace ends %', v_until;
  RAISE NOTICE 'status: %', public.flw_account_status();
END $$;
