-- READ-ONLY (2026-10-21): a client's ₦200 airtime "shows successful but was never delivered". Recent airtime wallet
-- charges of ₦200 (any wallet) with their RequestID, charge status, who paid (client / business) and the provider record,
-- so each can be checked with ClubKonnect. References, statuses, times only — no phone numbers. No writes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT l.reference, l.status, l.created_at, public.wallet_fee_tier(l.user_id) AS tier,
           (SELECT a.providers::text FROM public.bill_provider_attempts a WHERE a.request_id = l.reference) AS providers,
           (SELECT a.service FROM public.bill_provider_attempts a WHERE a.request_id = l.reference) AS service
      FROM public.wallet_ledger l
     WHERE l.source = 'bill_spend' AND l.direction = 'debit' AND l.amount_kobo = 20000
       AND l.created_at > now() - interval '5 days'
     ORDER BY l.created_at DESC LIMIT 15 LOOP
    RAISE NOTICE 'R1 % | % | charge=% | wallet=% | svc=% | providers=%', r.created_at, r.reference, r.status, r.tier, r.service, r.providers;
  END LOOP;
  -- the same from the client portal's own bill records, if it keeps them separately
  BEGIN
    FOR r IN SELECT created_at, status, amount, coalesce(reference, '') AS ref FROM public.client_bill_payments
              WHERE amount = 200 AND created_at > now() - interval '5 days' ORDER BY created_at DESC LIMIT 10 LOOP
      RAISE NOTICE 'R2 client bill | % | % | ₦% | %', r.created_at, r.status, r.amount, r.ref;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'R2 (no client_bill_payments table: %)', SQLERRM; END;
  RAISE NOTICE 'R3 airtime charges last 5 days by status: %',
    (SELECT string_agg(status || '=' || n, ', ') FROM (SELECT l.status, count(*) n FROM public.wallet_ledger l
      JOIN public.bill_provider_attempts a ON a.request_id = l.reference AND a.service = 'airtime'
      WHERE l.source = 'bill_spend' AND l.created_at > now() - interval '5 days' GROUP BY 1) x);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
