-- READ-ONLY (2026-10-22): did the sweep deliver the token of KDT-BILL-1792660952671 (₦1,000 AEDC prepaid, Bigisub
-- successful, app left it at PENDING CONFIRMATION)? Status, whether a token is now on the order (never the token), how it
-- was found, and the wallet charge's state. No writes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT t.bill_status, (t.bill_details ? 'token') AS has_token, t.bill_details->>'token_found_by' AS found_by,
                  left(regexp_replace(coalesce(t.note, ''), '\d+(\d{4})', '…\1', 'g'), 120) AS note_m,
                  (SELECT string_agg(l.status, ',') FROM public.wallet_ledger l WHERE l.reference = 'KDT-BILL-1792660952671' AND l.source = 'bill_spend') AS charge
             FROM public.transactions t
            WHERE t.payment_type = 'bill_payment' AND t.category = 'electricity' AND t.note LIKE '%KDT-BILL-1792660952671%' LOOP
    RAISE NOTICE 'T1 bill=% | token on order=% | found_by=% | charge=% | note=%', r.bill_status, r.has_token, coalesce(r.found_by, '-'), coalesce(r.charge, '-'), r.note_m;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
