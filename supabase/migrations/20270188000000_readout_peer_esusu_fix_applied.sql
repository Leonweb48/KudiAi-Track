-- READ-ONLY verification (no writes) that 20270187 landed: ledger sources, cycle columns, replaced functions.
-- Prints booleans/counts only. Read with:  gh run view <id> --log | grep NOTICE
DO $$
DECLARE v_def text; v_src text; r record;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.wallet_ledger'::regclass AND conname = 'wallet_ledger_source_check';
  FOREACH v_src IN ARRAY ARRAY['peer_esusu_contribution','peer_esusu_collection','peer_esusu_payout','peer_esusu_payout_sweep',
                               'topup','sale','bill_spend','bill_reversal','withdrawal','withdrawal_reversal','adjustment',
                               'ajo_contribution','ajo_collection','ajo_payout','transfer_fee','cbn_levy','wallet_fee',
                               'subscription_spend','subscription_reversal'] LOOP
    IF position('''' || v_src || '''' in v_def) = 0 THEN RAISE NOTICE 'peer fix check | MISSING ledger source: %', v_src; END IF;
  END LOOP;
  RAISE NOTICE 'peer fix check | ledger source count = %', (SELECT count(*) FROM regexp_matches(v_def, '''[a-z_]+''', 'g'));

  FOR r IN SELECT table_name, column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND column_name = 'cycle_no' AND table_name LIKE 'peer_esusu%' ORDER BY 1 LOOP
    RAISE NOTICE 'peer fix check | column present: %.%', r.table_name, r.column_name;
  END LOOP;

  FOR r IN SELECT p.proname, position('cycle_no' in pg_get_functiondef(p.oid)) > 0 AS uses_cycle
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('peer_esusu_pay_contribution','peer_esusu_execute_payout') ORDER BY 1 LOOP
    RAISE NOTICE 'peer fix check | function % is the new version (uses cycle_no) = %', r.proname, r.uses_cycle;
  END LOOP;

  RAISE NOTICE 'peer fix check | circles now: %, contributions: %, peer ledger rows: %',
    (SELECT count(*) FROM public.peer_esusu_groups), (SELECT count(*) FROM public.peer_esusu_contributions),
    (SELECT count(*) FROM public.wallet_ledger WHERE source LIKE 'peer_esusu%');
END $$;
