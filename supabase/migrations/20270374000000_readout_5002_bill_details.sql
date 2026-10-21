-- READ-ONLY (2026-10-21): the bill_details of the undelivered ₦200 airtime (21 Oct 10:36 UTC) — keys, and the values of
-- payment-related keys only (no phone/recipient). No writes.
DO $$
DECLARE t record;
BEGIN
  SELECT bill_details INTO t FROM public.transactions WHERE payment_type = 'bill_payment'
     AND created_at BETWEEN '2026-10-21 10:36+00' AND '2026-10-21 10:38+00' LIMIT 1;
  RAISE NOTICE 'BD keys: %', (SELECT string_agg(k, ',') FROM jsonb_object_keys(to_jsonb(t.bill_details)) k);
  RAISE NOTICE 'BD pay: %', (SELECT jsonb_object_agg(key, value) FROM jsonb_each(to_jsonb(t.bill_details))
     WHERE key ~* '(pay|via|method|channel|coupon|cashback|wallet|paystack|source|fee|price|cost|amount|status|provider)');
  RAISE NOTICE 'BD paystack/coupon tables: paystack refs=%', (SELECT count(*) FROM public.transactions WHERE note LIKE '%KDT-BILL-1792579001994%');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
