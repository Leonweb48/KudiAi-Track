-- Security audit 2026-10-25: one co-op Paystack payment could be credited more than once (two confirm requests at the
-- same moment, or — for savings — once per member). One row per Paystack reference now, enforced by the database. If
-- duplicates already exist they are only counted (nothing is changed) and that index is left for a person to review.
DO $$
DECLARE n_s int; n_l int;
BEGIN
  SELECT count(*) INTO n_s FROM (SELECT paystack_ref FROM public.org_savings WHERE paystack_ref IS NOT NULL GROUP BY 1 HAVING count(*) > 1) d;
  SELECT count(*) INTO n_l FROM (SELECT paystack_ref FROM public.org_loan_repayments WHERE paystack_ref IS NOT NULL GROUP BY 1 HAVING count(*) > 1) d;
  RAISE NOTICE 'coop paystack once | references credited more than once: savings %, loan repayments %', n_s, n_l;
  IF n_s = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS org_savings_paystack_ref_uidx ON public.org_savings (paystack_ref) WHERE paystack_ref IS NOT NULL;
  END IF;
  IF n_l = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS org_loan_repayments_paystack_ref_uidx ON public.org_loan_repayments (paystack_ref) WHERE paystack_ref IS NOT NULL;
  END IF;
END $$;
