-- READ-ONLY (2026-10-21): how was KDT-BILL-1792579001994 (₦200 MTN airtime, not delivered — ClubKonnect 201 "Network
-- Unresponsive") paid? Any ledger line, coupon or Paystack record carrying that reference, and the bill record's
-- payment fields. Sources, statuses, amounts only. No writes.
DO $$
DECLARE r record; v_ref constant text := 'KDT-BILL-1792579001994'; t record;
BEGIN
  FOR r IN SELECT source, direction, status, amount_kobo, user_id IS NOT NULL has_user FROM public.wallet_ledger
            WHERE reference = v_ref OR flw_reference = v_ref OR narration ILIKE '%' || v_ref || '%' OR meta::text LIKE '%' || v_ref || '%' LOOP
    RAISE NOTICE 'P1 ledger | % % % kobo=%', r.source, r.direction, r.status, r.amount_kobo;
  END LOOP;
  SELECT * INTO t FROM public.transactions WHERE payment_type = 'bill_payment' AND created_at BETWEEN '2026-10-21 10:36+00' AND '2026-10-21 10:38+00' LIMIT 1;
  IF FOUND THEN
    RAISE NOTICE 'P2 txn | amount=% type=% cat=% bill_status=% | columns with a value: %', t.amount, t.type, t.category, t.bill_status,
      (SELECT string_agg(key, ',') FROM jsonb_each(to_jsonb(t)) WHERE value IS NOT NULL AND value <> 'null'::jsonb AND value <> '""'::jsonb
         AND key NOT IN ('customer_name', 'note', 'phone', 'customer_phone'));
    RAISE NOTICE 'P3 txn payment fields | %', (SELECT jsonb_object_agg(key, value) FROM jsonb_each(to_jsonb(t))
       WHERE key ~* '(pay|method|channel|coupon|cashback|wallet|paystack|source|paid)');
  END IF;
  BEGIN
    RAISE NOTICE 'P4 coupons used with it: %', (SELECT count(*) FROM public.bill_coupons c WHERE to_jsonb(c)::text LIKE '%' || v_ref || '%');
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'P4 (no bill_coupons: %)', SQLERRM; END;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
