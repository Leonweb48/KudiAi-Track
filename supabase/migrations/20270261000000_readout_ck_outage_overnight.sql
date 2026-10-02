-- READ-ONLY diagnostic (2026-10-02): ClubKonnect rejected our (unchanged) key from ~20:59 UTC on 1 Oct until it accepted
-- it again on the morning of 2 Oct. Were customers refused in that window, were the wallet payments refunded, and is any
-- order still held? Counts and times only (CI logs are public). No writes.
DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE '== O1. bills since 1 Oct 20:30 UTC, by category';
  FOR r IN
    SELECT coalesce(category, '?') AS cat, count(*) AS n,
           count(*) FILTER (WHERE bill_status IN ('success', 'completed')) AS ok,
           count(*) FILTER (WHERE bill_status = 'failed') AS failed,
           count(*) FILTER (WHERE bill_status = 'pending') AS pending,
           to_char(min(created_at) FILTER (WHERE bill_status = 'failed'), 'MM-DD HH24:MI') AS first_fail,
           to_char(max(created_at) FILTER (WHERE bill_status = 'failed'), 'MM-DD HH24:MI') AS last_fail,
           to_char(min(created_at) FILTER (WHERE bill_status IN ('success', 'completed')), 'MM-DD HH24:MI') AS first_ok
      FROM public.transactions
     WHERE payment_type = 'bill_payment' AND created_at > '2026-10-01 20:30:00+00'
     GROUP BY 1 ORDER BY n DESC
  LOOP
    RAISE NOTICE 'O1 % n=% ok=% failed=% pending=% first_fail=% last_fail=% first_ok=%', r.cat, r.n, r.ok, r.failed, r.pending, r.first_fail, r.last_fail, r.first_ok;
  END LOOP;

  RAISE NOTICE '== O2. failure reasons in the window (4+ digit runs masked)';
  FOR r IN
    SELECT left(regexp_replace(coalesce(nullif(split_part(split_part(note, 'FAILED: ', 2), ' | PS:', 1), ''), '(no reason)'), '\d{4,}', '#', 'g'), 120) AS why, count(*) AS n
      FROM public.transactions
     WHERE payment_type = 'bill_payment' AND bill_status = 'failed' AND created_at > '2026-10-01 20:30:00+00'
     GROUP BY 1 ORDER BY n DESC
  LOOP
    RAISE NOTICE 'O2 n=% why=%', r.n, r.why;
  END LOOP;

  RAISE NOTICE '== O3. failed bills in the window paid from the wallet: debit reversed?';
  SELECT count(*) AS n,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.wallet_ledger l WHERE l.source = 'bill_spend' AND l.status = 'reversed'
                 AND (l.related_txn_id = t.id OR l.reference = substring(t.note FROM 'PS: (KDT-BILL-[A-Za-z0-9]+)')))) AS reversed,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.wallet_ledger l WHERE l.source = 'bill_spend' AND l.status <> 'reversed'
                 AND (l.related_txn_id = t.id OR l.reference = substring(t.note FROM 'PS: (KDT-BILL-[A-Za-z0-9]+)')))) AS still_debited
    INTO r
    FROM public.transactions t
   WHERE t.payment_type = 'bill_payment' AND t.bill_status = 'failed' AND t.created_at > '2026-10-01 20:30:00+00';
  RAISE NOTICE 'O3 failed=% wallet_reversed=% wallet_still_debited=%', r.n, r.reversed, r.still_debited;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
