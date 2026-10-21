-- READ-ONLY (2026-10-21): is the ₦10 wallet-to-wallet Charge fee (live 19 Oct, 9c1c537) actually being taken? Every
-- wallet-to-wallet payment since 19 Oct with its time and whether a 'wallet_fee' line exists for it. Counts/times only.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT l.source, l.created_at, l.amount_kobo / 100.0 naira, public.wallet_fee_tier(l.user_id) tier,
           EXISTS (SELECT 1 FROM public.wallet_ledger f WHERE f.source = 'wallet_fee' AND f.direction = 'debit'
                     AND f.user_id = l.user_id AND f.created_at BETWEEN l.created_at - interval '5 seconds' AND l.created_at + interval '5 seconds') AS fee_taken,
           (SELECT w.balance_kobo FROM public.wallets w WHERE w.user_id = l.user_id) / 100.0 AS bal_now
      FROM public.wallet_ledger l
     WHERE l.created_at >= '2026-10-19' AND l.direction = 'debit' AND l.status = 'completed'
       AND l.source IN ('ajo_contribution', 'peer_esusu_contribution', 'ajo_payout')
     ORDER BY l.created_at LOOP
    RAISE NOTICE 'W1 % | % | ₦% | tier=% | fee_taken=%', r.created_at, r.source, r.naira, r.tier, r.fee_taken;
  END LOOP;
  RAISE NOTICE 'W2 wallet_fee lines since 19 Oct: %', (SELECT count(*) FROM public.wallet_ledger WHERE source = 'wallet_fee' AND created_at >= '2026-10-19');
  RAISE NOTICE 'W3 wallet_transfer_fee_kobo(5000 naira)=% | gate for a random user=%',
    public.wallet_transfer_fee_kobo(500000), public.wallet_daily_transfer_count(gen_random_uuid());
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
