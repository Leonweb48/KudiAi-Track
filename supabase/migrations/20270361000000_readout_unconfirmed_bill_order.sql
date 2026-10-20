-- READ-ONLY (2026-10-20): the "BILLING UNCONFIRMED" alert for KDT-BILL-1792484501202 (Airtime ₦300). What did we
-- record — the bill transaction, any wallet charge with that reference, the provider attempt — and has the stuck-charge
-- sweep already settled it? Statuses and amounts only. No writes.
DO $$
DECLARE r record; v_ref constant text := 'KDT-BILL-1792484501202';
BEGIN
  BEGIN
    FOR r IN SELECT t.bill_status, t.amount, t.payment_type, t.category, t.created_at,
                    (t.note ILIKE '%PENDING CONFIRMATION%') AS hold_note, (t.note ILIKE '%wallet%') AS wallet_note
               FROM public.transactions t WHERE t.note LIKE '%' || v_ref || '%' ORDER BY t.created_at LOOP
      RAISE NOTICE 'B1 txn | bill_status=% amount=% type=% cat=% at=% hold_note=% wallet_note=%',
        r.bill_status, r.amount, r.payment_type, r.category, r.created_at, r.hold_note, r.wallet_note;
    END LOOP;
    RAISE NOTICE 'B1 txn rows: %', (SELECT count(*) FROM public.transactions t WHERE t.note LIKE '%' || v_ref || '%');
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'B1 failed: %', SQLERRM; END;

  BEGIN
    FOR r IN SELECT l.source, l.direction, l.status, l.amount_kobo, l.created_at
               FROM public.wallet_ledger l WHERE l.reference = v_ref OR l.flw_reference = v_ref OR l.reference LIKE v_ref || '%'
              ORDER BY l.created_at LOOP
      RAISE NOTICE 'B2 ledger | source=% dir=% status=% kobo=% at=%', r.source, r.direction, r.status, r.amount_kobo, r.created_at;
    END LOOP;
    RAISE NOTICE 'B2 ledger rows: %', (SELECT count(*) FROM public.wallet_ledger l WHERE l.reference = v_ref OR l.flw_reference = v_ref OR l.reference LIKE v_ref || '%');
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'B2 failed: %', SQLERRM; END;

  BEGIN
    RAISE NOTICE 'B3 provider attempt rows: %',
      (SELECT count(*) FROM public.bill_provider_attempts a WHERE row_to_json(a)::text LIKE '%' || v_ref || '%');
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'B3 failed: %', SQLERRM; END;

  BEGIN
    RAISE NOTICE 'B4 support tickets: % (open %)',
      (SELECT count(*) FROM public.support_tickets s WHERE s.description LIKE '%' || v_ref || '%'),
      (SELECT count(*) FROM public.support_tickets s WHERE s.description LIKE '%' || v_ref || '%' AND s.status = 'open');
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'B4 failed: %', SQLERRM; END;
END $$;
