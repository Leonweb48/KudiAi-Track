-- READ-ONLY (2026-10-21): the owner gave three numbers whose airtime "showed successful but never arrived"
-- (…5002 ₦200, …5966 ₦400, …4559 ₦200). Every bill record for numbers ending in those digits since 1 Oct: date, amount,
-- category, bill status, how it was paid and our RequestID. Numbers are printed as the last 4 digits only. No writes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT t.created_at, t.amount, t.category, t.bill_status, t.payment_type,
           right(regexp_replace(coalesce(t.customer_name, ''), '\D', '', 'g'), 4) AS last4,
           substring(t.note FROM '(KDT-BILL-[0-9]+)') AS ref,
           (t.note ILIKE '%wallet%') AS wallet_paid, (t.note ILIKE '%PS:%') AS has_ps
      FROM public.transactions t
     WHERE t.payment_type = 'bill_payment' AND t.created_at >= '2026-10-01'
       AND regexp_replace(coalesce(t.customer_name, ''), '\D', '', 'g') ~ '(4315002|2355966|1214559)$'
     ORDER BY t.created_at LOOP
    RAISE NOTICE 'N1 % | …% | ₦% | % | bill=% | wallet=% | ref=%',
      to_char(r.created_at, 'MM-DD HH24:MI'), r.last4, r.amount, r.category, r.bill_status, r.wallet_paid, coalesce(r.ref, '-');
  END LOOP;
  RAISE NOTICE 'N2 bill records found: %', (SELECT count(*) FROM public.transactions t WHERE t.payment_type = 'bill_payment'
    AND t.created_at >= '2026-10-01' AND regexp_replace(coalesce(t.customer_name, ''), '\D', '', 'g') ~ '(4315002|2355966|1214559)$');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
