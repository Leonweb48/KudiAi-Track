-- READ-ONLY (2026-10-21): were the three bills that failed today (no order at ClubKonnect for any of them) given back?
-- For each reference: the wallet ledger lines that carry it (source, status, amount, direction) and the bill record's
-- status. Amounts of money only; no names, numbers or balances. No writes.
DO $$
DECLARE r record; ref text;
BEGIN
  FOREACH ref IN ARRAY ARRAY['KDT-BILL-1792595084809', 'KDT-BILL-1792597807419', 'KDT-BILL-1792598059958'] LOOP
    BEGIN
      FOR r IN
        SELECT l.created_at, l.source, l.status, l.amount_kobo, l.direction
          FROM public.wallet_ledger l
         WHERE l.reference = ref OR l.reference LIKE ref || '%' OR coalesce(l.meta::text, '') LIKE '%' || ref || '%'
         ORDER BY l.created_at LOOP
        RAISE NOTICE 'R1 % | % | % | % | ₦% | %', ref, to_char(r.created_at AT TIME ZONE 'Africa/Lagos', 'HH24:MI'),
          r.source, r.status, r.amount_kobo / 100.0, r.direction;
      END LOOP;
      RAISE NOTICE 'R2 % | ledger lines: % | bill: %', ref,
        (SELECT count(*) FROM public.wallet_ledger l WHERE l.reference = ref OR l.reference LIKE ref || '%' OR coalesce(l.meta::text, '') LIKE '%' || ref || '%'),
        (SELECT string_agg(coalesce(t.bill_status, 'null') || '/' || coalesce(t.payment_type, '-'), ',') FROM public.transactions t WHERE t.note LIKE '%' || ref || '%');
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'R % failed: %', ref, SQLERRM; END;
  END LOOP;
END $$;
