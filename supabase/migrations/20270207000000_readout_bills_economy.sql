-- READ-ONLY (no writes, no identifiers): how the bills / promo economy is really used, and whether there are signs it has
-- been abused. Each block is isolated. Read with:  gh run view <id> --log | grep NOTICE
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT type, count(*) AS n, coalesce(sum(amount),0) AS total, coalesce(max(amount),0) AS biggest, count(DISTINCT user_email) AS users
             FROM public.cashback_transactions GROUP BY type ORDER BY type LOOP
    RAISE NOTICE 'bills | cashback rows type=% n=% total=% biggest_single=% distinct_users=%', r.type, r.n, r.total, r.biggest, r.users;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'bills | cashback error: %', SQLERRM; END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT count(*) AS n, coalesce(sum(points) FILTER (WHERE points > 0),0) AS earned, coalesce(sum(points) FILTER (WHERE points < 0),0) AS redeemed,
                  coalesce(max(points),0) AS biggest, count(DISTINCT user_id) AS users FROM public.reward_points_log LOOP
    RAISE NOTICE 'bills | reward points rows=% earned=% redeemed=% biggest_single=% distinct_users=%', r.n, r.earned, r.redeemed, r.biggest, r.users;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'bills | points error: %', SQLERRM; END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT is_active, type, count(*) AS n, coalesce(max(value),0) AS max_value, count(*) FILTER (WHERE 'bills' = ANY(applies_to) OR coalesce(array_length(applies_to,1),0) = 0) AS covers_bills
             FROM public.coupons GROUP BY is_active, type ORDER BY 1,2 LOOP
    RAISE NOTICE 'bills | coupons active=% type=% n=% max_value=% cover_bills=%', r.is_active, r.type, r.n, r.max_value, r.covers_bills;
  END LOOP;
  RAISE NOTICE 'bills | coupon redemptions total=%', (SELECT count(*) FROM public.coupon_redemptions);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'bills | coupons error: %', SQLERRM; END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT status, count(*) AS n, coalesce(sum(paid_amount),0) AS paid_total,
                  count(*) FILTER (WHERE (form_data->>'amount') ~ '^[0-9.]+$' AND (form_data->>'amount')::numeric > coalesce(paid_amount,0) * 1.10 + 1) AS asked_more_than_paid
             FROM public.pending_bills GROUP BY status ORDER BY status LOOP
    RAISE NOTICE 'bills | pending_bills status=% n=% paid_total=% amount_in_request_gt_paid=%', r.status, r.n, r.paid_total, r.asked_more_than_paid;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'bills | pending_bills error: %', SQLERRM; END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT date_trunc('month', created_at)::date AS m, count(*) AS n, coalesce(sum(amount),0) AS total
             FROM public.transactions WHERE bill_status IS NOT NULL GROUP BY 1 ORDER BY 1 LOOP
    RAISE NOTICE 'bills | bill transactions month=% n=% total=%', r.m, r.n, r.total;
  END LOOP;
  FOR r IN SELECT bill_status, count(*) AS n FROM public.transactions WHERE bill_status IS NOT NULL GROUP BY 1 ORDER BY 1 LOOP
    RAISE NOTICE 'bills | bill_status=% n=%', r.bill_status, r.n;
  END LOOP;
  FOR r IN SELECT status, count(*) AS n, coalesce(sum(amount_kobo),0)/100 AS naira FROM public.wallet_ledger WHERE source = 'bill_spend' GROUP BY 1 ORDER BY 1 LOOP
    RAISE NOTICE 'bills | wallet bill_spend status=% n=% total_NGN=%', r.status, r.n, r.naira;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'bills | transactions error: %', SQLERRM; END $$;
