-- READ-ONLY (2026-10-21): the owner reports one electricity and one airtime order failed. For bill records of the last
-- 36 hours that did not succeed: reference, category, amount, status, our note and the provider fields of bill_details,
-- the provider-attempt row, and the finance alerts sent to admins in the same window. Every run of 5+ digits is masked to
-- its last 4 (numbers, meters, tokens). No writes.
DO $$
DECLARE r record; a record; j jsonb; k text;
BEGIN
  BEGIN
    FOR r IN
      SELECT t.created_at, t.amount, t.category, t.bill_status, t.bill_details,
             substring(t.note FROM '(KDT-BILL-[0-9]+)') AS ref,
             regexp_replace(regexp_replace(coalesce(t.note, ''), 'KDT-BILL-[0-9]+', 'REF', 'g'), '\d+(\d{4})', '…\1', 'g') AS note_m
        FROM public.transactions t
       WHERE t.payment_type = 'bill_payment' AND t.created_at > now() - interval '36 hours'
         AND coalesce(t.bill_status, '') NOT IN ('success', 'delivered', 'completed')
       ORDER BY t.created_at LOOP
      j := coalesce(r.bill_details, '{}'::jsonb);
      FOR k IN SELECT jsonb_object_keys(j) LOOP
        IF k ~* '(phone|recipient|mobile|number|customer|meter|token|pin|card|name|email|user|address)' THEN j := j - k; END IF;
      END LOOP;
      RAISE NOTICE 'F1 % | % | ₦% | bill=% | ref=% | note=%', to_char(r.created_at AT TIME ZONE 'Africa/Lagos', 'MM-DD HH24:MI'),
        r.category, r.amount, r.bill_status, coalesce(r.ref, '-'), left(r.note_m, 300);
      RAISE NOTICE 'F2   details=%', left(regexp_replace(j::text, '\d+(\d{4})', '…\1', 'g'), 500);
      IF r.ref IS NOT NULL THEN
        FOR a IN SELECT to_jsonb(p) AS j FROM public.bill_provider_attempts p WHERE p.request_id = r.ref LOOP
          j := a.j - 'bg_meta';
          RAISE NOTICE 'F3   attempt=% bg_service=%', left(j::text, 300), coalesce(a.j -> 'bg_meta' ->> 'service', '-');
        END LOOP;
      END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'F1 failed: %', SQLERRM; END;

  BEGIN
    FOR r IN
      SELECT n.created_at, n.title,
             regexp_replace(coalesce(n.message, ''), '\d+(\d{4})', '…\1', 'g') AS msg,
             regexp_replace(coalesce(n.metadata::text, ''), '\d+(\d{4})', '…\1', 'g') AS meta
        FROM public.admin_notifications n
       WHERE n.created_at > now() - interval '36 hours' AND n.category = 'finance'
       ORDER BY n.created_at LOOP
      -- provider balances never go into a log
      IF (r.title || r.msg || r.meta) ~* '(balance|wallet is low|wallet_low|float)' THEN
        RAISE NOTICE 'F4 % | % | (wallet alert, figures hidden)', to_char(r.created_at AT TIME ZONE 'Africa/Lagos', 'MM-DD HH24:MI'), r.title;
      ELSE
        RAISE NOTICE 'F4 % | % | % | %', to_char(r.created_at AT TIME ZONE 'Africa/Lagos', 'MM-DD HH24:MI'), r.title,
          left(r.msg, 300), left(r.meta, 300);
      END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'F4 failed: %', SQLERRM; END;
END $$;
