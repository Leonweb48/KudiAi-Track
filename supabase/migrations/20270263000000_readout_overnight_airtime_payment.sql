-- READ-ONLY diagnostic (2026-10-02), follow-up to 20270262: the refused overnight airtime had a KDT-BILL reference but no
-- wallet ledger row with it and no card intent. What did that user's wallet / cashback / coupons do around it, and what do
-- the admin task + ticket say? Sources, statuses, directions and titles only (digits masked) — no amounts, references,
-- numbers or names (CI logs are public). No writes.
DO $$
DECLARE t record; r record;
BEGIN
  SELECT id, user_id, created_at INTO t FROM public.transactions
   WHERE payment_type = 'bill_payment' AND bill_status = 'failed' AND note ~ 'INVALID_CREDENTIALS'
     AND created_at > '2026-10-01 20:30:00+00' ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RAISE NOTICE 'Y0 none'; RETURN; END IF;

  RAISE NOTICE '== Y1. that user''s wallet ledger rows, 30 min either side (min:sec relative to the failure)';
  FOR r IN
    SELECT round(extract(epoch FROM (l.created_at - t.created_at)))::int AS dt_s, l.direction, l.source, l.status,
           (l.reference LIKE 'KDT-BILL-%') AS kdt_ref, (l.related_txn_id IS NOT NULL) AS linked,
           left(regexp_replace(coalesce(l.narration, ''), '\d{4,}', '#', 'g'), 90) AS narr
      FROM public.wallet_ledger l
     WHERE l.user_id = t.user_id AND l.created_at BETWEEN t.created_at - interval '30 minutes' AND t.created_at + interval '30 minutes'
     ORDER BY l.created_at
  LOOP
    RAISE NOTICE 'Y1 dt=%s % % % kdt_ref=% linked=% narr=%', r.dt_s, r.direction, r.source, r.status, r.kdt_ref, r.linked, r.narr;
  END LOOP;

  RAISE NOTICE '== Y2. that user''s bill transactions, 30 min either side';
  FOR r IN
    SELECT round(extract(epoch FROM (x.created_at - t.created_at)))::int AS dt_s, x.category, x.bill_status,
           left(regexp_replace(coalesce(x.note, ''), '\d{4,}', '#', 'g'), 120) AS note
      FROM public.transactions x
     WHERE x.user_id = t.user_id AND x.payment_type = 'bill_payment'
       AND x.created_at BETWEEN t.created_at - interval '30 minutes' AND t.created_at + interval '30 minutes'
     ORDER BY x.created_at
  LOOP
    RAISE NOTICE 'Y2 dt=%s % % note=%', r.dt_s, r.category, r.bill_status, r.note;
  END LOOP;

  RAISE NOTICE '== Y3. admin task + ticket titles at that time';
  FOR r IN SELECT 'task' AS k, left(regexp_replace(title, '\d{4,}', '#', 'g'), 100) AS ttl, status FROM public.admin_tasks
            WHERE created_at BETWEEN t.created_at - interval '10 minutes' AND t.created_at + interval '30 minutes'
  LOOP RAISE NOTICE 'Y3 % [%] %', r.k, r.status, r.ttl; END LOOP;
  FOR r IN SELECT 'ticket' AS k, left(regexp_replace(coalesce(subject, ''), '\d{4,}', '#', 'g'), 100) AS ttl, status FROM public.support_tickets
            WHERE created_at BETWEEN t.created_at - interval '10 minutes' AND t.created_at + interval '30 minutes'
  LOOP RAISE NOTICE 'Y3 % [%] %', r.k, r.status, r.ttl; END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
