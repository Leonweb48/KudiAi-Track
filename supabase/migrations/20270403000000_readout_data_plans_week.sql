-- READ-ONLY (2026-10-23, evening): which data plans went through on ClubKonnect this week, and which were refused?
-- Data bills of the last 7 days: per day × status counts, then each order's time, status, network + plan id (from our
-- note or the stored details) and plan name. No phones, no names, no balances. No writes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT to_char(created_at AT TIME ZONE 'Africa/Lagos', 'MM-DD') d, coalesce(bill_status, 'null') s, count(*) n
      FROM public.transactions WHERE payment_type = 'bill_payment' AND category = 'data' AND created_at > now() - interval '7 days'
     GROUP BY 1, 2 ORDER BY 1, 2 LOOP
    RAISE NOTICE 'F0 % % = %', r.d, r.s, r.n;
  END LOOP;
  FOR r IN
    SELECT to_char(t.created_at AT TIME ZONE 'Africa/Lagos', 'MM-DD HH24:MI') at_l, t.bill_status, t.amount,
           coalesce(substring(t.note FROM '\[net:[0-9]+ plan:[^\]]+\]'), '') AS np,
           left(coalesce(t.bill_details->>'plan_id', t.bill_details->>'planId', t.bill_details->>'plan', ''), 40) AS pid,
           left(coalesce(t.bill_details->>'plan_name', t.bill_details->>'planName', t.bill_details->>'bundle', t.bill_details->>'description', ''), 60) AS pname,
           left(coalesce(t.bill_details->>'network', ''), 12) AS net,
           left(coalesce(t.bill_details->>'provider', ''), 12) AS prov
      FROM public.transactions t
     WHERE t.payment_type = 'bill_payment' AND t.category = 'data' AND t.created_at > now() - interval '7 days'
     ORDER BY t.created_at LOOP
    RAISE NOTICE 'F1 % | % | ₦% | % % | % | % | %', r.at_l, r.bill_status, r.amount, r.net, r.pid, r.pname, r.np, r.prov;
  END LOOP;
  RAISE NOTICE 'F2 detail keys seen: %', (SELECT string_agg(DISTINCT k, ',') FROM public.transactions t, jsonb_object_keys(coalesce(t.bill_details, '{}'::jsonb)) k
    WHERE t.payment_type = 'bill_payment' AND t.category = 'data' AND t.created_at > now() - interval '7 days'
      AND k !~* '(phone|recipient|mobile|number|customer|name|email|user|address|token|pin)');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
