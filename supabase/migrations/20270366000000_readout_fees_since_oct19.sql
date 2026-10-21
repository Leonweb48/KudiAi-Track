-- READ-ONLY (2026-10-21): owner reports owners "are charged on the deposit instead of transfer". Every fee line since
-- 19 Oct by wallet kind (business / personal) and fee source, what each deposit fee was taken on, and whether
-- business bank transfers / wallet moves were charged. Counts and totals only. No writes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT CASE WHEN public.wallet_fee_tier(l.user_id) = 'personal' THEN 'personal' ELSE 'business:' || public.wallet_fee_tier(l.user_id) END AS kind,
           l.source, count(*) n, sum(l.amount_kobo) / 100.0 naira, min(l.amount_kobo) / 100.0 lo, max(l.amount_kobo) / 100.0 hi
      FROM public.wallet_ledger l
     WHERE l.created_at >= '2026-10-19' AND l.direction = 'debit' AND l.status IN ('completed', 'pending')
       AND l.source IN ('deposit_fee', 'transfer_fee', 'wallet_fee', 'cbn_levy')
       AND l.user_id <> '00000000-0000-0000-0000-000000000001'
     GROUP BY 1, 2 ORDER BY 1, 2 LOOP
    RAISE NOTICE 'F1 % | % | n=% total=₦% (₦%–₦%)', r.kind, r.source, r.n, r.naira, r.lo, r.hi;
  END LOOP;

  -- what money each deposit fee was taken on (related ledger line's source)
  FOR r IN
    SELECT coalesce(d.source, 'no-link') AS dep_source, count(*) n, sum(f.amount_kobo) / 100.0 fee, sum(d.amount_kobo) / 100.0 deposits
      FROM public.wallet_ledger f LEFT JOIN public.wallet_ledger d ON d.id = f.related_txn_id
     WHERE f.source = 'deposit_fee' AND f.created_at >= '2026-10-19'
     GROUP BY 1 ORDER BY 1 LOOP
    RAISE NOTICE 'F2 deposit fee taken on % | n=% fees=₦% on deposits=₦%', r.dep_source, r.n, r.fee, r.deposits;
  END LOOP;

  -- business money movement since 19 Oct and how much of it carried a fee
  FOR r IN
    SELECT l.source, l.direction, count(*) n, sum(l.amount_kobo) / 100.0 naira
      FROM public.wallet_ledger l
     WHERE l.created_at >= '2026-10-19' AND l.status = 'completed' AND public.wallet_fee_tier(l.user_id) <> 'personal'
       AND l.user_id <> '00000000-0000-0000-0000-000000000001'
       AND l.source IN ('topup', 'sale', 'withdrawal', 'ajo_collection', 'ajo_payout', 'peer_esusu_collection', 'bill_spend', 'subscription_spend')
     GROUP BY 1, 2 ORDER BY 1, 2 LOOP
    RAISE NOTICE 'F3 business % % | n=% total=₦%', r.source, r.direction, r.n, r.naira;
  END LOOP;

  -- business bank transfers since 19 Oct: charged a fee or free (monthly allowance)?
  FOR r IN
    SELECT CASE WHEN EXISTS (SELECT 1 FROM public.wallet_ledger f WHERE f.related_txn_id = w.id AND f.source = 'transfer_fee') THEN 'fee' ELSE 'no fee' END AS charged,
           public.wallet_fee_tier(w.user_id) tier, w.status, count(*) n, sum(w.amount_kobo) / 100.0 naira
      FROM public.wallet_withdrawals w
     WHERE w.created_at >= '2026-10-19' AND public.wallet_fee_tier(w.user_id) <> 'personal'
     GROUP BY 1, 2, 3 ORDER BY 2, 3, 1 LOOP
    RAISE NOTICE 'F4 business bank transfers | tier=% status=% % | n=% total=₦%', r.tier, r.status, r.charged, r.n, r.naira;
  END LOOP;
  RAISE NOTICE 'F5 config | deposit fee start=% | move fee=% kobo | free moves/day=%',
    (SELECT value FROM public.platform_config WHERE key = 'wallet_deposit_fee_start'),
    (SELECT value FROM public.platform_config WHERE key = 'wallet_move_fee_kobo'),
    (SELECT value FROM public.platform_config WHERE key = 'wallet_move_free_per_day');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
