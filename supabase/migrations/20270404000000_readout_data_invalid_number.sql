-- READ-ONLY (2026-10-23, night): after the PRODUCT_CODE fix, real data orders come back INVALID_MOBILE_NUMBER.
-- Data AND airtime bills of the last 3 hours: time, status, amount, our note (every digit run of 5+ masked), and the
-- phone's shape only — length and first 4 digits (the network prefix) — from wherever it is stored. No full numbers,
-- no names, no balances. No writes.
DO $$
DECLARE r record; ph text;
BEGIN
  FOR r IN
    SELECT t.created_at, t.category, t.amount, t.bill_status, t.bill_details, to_jsonb(t) AS tj,
           regexp_replace(regexp_replace(coalesce(t.note, ''), 'KDT-BILL-[0-9]+', 'REF', 'g'), '\d{5,}', '#', 'g') AS note_m
      FROM public.transactions t
     WHERE t.payment_type = 'bill_payment' AND t.category IN ('data', 'airtime') AND t.created_at > now() - interval '3 hours'
     ORDER BY t.created_at LOOP
    ph := coalesce(r.bill_details->>'phone', r.bill_details->>'recipient', r.bill_details->>'mobile', r.tj->>'recipient',
                   r.tj->>'phone', r.tj->>'customer_phone', r.tj->>'beneficiary', '');
    ph := regexp_replace(ph, '\D', '', 'g');
    RAISE NOTICE 'G1 % | % | % | ₦% | phone len=% starts=% | note=%', to_char(r.created_at AT TIME ZONE 'Africa/Lagos', 'HH24:MI'),
      r.category, r.bill_status, r.amount, length(ph), left(ph, 4), left(r.note_m, 200);
  END LOOP;
  RAISE NOTICE 'G2 transaction columns with phone-like names: %', (SELECT string_agg(column_name, ',') FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name ~* '(phone|recipient|mobile|beneficiary|customer)');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
