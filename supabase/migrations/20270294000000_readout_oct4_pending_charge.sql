-- READ-ONLY (2026-10-12): the client bill charge left 'pending' on 4 Oct ~15:48 WAT that ClubKonnect has no order for.
-- Was the 15:49 data bill paid by a DIFFERENT charge (→ this one is an orphan: money held for nothing) or by this one?
-- Shows that client's wallet activity 15:30–16:30 WAT that day: minute, source/status, and whether each row's amount
-- equals the pending charge's amount — no amounts, references or names. No writes.
DO $$
DECLARE p record; r record;
BEGIN
  SELECT l.* INTO p FROM public.wallet_ledger l JOIN public.wallets w ON w.id = l.wallet_id
   WHERE w.user_id IN (SELECT client_user_id FROM public.aso_clients WHERE client_user_id IS NOT NULL)
     AND l.source = 'bill_spend' AND l.status = 'pending'
     AND l.created_at BETWEEN '2026-10-04 14:40:00+00' AND '2026-10-04 15:00:00+00'
   LIMIT 1;
  IF NOT FOUND THEN RAISE NOTICE 'P0 no such pending charge'; RETURN; END IF;
  RAISE NOTICE 'P0 pending charge at % WAT, narration words: %', to_char(p.created_at AT TIME ZONE 'Africa/Lagos', 'HH24:MI:SS'),
    left(regexp_replace(coalesce(p.narration, ''), '[0-9]', '#', 'g'), 60);
  FOR r IN
    SELECT created_at, source, status, direction, (amount_kobo = p.amount_kobo) AS same_amount, (reference = p.reference) AS same_ref
      FROM public.wallet_ledger WHERE wallet_id = p.wallet_id
       AND created_at BETWEEN '2026-10-04 14:30:00+00' AND '2026-10-04 15:30:00+00' ORDER BY created_at
  LOOP
    RAISE NOTICE 'P1 % WAT % %/% same_amount=% same_ref=%', to_char(r.created_at AT TIME ZONE 'Africa/Lagos', 'HH24:MI:SS'),
      r.direction, r.source, r.status, r.same_amount, r.same_ref;
  END LOOP;
  FOR r IN
    SELECT created_at, category, bill_status, (amount * 100 = p.amount_kobo) AS same_amount
      FROM public.transactions WHERE user_id = p.user_id AND payment_type = 'bill_payment'
       AND created_at BETWEEN '2026-10-04 14:30:00+00' AND '2026-10-04 15:30:00+00' ORDER BY created_at
  LOOP
    RAISE NOTICE 'P2 bill % WAT % % same_amount=%', to_char(r.created_at AT TIME ZONE 'Africa/Lagos', 'HH24:MI:SS'), r.category, r.bill_status, r.same_amount;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
