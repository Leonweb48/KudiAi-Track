-- READ-ONLY (2026-10-22): the owner reports data bills failing. Every DATA bill of the last 24 hours that did not
-- succeed: time, amount, status, our note (5+ digit runs masked), the plan id kind (ClubKonnect / bg: / vt:), the provider
-- claim row, plus data successes count and the bill alerts sent to admins. No balances, no full numbers. No writes.
DO $$
DECLARE r record; a record; j jsonb; k text; ok int; bad int;
BEGIN
  SELECT count(*) FILTER (WHERE bill_status IN ('success', 'delivered', 'completed')), count(*) FILTER (WHERE coalesce(bill_status, '') NOT IN ('success', 'delivered', 'completed'))
    INTO ok, bad FROM public.transactions WHERE payment_type = 'bill_payment' AND category = 'data' AND created_at > now() - interval '24 hours';
  RAISE NOTICE 'D0 data bills 36h: ok=% not-ok=%', ok, bad;
  FOR r IN
    SELECT t.created_at, t.amount, t.bill_status, t.bill_details,
           substring(t.note FROM '(KDT-BILL-[0-9]+)') AS ref,
           regexp_replace(regexp_replace(coalesce(t.note, ''), 'KDT-BILL-[0-9]+', 'REF', 'g'), '\d+(\d{4})', '…\1', 'g') AS note_m
      FROM public.transactions t
     WHERE t.payment_type = 'bill_payment' AND t.category = 'data' AND t.created_at > now() - interval '24 hours'
       AND coalesce(t.bill_status, '') NOT IN ('success', 'delivered', 'completed')
     ORDER BY t.created_at LOOP
    j := coalesce(r.bill_details, '{}'::jsonb);
    FOR k IN SELECT jsonb_object_keys(j) LOOP
      IF k ~* '(phone|recipient|mobile|number|customer|name|email|user|address|token|pin)' THEN j := j - k; END IF;
    END LOOP;
    RAISE NOTICE 'D1 % | ₦% | bill=% | ref=% | note=%', to_char(r.created_at AT TIME ZONE 'Africa/Lagos', 'MM-DD HH24:MI'), r.amount, r.bill_status, coalesce(r.ref, '-'), left(r.note_m, 260);
    RAISE NOTICE 'D2   details=%', left(regexp_replace(j::text, '\d+(\d{4})', '…\1', 'g'), 300);
    IF r.ref IS NOT NULL THEN
      FOR a IN SELECT to_jsonb(p) - 'bg_meta' AS j FROM public.bill_provider_attempts p WHERE p.request_id = r.ref LOOP
        RAISE NOTICE 'D3   claim=%', left(a.j::text, 300);
      END LOOP;
    END IF;
  END LOOP;
  -- wallet charges for data that were refunded (the app may fail an order before writing a bill record)
  RAISE NOTICE 'D4 data wallet charges 36h: %', (SELECT string_agg(status || '=' || n, ' ') FROM (
    SELECT l.status, count(*) n FROM public.wallet_ledger l WHERE l.source = 'bill_spend' AND l.created_at > now() - interval '24 hours'
       AND l.narration ~* 'data' GROUP BY l.status) s);
  FOR r IN
    SELECT n.created_at, n.title, regexp_replace(coalesce(n.message, ''), '\d+(\d{4})', '…\1', 'g') AS msg,
           regexp_replace(coalesce(n.metadata::text, ''), '\d+(\d{4})', '…\1', 'g') AS meta
      FROM public.admin_notifications n
     WHERE n.created_at > now() - interval '24 hours' AND n.category = 'finance' AND n.title !~* 'profit report'
     ORDER BY n.created_at LOOP
    IF (r.title || r.msg || r.meta) ~* '(balance|wallet is low|wallet_low|float)' THEN
      RAISE NOTICE 'D5 % | % | (wallet alert, figures hidden)', to_char(r.created_at AT TIME ZONE 'Africa/Lagos', 'MM-DD HH24:MI'), r.title;
    ELSE
      RAISE NOTICE 'D5 % | % | % | %', to_char(r.created_at AT TIME ZONE 'Africa/Lagos', 'MM-DD HH24:MI'), r.title, left(r.msg, 220), left(r.meta, 200);
    END IF;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
