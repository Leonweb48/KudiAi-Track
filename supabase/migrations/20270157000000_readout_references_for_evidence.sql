-- READ-ONLY diagnostic (no writes): the newest real rows and their stored references,
-- so the email / receipt / verify evidence can be shown against real data.
-- Read with:  gh run view <id> --log | grep NOTICE
DO $$
DECLARE
  r record;
  v jsonb;
  first_ref text;
BEGIN
  RAISE NOTICE '── newest ajo_contributions (contribution, completed) ──';
  FOR r IN
    SELECT id, receipt_ref, amount, balance_after, created_at
      FROM public.ajo_contributions
     WHERE type = 'contribution' AND status = 'completed' AND receipt_ref IS NOT NULL
     ORDER BY created_at DESC LIMIT 3
  LOOP
    RAISE NOTICE 'ajo id=% ref=% amount=% balance_after=% at=%', r.id, r.receipt_ref, r.amount, r.balance_after, r.created_at;
  END LOOP;

  RAISE NOTICE '── newest transactions ──';
  FOR r IN
    SELECT id, receipt_ref, type, amount, balance_after, created_at
      FROM public.transactions WHERE receipt_ref IS NOT NULL
     ORDER BY created_at DESC LIMIT 3
  LOOP
    RAISE NOTICE 'txn id=% ref=% type=% amount=% balance_after=% at=%', r.id, r.receipt_ref, r.type, r.amount, r.balance_after, r.created_at;
    IF first_ref IS NULL THEN first_ref := r.receipt_ref; END IF;
  END LOOP;

  RAISE NOTICE '── newest wallet_ledger ──';
  FOR r IN
    SELECT id, receipt_ref, source, direction, amount_kobo, balance_after_kobo, created_at
      FROM public.wallet_ledger WHERE receipt_ref IS NOT NULL
     ORDER BY created_at DESC LIMIT 3
  LOOP
    RAISE NOTICE 'ledger id=% ref=% source=% dir=% kobo=% balance_after_kobo=% at=%', r.id, r.receipt_ref, r.source, r.direction, r.amount_kobo, r.balance_after_kobo, r.created_at;
  END LOOP;

  RAISE NOTICE '── rows still WITHOUT a reference (must be 0, including rows created after the deploy) ──';
  RAISE NOTICE 'transactions=% debt_payments=% ajo_contributions=% org_savings=% org_loan_repayments=% wallet_ledger=%',
    (SELECT count(*) FROM public.transactions WHERE receipt_ref IS NULL),
    (SELECT count(*) FROM public.debt_payments WHERE receipt_ref IS NULL),
    (SELECT count(*) FROM public.ajo_contributions WHERE receipt_ref IS NULL),
    (SELECT count(*) FROM public.org_savings WHERE receipt_ref IS NULL),
    (SELECT count(*) FROM public.org_loan_repayments WHERE receipt_ref IS NULL),
    (SELECT count(*) FROM public.wallet_ledger WHERE receipt_ref IS NULL);
  RAISE NOTICE 'duplicate references in the registry (must be 0): %',
    (SELECT count(*) FROM (SELECT ref FROM public.receipt_references GROUP BY ref HAVING count(*) > 1) x);

  IF first_ref IS NOT NULL THEN
    v := public.verify_receipt(first_ref);
    RAISE NOTICE 'verify_receipt(%) => %', first_ref, v;
  END IF;
  RAISE NOTICE 'verify_receipt(unknown) => %', public.verify_receipt('KDT-202609-AAAAAAAA');
  RAISE NOTICE 'verify_receipt(garbage) => %', public.verify_receipt('not a reference');
END $$;
