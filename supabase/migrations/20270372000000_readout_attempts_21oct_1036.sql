-- READ-ONLY (2026-10-21): RequestIDs of airtime orders sent around 10:36 UTC on 21 Oct (the …5002 ₦200 airtime that
-- wasn't wallet-paid), and how that bill was paid. References and times only. No writes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT a.request_id, a.service, a.providers::text p, a.created_at FROM public.bill_provider_attempts a
            WHERE a.created_at BETWEEN '2026-10-21 10:30+00' AND '2026-10-21 10:40+00' ORDER BY a.created_at LOOP
    RAISE NOTICE 'T1 % | % | % | %', to_char(r.created_at, 'HH24:MI:SS'), r.request_id, r.service, r.p;
  END LOOP;
  FOR r IN SELECT t.created_at, left(regexp_replace(t.note, '[0-9]{7,}', '…', 'g'), 160) AS note_masked
             FROM public.transactions t
            WHERE t.payment_type = 'bill_payment' AND t.created_at BETWEEN '2026-10-21 10:35+00' AND '2026-10-21 10:38+00' LOOP
    RAISE NOTICE 'T2 % | note: %', to_char(r.created_at, 'HH24:MI:SS'), r.note_masked;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
