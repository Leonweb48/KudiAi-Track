-- READ-ONLY (2026-10-21): "bill payments show successful but were not delivered" (a ₦200 and a ₦400 airtime, and more
-- yesterday). Every airtime / data wallet charge since 18 Oct with its RequestID, amount, charge status and wallet kind,
-- to re-check each with ClubKonnect. References, amounts, statuses only. No writes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT l.reference, l.amount_kobo / 100 AS naira, l.status, l.created_at, a.service, public.wallet_fee_tier(l.user_id) AS tier
      FROM public.wallet_ledger l JOIN public.bill_provider_attempts a ON a.request_id = l.reference
     WHERE l.source = 'bill_spend' AND l.direction = 'debit' AND a.service IN ('airtime', 'data')
       AND l.created_at >= '2026-10-18'
     ORDER BY l.created_at LOOP
    RAISE NOTICE 'D1 % | % | % | ₦% | charge=% | %', to_char(r.created_at, 'MM-DD HH24:MI'), r.reference, r.service, r.naira, r.status, r.tier;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
