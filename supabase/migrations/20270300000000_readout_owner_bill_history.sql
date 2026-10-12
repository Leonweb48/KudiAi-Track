-- READ-ONLY (2026-10-12): owner-portal bill history. (1) The app loads an owner's transactions in ONE request, and the
-- API returns at most 1000 rows — how many owners have more (older rows silently missing in the app)? (2) Business
-- (non-client) bills since 20 Sept by category/status, and how many kept their details. Counts only. No writes.
DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE 'O1 owners with > 1000 transactions: % | > 800: % | largest: %',
    (SELECT count(*) FROM (SELECT user_id FROM public.transactions GROUP BY user_id HAVING count(*) > 1000) x),
    (SELECT count(*) FROM (SELECT user_id FROM public.transactions GROUP BY user_id HAVING count(*) > 800) x),
    (SELECT max(n) FROM (SELECT count(*) n FROM public.transactions GROUP BY user_id) x);
  FOR r IN
    SELECT t.category, coalesce(t.bill_status, '?') st, count(*) n, count(*) FILTER (WHERE t.bill_details IS NOT NULL) with_details
      FROM public.transactions t
     WHERE t.payment_type = 'bill_payment' AND t.created_at > '2026-09-20'
       AND t.user_id NOT IN (SELECT client_user_id FROM public.aso_clients WHERE client_user_id IS NOT NULL)
     GROUP BY 1, 2 ORDER BY 1, 2
  LOOP
    RAISE NOTICE 'O2 business bills: % % = % (with details %)', r.category, r.st, r.n, r.with_details;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
