-- Close the "BILLING UNCONFIRMED" ticket for KDT-BILL-1792484501202 (Airtime ₦300, 20 Oct 2026). Reconciled: ClubKonnect
-- has no order for that RequestID (its lookup answers TRANSACTION_BEYOND_30_DAYS for it, while orders before and after
-- it come back ORDER_COMPLETED), so nothing was delivered; the bill-charge-sweep refunded the ₦300 to the wallet at
-- 15:30 UTC, marked the bill failed and notified the customer.
DO $$
DECLARE n int;
BEGIN
  UPDATE public.support_tickets
     SET status = 'closed', closed_at = now(), updated_at = now(),
         resolution_note = 'Reconciled 20 Oct 2026: not delivered — ClubKonnect has no order for KDT-BILL-1792484501202 (the network dropped the purchase call). ₦300 refunded to the wallet automatically at 15:30 UTC; bill marked failed; customer notified.'
   WHERE description LIKE '%KDT-BILL-1792484501202%' AND status = 'open';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'ticket | closed %', n;
EXCEPTION WHEN undefined_column THEN
  UPDATE public.support_tickets SET status = 'closed', closed_at = now()
   WHERE description LIKE '%KDT-BILL-1792484501202%' AND status = 'open';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'ticket | closed % (no updated_at/resolution_note column)', n;
END $$;
