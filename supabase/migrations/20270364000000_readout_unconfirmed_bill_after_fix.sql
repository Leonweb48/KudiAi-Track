-- READ-ONLY (2026-10-20): KDT-BILL-1792484501202 after the beyond-30-days fix — was the ₦300 refunded? Statuses only.
DO $$
DECLARE r record; v_ref constant text := 'KDT-BILL-1792484501202';
BEGIN
  FOR r IN SELECT source, direction, status, amount_kobo, created_at FROM public.wallet_ledger
            WHERE reference = v_ref OR related_txn_id::text = v_ref OR narration ILIKE '%' || v_ref || '%' ORDER BY created_at LOOP
    RAISE NOTICE 'C1 ledger | source=% dir=% status=% kobo=% at=%', r.source, r.direction, r.status, r.amount_kobo, r.created_at;
  END LOOP;
  RAISE NOTICE 'C2 bill transaction status: %', (SELECT string_agg(bill_status, ',') FROM public.transactions WHERE note LIKE '%PS: ' || v_ref || '%');
  RAISE NOTICE 'C3 refund notification sent: %', (SELECT count(*) FROM public.notifications WHERE type = 'bill_payment_failed' AND created_at > now() - interval '3 hours' AND body LIKE '%₦300 airtime%');
  RAISE NOTICE 'C4 open tickets for it: %', (SELECT count(*) FROM public.support_tickets WHERE description LIKE '%' || v_ref || '%' AND status = 'open');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
