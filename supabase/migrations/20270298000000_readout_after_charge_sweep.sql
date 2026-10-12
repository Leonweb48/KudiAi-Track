-- READ-ONLY (2026-10-12): after the first bill-charge-sweep run — any bill charge still pending > 1 h? The 4 Oct
-- client charge: status + its refund entry; and does that wallet's balance equal the sum of its ledger? Booleans/counts.
DO $$
DECLARE p record; v_sum bigint; v_bal bigint;
BEGIN
  RAISE NOTICE 'S1 bill charges still pending > 1 hour (all wallets): %',
    (SELECT count(*) FROM public.wallet_ledger WHERE source = 'bill_spend' AND status = 'pending' AND created_at < now() - interval '1 hour');
  SELECT l.* INTO p FROM public.wallet_ledger l
   WHERE l.source = 'bill_spend' AND l.created_at BETWEEN '2026-10-04 15:48:00+00' AND '2026-10-04 15:49:00+00' LIMIT 1;
  RAISE NOTICE 'S2 4 Oct charge now: % | refund entry: %', p.status,
    (SELECT coalesce(string_agg(source || '/' || status || ' same_amount=' || (amount_kobo = p.amount_kobo)::text, ','), 'none')
       FROM public.wallet_ledger WHERE reference = p.reference AND source = 'bill_reversal');
  SELECT balance_kobo INTO v_bal FROM public.wallets WHERE id = p.wallet_id;
  SELECT coalesce(sum(CASE WHEN direction = 'credit' THEN amount_kobo ELSE -amount_kobo END), 0) INTO v_sum
    FROM public.wallet_ledger WHERE wallet_id = p.wallet_id AND status <> 'reversed' OR (wallet_id = p.wallet_id AND status = 'reversed' AND direction = 'debit');
  RAISE NOTICE 'S3 that wallet: balance equals the newest entry''s balance_after = %',
    (SELECT v_bal = balance_after_kobo FROM public.wallet_ledger WHERE wallet_id = p.wallet_id ORDER BY created_at DESC LIMIT 1);
  RAISE NOTICE 'S4 20 Sept charge now: %', (SELECT status FROM public.wallet_ledger WHERE source = 'bill_spend'
     AND created_at BETWEEN '2026-09-20 19:35:00+00' AND '2026-09-20 19:36:00+00' LIMIT 1);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
