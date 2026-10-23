-- READ-ONLY (2026-10-23): was the ₦1,500 MTN data order KDT-BILL-1792739992087 (ClubKonnect: INVALID_DATAPLAN) given back?
-- How it was paid and the money lines carrying its reference. Amounts and states only. No writes.
DO $$
DECLARE r record; ref constant text := 'KDT-BILL-1792739992087';
BEGIN
  FOR r IN SELECT bill_status, bill_details->>'paid_via' AS via, payment_type FROM public.transactions WHERE note LIKE '%' || ref || '%' LOOP
    RAISE NOTICE 'Q1 bill=% | paid_via=% | type=%', r.bill_status, coalesce(r.via, '-'), r.payment_type;
  END LOOP;
  FOR r IN SELECT source, status, direction, amount_kobo FROM public.wallet_ledger WHERE reference = ref OR related_txn_id::text = ref ORDER BY created_at LOOP
    RAISE NOTICE 'Q2 ledger % | % | % | ₦%', r.source, r.status, r.direction, r.amount_kobo / 100.0;
  END LOOP;
  RAISE NOTICE 'Q3 cashback lines that minute: %', (SELECT string_agg(type || ' ₦' || amount, ', ') FROM public.cashback_transactions
    WHERE created_at BETWEEN '2026-10-23 07:18:30+00' AND '2026-10-23 07:22:00+00' AND bill_type = 'data');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
