-- READ-ONLY (2026-10-25, audit): has anyone abused (a) the user-callable bill refund on a DELIVERED bill, or (b) self-
-- written cashback? Totals and counts only — no emails, no ids. No writes.
DO $$
DECLARE r record;
BEGIN
  -- (a) bill charges refunded while the bill record says it was delivered
  SELECT count(*) n, coalesce(sum(l.amount_kobo), 0) / 100 naira INTO r
    FROM public.wallet_ledger l
   WHERE l.source = 'bill_spend' AND l.status = 'reversed'
     AND EXISTS (SELECT 1 FROM public.transactions t WHERE t.payment_type = 'bill_payment' AND t.bill_status = 'success'
                  AND l.reference IS NOT NULL AND t.note ILIKE '%' || l.reference || '%');
  RAISE NOTICE 'A1 refunded bill charges whose bill shows delivered: % (₦%)', r.n, r.naira;
  SELECT count(*) n, coalesce(sum(amount_kobo), 0) / 100 naira INTO r FROM public.wallet_ledger WHERE source = 'bill_reversal';
  RAISE NOTICE 'A2 all bill refunds ever: % (₦%)', r.n, r.naira;
  -- (b) cashback: earned per user vs 1% of that user's delivered airtime + data
  FOR r IN
    WITH earned AS (
      SELECT user_email, sum(amount) FILTER (WHERE type = 'earned') e, sum(amount) FILTER (WHERE type = 'redeemed') rd, max(amount) FILTER (WHERE type = 'earned') mx, count(*) rows
        FROM public.cashback_transactions GROUP BY user_email),
    spent AS (
      SELECT u.email, sum(t.amount) s FROM public.transactions t JOIN auth.users u ON u.id = t.user_id
       WHERE t.payment_type = 'bill_payment' AND t.category IN ('airtime', 'data') AND t.bill_status = 'success' GROUP BY u.email)
    SELECT count(*) users, count(*) FILTER (WHERE coalesce(e, 0) > coalesce(s, 0) * 0.02 + 50) suspicious,
           coalesce(sum(e), 0) total_earned, coalesce(sum(rd), 0) total_redeemed, coalesce(max(mx), 0) biggest_row,
           coalesce(sum(e) FILTER (WHERE coalesce(e, 0) > coalesce(s, 0) * 0.02 + 50), 0) suspicious_earned
      FROM earned LEFT JOIN spent ON spent.email = earned.user_email LOOP
    RAISE NOTICE 'B1 cashback users=% suspicious=% | earned ₦% redeemed ₦% | biggest single earned row ₦% | earned by suspicious ₦%',
      r.users, r.suspicious, r.total_earned, r.total_redeemed, r.biggest_row, r.suspicious_earned;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
