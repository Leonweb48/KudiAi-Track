-- READ-ONLY (2026-10-23): before adding VAT, check that bank-transfer fees are actually being charged. Since 21 Oct no plan
-- has free transfers, so every successful bank transfer should have a 'transfer_fee' debit. Also: the live text of
-- wallet_transfer_sent's status guard, and the status new transfers are created with. Counts only. No writes.
DO $$
DECLARE r record; def text;
BEGIN
  FOR r IN
    SELECT public.wallet_fee_tier(w.user_id) AS tier, w.status,
           (EXISTS (SELECT 1 FROM public.wallet_ledger f WHERE f.related_txn_id = w.id AND f.source = 'transfer_fee' AND f.direction = 'debit')) AS fee,
           count(*) AS n
      FROM public.wallet_withdrawals w
     WHERE w.created_at >= '2026-10-21 12:00+01'
     GROUP BY 1, 2, 3 ORDER BY 1, 2, 3 LOOP
    RAISE NOTICE 'T1 tier=% | status=% | fee charged=% | n=%', r.tier, r.status, r.fee, r.n;
  END LOOP;
  def := pg_get_functiondef('public.wallet_transfer_sent(uuid,text,bigint)'::regprocedure);
  RAISE NOTICE 'T2 wallet_transfer_sent guard: %', coalesce(substring(def FROM 'status *= *''[a-z]+'''), '(no status guard found)');
  RAISE NOTICE 'T3 hold creates status: %', coalesce(substring(pg_get_functiondef('public.wallet_hold_transfer(bigint,text,text,text,text,boolean)'::regprocedure) FROM '''(pending|processing)'''), '?');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
