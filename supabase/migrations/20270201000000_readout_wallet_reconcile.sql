-- READ-ONLY (no writes; no user identifiers): the platform's own wallet reconciliation — does every wallet balance equal
-- what its ledger adds up to? (The earlier abuse readout mishandled 'reversed' rows; wallet_reconcile() counts them correctly.)
-- Read with:  gh run view <id> --log | grep NOTICE
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT count(*) AS wallets,
           count(*) FILTER (WHERE drift_kobo <> 0) AS drifting,
           coalesce(sum(stored_kobo), 0) / 100 AS stored_naira,
           coalesce(sum(ledger_kobo), 0) / 100 AS ledger_naira
      FROM public.wallet_reconcile()
  LOOP
    RAISE NOTICE 'reconcile | wallets=% drifting=% stored_total_NGN=% ledger_total_NGN=%', r.wallets, r.drifting, r.stored_naira, r.ledger_naira;
  END LOOP;
  FOR r IN SELECT drift_kobo / 100.0 AS drift_naira, stored_kobo / 100.0 AS stored_naira, ledger_kobo / 100.0 AS ledger_naira FROM public.wallet_reconcile() WHERE drift_kobo <> 0 ORDER BY abs(drift_kobo) DESC LIMIT 10 LOOP
    RAISE NOTICE 'reconcile | drifting wallet: stored_NGN=% ledger_NGN=% drift_NGN=%', r.stored_naira, r.ledger_naira, r.drift_naira;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'reconcile | error: %', SQLERRM;
END $$;
