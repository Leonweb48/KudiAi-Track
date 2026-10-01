-- READ-ONLY diagnostic (2026-10-01 evening): ClubKonnect rejected our API key again (route-check 21:23 UTC: all 11 services
-- INVALID_APICREDENTIALS, direct and via the relay; a lookup at 18:08 UTC still worked). Did any customer try to buy a bill
-- since, and were the refused ones refunded? Counts and times only — no notes, references, numbers or names (CI logs are
-- public). No writes.
DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE '== K1. bill outcomes since 17:00 UTC, by category';
  FOR r IN
    SELECT coalesce(category, '?') AS cat, count(*) AS n,
           count(*) FILTER (WHERE bill_status IN ('success', 'completed')) AS ok,
           count(*) FILTER (WHERE bill_status = 'failed') AS failed,
           count(*) FILTER (WHERE bill_status = 'failed' AND note ~* 'CREDENTIAL') AS failed_key,
           count(*) FILTER (WHERE bill_status = 'pending') AS pending
      FROM public.transactions
     WHERE payment_type = 'bill_payment' AND created_at > '2026-10-01 17:00:00+00'
     GROUP BY 1 ORDER BY n DESC
  LOOP
    RAISE NOTICE 'K1 % n=% ok=% failed=% failed_key=% pending=%', r.cat, r.n, r.ok, r.failed, r.failed_key, r.pending;
  END LOOP;

  RAISE NOTICE '== K2. last successful bill, first key-refused bill (UTC)';
  SELECT to_char(max(created_at) FILTER (WHERE bill_status IN ('success', 'completed')), 'MM-DD HH24:MI') AS last_ok,
         to_char(min(created_at) FILTER (WHERE bill_status = 'failed' AND note ~* 'CREDENTIAL'), 'MM-DD HH24:MI') AS first_key,
         to_char(max(created_at) FILTER (WHERE bill_status = 'failed' AND note ~* 'CREDENTIAL'), 'MM-DD HH24:MI') AS last_key
    INTO r
    FROM public.transactions
   WHERE payment_type = 'bill_payment' AND created_at > now() - interval '2 days';
  RAISE NOTICE 'K2 last_ok=% first_key_refused=% last_key_refused=%', r.last_ok, r.first_key, r.last_key;

  RAISE NOTICE '== K3. key-refused bills since 17:00 UTC: was the wallet debit reversed?';
  SELECT count(*) AS n,
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM public.wallet_ledger l
            WHERE l.source = 'bill_spend' AND l.status = 'reversed'
              AND (l.related_txn_id = t.id OR l.reference = substring(t.note FROM 'PS: (KDT-BILL-[A-Za-z0-9]+)')))) AS wallet_reversed,
         count(*) FILTER (WHERE NOT EXISTS (
           SELECT 1 FROM public.wallet_ledger l
            WHERE l.source = 'bill_spend'
              AND (l.related_txn_id = t.id OR l.reference = substring(t.note FROM 'PS: (KDT-BILL-[A-Za-z0-9]+)')))) AS no_wallet_debit
    INTO r
    FROM public.transactions t
   WHERE t.payment_type = 'bill_payment' AND t.bill_status = 'failed' AND t.note ~* 'CREDENTIAL'
     AND t.created_at > '2026-10-01 17:00:00+00';
  RAISE NOTICE 'K3 key_refused=% wallet_reversed=% not_wallet_paid=%', r.n, r.wallet_reversed, r.no_wallet_debit;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
