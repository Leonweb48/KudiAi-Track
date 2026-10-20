-- READ-ONLY (2026-10-20): recent airtime RequestIDs whose wallet charge was settled as delivered (bill_spend completed)
-- — known-good ids to compare the ClubKonnect lookup against. References and dates only.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT a.request_id, a.created_at, l.status
             FROM public.bill_provider_attempts a
             JOIN public.wallet_ledger l ON l.reference = a.request_id AND l.source = 'bill_spend'
            WHERE a.service = 'airtime' AND a.providers = ARRAY['clubkonnect']::text[] AND l.status = 'completed'
              AND a.created_at > now() - interval '14 days'
            ORDER BY a.created_at DESC LIMIT 3 LOOP
    RAISE NOTICE 'G1 known-good airtime | % | %', r.request_id, r.created_at;
  END LOOP;
  RAISE NOTICE 'G2 airtime attempts (14 days) by charge status: %',
    (SELECT string_agg(s || '=' || n, ', ') FROM (
       SELECT coalesce(l.status, 'no-charge') s, count(*) n FROM public.bill_provider_attempts a
         LEFT JOIN public.wallet_ledger l ON l.reference = a.request_id AND l.source = 'bill_spend'
        WHERE a.service = 'airtime' AND a.created_at > now() - interval '14 days' GROUP BY 1) x);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
