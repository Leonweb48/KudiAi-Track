-- READ-ONLY (2026-10-12): client-portal bills — was the money right? (1) client wallets' bill charges since 20 Sept by
-- status (a charge left 'pending' = held, never settled or refunded), linked to a bill or not; (2) each FAILED
-- client bill: when, the error (digits masked), and what happened to the charge. Counts, statuses and times only.
DO $$
DECLARE r record; v_ref text;
BEGIN
  FOR r IN
    SELECT l.source, l.status, (l.related_txn_id IS NOT NULL) AS linked, count(*) AS n,
           to_char(min(l.created_at) AT TIME ZONE 'Africa/Lagos', 'MM-DD') AS first, to_char(max(l.created_at) AT TIME ZONE 'Africa/Lagos', 'MM-DD') AS last
      FROM public.wallet_ledger l JOIN public.wallets w ON w.id = l.wallet_id
     WHERE w.user_id IN (SELECT client_user_id FROM public.aso_clients WHERE client_user_id IS NOT NULL)
       AND l.source IN ('bill_spend', 'bill_reversal') AND l.created_at > '2026-09-20'
     GROUP BY 1, 2, 3 ORDER BY 1, 2, 3
  LOOP
    RAISE NOTICE 'C1 % % linked_to_bill=% n=% (% → %)', r.source, r.status, r.linked, r.n, r.first, r.last;
  END LOOP;

  FOR r IN
    SELECT t.created_at, t.category, t.note FROM public.transactions t
     WHERE t.payment_type = 'bill_payment' AND t.bill_status = 'failed' AND t.created_at > '2026-09-20'
       AND t.user_id IN (SELECT client_user_id FROM public.aso_clients WHERE client_user_id IS NOT NULL)
     ORDER BY t.created_at
  LOOP
    v_ref := substring(r.note FROM 'PS: ([A-Za-z0-9_-]+)');
    RAISE NOTICE 'C2 % WAT % | % | charge: %', to_char(r.created_at AT TIME ZONE 'Africa/Lagos', 'MM-DD HH24:MI'), r.category,
      left(regexp_replace(split_part(coalesce(r.note, ''), '| PS:', 1), '[0-9]', '#', 'g'), 70),
      (SELECT coalesce(string_agg(source || '/' || status, ',' ORDER BY created_at), 'none') FROM public.wallet_ledger WHERE reference = v_ref);
  END LOOP;

  -- a pending bill charge older than an hour is money held from a client with nothing to show for it
  RAISE NOTICE 'C3 client bill charges still pending after 1 hour: %', (
    SELECT count(*) FROM public.wallet_ledger l JOIN public.wallets w ON w.id = l.wallet_id
     WHERE w.user_id IN (SELECT client_user_id FROM public.aso_clients WHERE client_user_id IS NOT NULL)
       AND l.source = 'bill_spend' AND l.status = 'pending' AND l.created_at < now() - interval '1 hour');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
