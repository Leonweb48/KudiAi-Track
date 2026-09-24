-- Dry-run rollback: the business account rejected a transfer ("select your transfer source on the dashboard") and customer
-- creation ("Could not create wallet profile"), so put the LEGACY account back as the active one until both are fixed.
-- Wallets are untouched (none had been moved); old numbers kept crediting throughout.
SELECT public.flw_switch_back_to_legacy();

DO $$
BEGIN
  RAISE NOTICE 'rolled back: %', public.flw_account_status();
END $$;
