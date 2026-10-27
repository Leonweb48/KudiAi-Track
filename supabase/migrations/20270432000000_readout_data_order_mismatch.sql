-- READ-ONLY (2026-10-27): the owner's test bought "500MB weekly" on ClubKonnect and the number received 2.5GB daily (₦750).
-- Today's data orders: our reference, what the app sold (item, plan id, amount), status, and our note — every run of 5+
-- digits masked (phone numbers). Then what each order's cost record says. No writes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT t.created_at, t.amount, t.bill_status, t.item_name, t.bill_details,
           regexp_replace(COALESCE(t.note, ''), '\d{5,}', '#', 'g') AS note_m,
           (SELECT l.reference FROM public.wallet_ledger l WHERE l.related_txn_id = t.id AND l.source = 'bill_spend' LIMIT 1) AS ref
      FROM public.transactions t
     WHERE t.payment_type = 'bill_payment' AND t.category = 'data' AND t.created_at > now() - interval '30 hours'
     ORDER BY t.created_at DESC LIMIT 6 LOOP
    RAISE NOTICE 'DM order | % | ref=% | ₦% | % | item=% | plan=% planName=% net=% | note=%',
      to_char(r.created_at AT TIME ZONE 'Africa/Lagos', 'DD Mon HH24:MI'), COALESCE(r.ref, '?'), r.amount, r.bill_status, r.item_name,
      r.bill_details ->> 'planId', r.bill_details ->> 'planName', r.bill_details ->> 'network', left(r.note_m, 160);
  END LOOP;
  FOR r IN
    SELECT occurred_at, reference, amount_kobo, meta ->> 'provider' AS provider, meta ->> 'basis' AS basis, meta -> 'ck_fields' AS f
      FROM public.finance_entries
     WHERE line_code = 'bills.provider_cost' AND source_type = 'bill_cost' AND category = 'data' AND occurred_at > now() - interval '30 hours'
     ORDER BY occurred_at DESC LIMIT 6 LOOP
    RAISE NOTICE 'DM cost | % | ref=% | cost ₦% | provider=% basis=% | fields=%', to_char(r.occurred_at AT TIME ZONE 'Africa/Lagos', 'DD Mon HH24:MI'),
      r.reference, -r.amount_kobo / 100.0, COALESCE(r.provider, 'clubkonnect'), r.basis, r.f;
  END LOOP;
END $$;
