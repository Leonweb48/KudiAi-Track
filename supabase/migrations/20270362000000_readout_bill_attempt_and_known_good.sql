-- READ-ONLY (2026-10-20): reconciling KDT-BILL-1792484501202 (Airtime ₦300, ClubKonnect lookup says
-- TRANSACTION_BEYOND_30_DAYS). (1) Our provider-attempt record for it, without recipient / phone / token fields.
-- (2) The newest airtime orders recorded as delivered, so the lookup can be compared on a known-good RequestID.
DO $$
DECLARE r record; j jsonb; k text;
BEGIN
  BEGIN
    FOR r IN SELECT to_jsonb(a) AS j FROM public.bill_provider_attempts a WHERE to_jsonb(a)::text LIKE '%KDT-BILL-1792484501202%' LOOP
      j := r.j;
      FOR k IN SELECT jsonb_object_keys(j) LOOP
        IF k ~* '(phone|recipient|mobile|number|customer|meter|token|pin|card|name|email|user)' THEN j := j - k; END IF;
      END LOOP;
      RAISE NOTICE 'A1 attempt | %', left(j::text, 600);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'A1 failed: %', SQLERRM; END;

  BEGIN
    FOR r IN SELECT substring(t.note FROM '(KDT-BILL-[0-9]+)') AS ref, t.bill_status, t.amount, t.created_at
               FROM public.transactions t
              WHERE t.category = 'airtime' AND t.payment_type = 'bill_payment' AND t.bill_status IN ('success', 'delivered', 'completed')
                AND t.note ~ 'KDT-BILL-[0-9]+' AND t.created_at > now() - interval '10 days'
              ORDER BY t.created_at DESC LIMIT 3 LOOP
      RAISE NOTICE 'A2 known-good | ref=% status=% amount=% at=%', r.ref, r.bill_status, r.amount, r.created_at;
    END LOOP;
    RAISE NOTICE 'A2 bill_status values seen (airtime, 10 days): %',
      (SELECT string_agg(DISTINCT coalesce(bill_status, 'null'), ',') FROM public.transactions
        WHERE category = 'airtime' AND payment_type = 'bill_payment' AND created_at > now() - interval '10 days');
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'A2 failed: %', SQLERRM; END;
END $$;
