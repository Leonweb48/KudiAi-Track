-- READ-ONLY (2026-10-12): fees, from our own records, platform-wide since 1 Sept 2026 (WAT).
-- (1) Wallet ledger by source: count + total (every kind of money movement, incl. our fees to customers).
-- (2) Bank transfers out by amount band and status: count, total, the Flutterwave fee Flutterwave reported per transfer
--     (wallet_withdrawals.fee_kobo) — min / max / total — and how many have no fee recorded.
-- Platform totals only — no names, accounts or references. No writes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT source, direction, count(*) n, round(sum(amount_kobo) / 100.0, 2) total
      FROM public.wallet_ledger WHERE created_at >= '2026-09-01 00:00+01' AND status <> 'reversed'
     GROUP BY 1, 2 ORDER BY 1, 2
  LOOP
    RAISE NOTICE 'L % % n=% total=₦%', r.source, r.direction, r.n, r.total;
  END LOOP;
  FOR r IN
    SELECT CASE WHEN amount_kobo <= 500000 THEN 'a: up to 5,000' WHEN amount_kobo <= 1000000 THEN 'b: 5,001-10,000'
                WHEN amount_kobo <= 5000000 THEN 'c: 10,001-50,000' ELSE 'd: above 50,000' END AS band,
           status, count(*) n, round(sum(amount_kobo) / 100.0, 2) total,
           round(min(NULLIF(fee_kobo, 0)) / 100.0, 2) fee_min, round(max(fee_kobo) / 100.0, 2) fee_max,
           round(sum(fee_kobo) / 100.0, 2) fee_total, count(*) FILTER (WHERE coalesce(fee_kobo, 0) = 0) no_fee_recorded
      FROM public.wallet_withdrawals WHERE created_at >= '2026-09-01 00:00+01'
     GROUP BY 1, 2 ORDER BY 1, 2
  LOOP
    RAISE NOTICE 'T % % n=% total=₦% | Flutterwave fee: min ₦% max ₦% total ₦% | none recorded on %',
      r.band, r.status, r.n, r.total, r.fee_min, r.fee_max, r.fee_total, r.no_fee_recorded;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
