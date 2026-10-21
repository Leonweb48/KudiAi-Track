-- 1. bill_delivery_rechecks — remembers the follow-up answer for each airtime / data order the app showed as delivered
--    (clubkonnect bill-charge-sweep "delivered re-check", 2026-10-21). Server-only.
-- 2. KDT-BILL-1792579001994 — ₦200 MTN airtime to …5002, 21 Oct 10:36 UTC, paid with the business's CASHBACK balance and
--    shown as successful; ClubKonnect's final record: statuscode 201 "Network Unresponsive" (not delivered). Owner reported
--    it. Return the ₦200 to the cashback balance, take back the cashback earned on it, mark the bill failed, tell them.

CREATE TABLE IF NOT EXISTS public.bill_delivery_rechecks (
  request_id text PRIMARY KEY CHECK (length(request_id) BETWEEN 1 AND 64),
  service    text NOT NULL,
  verdict    text NOT NULL,
  action     text,
  checked_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bill_delivery_rechecks ENABLE ROW LEVEL SECURITY;   -- no policies: service role only
REVOKE ALL ON TABLE public.bill_delivery_rechecks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.bill_delivery_rechecks TO service_role;

DO $refund$
DECLARE
  v_ref constant text := 'KDT-BILL-1792579001994';
  t record; v_email text; v_used numeric; v_earned numeric;
BEGIN
  IF EXISTS (SELECT 1 FROM public.bill_delivery_rechecks WHERE request_id = v_ref) THEN
    RAISE NOTICE 'refund | already handled'; RETURN;
  END IF;
  SELECT * INTO t FROM public.transactions
   WHERE payment_type = 'bill_payment' AND category = 'airtime' AND amount = 200 AND bill_status = 'success'
     AND created_at BETWEEN '2026-10-21 10:36:30+00' AND '2026-10-21 10:37:30+00'
     AND bill_details->>'paid_via' = 'cashback';
  IF NOT FOUND THEN RAISE NOTICE 'refund | bill record not found — nothing changed'; RETURN; END IF;

  -- the cashback lines written with that purchase (same minute): what was used and what was earned
  SELECT user_email, sum(amount) FILTER (WHERE type = 'redeemed'), sum(amount) FILTER (WHERE type = 'earned')
    INTO v_email, v_used, v_earned
    FROM public.cashback_transactions
   WHERE created_at BETWEEN t.created_at - interval '2 minutes' AND t.created_at + interval '2 minutes'
     AND bill_type = 'airtime'
   GROUP BY user_email ORDER BY sum(amount) FILTER (WHERE type = 'redeemed') DESC NULLS LAST LIMIT 1;
  IF v_email IS NULL THEN RAISE NOTICE 'refund | cashback lines not found — nothing changed'; RETURN; END IF;

  INSERT INTO public.cashback_transactions (user_email, amount, type, bill_type, description)
  VALUES (v_email, coalesce(v_used, 200), 'earned', 'airtime', 'Refund: ₦200 airtime not delivered (network unresponsive) — 21 Oct');
  IF coalesce(v_earned, 0) > 0 THEN
    INSERT INTO public.cashback_transactions (user_email, amount, type, bill_type, description)
    VALUES (v_email, v_earned, 'redeemed', 'airtime', 'Cashback taken back: the 21 Oct ₦200 airtime was not delivered');
  END IF;

  UPDATE public.transactions SET bill_status = 'failed' WHERE id = t.id;

  BEGIN
    INSERT INTO public.notifications (user_id, type, category, title, body, deep_link, priority, dedupe_key)
    VALUES (t.user_id, 'bill_payment_failed', 'bills', 'Airtime refunded',
            'Your ₦200 MTN airtime on 21 Oct wasn''t delivered by the network, so ₦' || to_char(coalesce(v_used, 200), 'FM999,999') ||
            ' is back in your cashback balance.', '{"tab":"bills"}'::jsonb, 'high', 'bill_refund_' || v_ref);
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'refund | notification skipped: %', SQLERRM; END;

  INSERT INTO public.bill_delivery_rechecks (request_id, service, verdict, action)
  VALUES (v_ref, 'airtime', 'FAILED', 'refunded-cashback-by-hand');
  RAISE NOTICE 'refund | cashback returned ₦% (earned ₦% taken back), bill marked failed', coalesce(v_used, 200), coalesce(v_earned, 0);
END $refund$;
