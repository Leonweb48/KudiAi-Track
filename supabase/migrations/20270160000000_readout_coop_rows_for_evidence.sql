-- READ-ONLY diagnostic (no writes): newest cooperative savings / loan-repayment rows and their stored
-- references, so the coop emails can be exercised against real rows. Read with: gh run view <id> --log | grep NOTICE
DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE '── newest org_savings ──';
  FOR r IN SELECT id, receipt_ref, type, payment_method, amount, balance_after, created_at
             FROM public.org_savings WHERE receipt_ref IS NOT NULL ORDER BY created_at DESC LIMIT 3
  LOOP
    RAISE NOTICE 'saving id=% ref=% type=% method=% amount=% balance_after=% at=%', r.id, r.receipt_ref, r.type, r.payment_method, r.amount, r.balance_after, r.created_at;
  END LOOP;
  RAISE NOTICE '── newest org_loan_repayments ──';
  FOR r IN SELECT id, receipt_ref, payment_method, amount, created_at
             FROM public.org_loan_repayments WHERE receipt_ref IS NOT NULL ORDER BY created_at DESC LIMIT 3
  LOOP
    RAISE NOTICE 'repayment id=% ref=% method=% amount=% at=%', r.id, r.receipt_ref, r.payment_method, r.amount, r.created_at;
  END LOOP;
  RAISE NOTICE 'counts: org_savings=% org_loan_repayments=%', (SELECT count(*) FROM public.org_savings), (SELECT count(*) FROM public.org_loan_repayments);
END $$;
