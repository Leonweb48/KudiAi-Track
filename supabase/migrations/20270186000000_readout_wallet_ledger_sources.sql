-- READ-ONLY diagnostic (no writes): can wallet_ledger accept the peer_esusu_* sources, and do the helpers the peer
-- esusu RPCs call actually exist? Prints the constraint's allowed-source list and function presence only. Read with:
--   gh run view <id> --log | grep NOTICE
DO $$
DECLARE r record; v_def text; v_src text;
BEGIN
  FOR r IN SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
            WHERE conrelid = 'public.wallet_ledger'::regclass AND contype = 'c' LOOP
    RAISE NOTICE 'ledger constraint | % | %', r.conname, regexp_replace(r.def, '\s+', ' ', 'g');
  END LOOP;

  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.wallet_ledger'::regclass AND conname = 'wallet_ledger_source_check';
  FOREACH v_src IN ARRAY ARRAY['peer_esusu_contribution','peer_esusu_collection','peer_esusu_payout','peer_esusu_payout_sweep','wallet_fee','ajo_contribution'] LOOP
    RAISE NOTICE 'ledger source allowed | % = %', v_src, coalesce(position('''' || v_src || '''' in v_def) > 0, false);
  END LOOP;

  FOR r IN SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND p.proname IN ('wallet_daily_transfer_count','wallet_transfer_fee_kobo','wallet_credit_settlement',
                                'peer_esusu_pay_contribution','peer_esusu_execute_payout')
            ORDER BY 1 LOOP
    RAISE NOTICE 'function exists | %(%)', r.proname, r.args;
  END LOOP;

  FOR r IN SELECT tgname, tgenabled FROM pg_trigger
            WHERE tgrelid = 'public.wallet_ledger'::regclass AND NOT tgisinternal LOOP
    RAISE NOTICE 'ledger trigger | % enabled=%', r.tgname, r.tgenabled;
  END LOOP;
END $$;
