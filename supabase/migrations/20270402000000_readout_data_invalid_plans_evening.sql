-- READ-ONLY (2026-10-23, evening): the owner reports EVERY data plan refused as invalid by ClubKonnect. Every DATA bill of the last 12 hours
-- (successes too): time, amount, status, our note (5+ digit runs masked), the provider claim row (which provider took it),
-- plus the plans hidden after a refusal (bill_plan_blocks) and the bill alerts sent to admins. No balances, no full
-- numbers. No writes.
DO $$
DECLARE r record; a record; j jsonb; k text;
BEGIN
  RAISE NOTICE 'E0 data bills 12h by status: %', (SELECT string_agg(coalesce(bill_status, 'null') || '=' || n, ' ') FROM (
    SELECT bill_status, count(*) n FROM public.transactions
     WHERE payment_type = 'bill_payment' AND category = 'data' AND created_at > now() - interval '6 hours' GROUP BY bill_status) s);
  RAISE NOTICE 'E0 data claims 12h by providers: %', (SELECT string_agg(p || '=' || n, ' ') FROM (
    SELECT array_to_string(providers, '>') p, count(*) n FROM public.bill_provider_attempts
     WHERE service = 'data' AND created_at > now() - interval '6 hours' GROUP BY 1) s);
  FOR r IN
    SELECT t.created_at, t.amount, t.bill_status, t.bill_details,
           substring(t.note FROM '(KDT-BILL-[0-9]+)') AS ref,
           regexp_replace(regexp_replace(coalesce(t.note, ''), 'KDT-BILL-[0-9]+', 'REF', 'g'), '\d+(\d{4})', '…\1', 'g') AS note_m
      FROM public.transactions t
     WHERE t.payment_type = 'bill_payment' AND t.category = 'data' AND t.created_at > now() - interval '6 hours'
     ORDER BY t.created_at LOOP
    j := coalesce(r.bill_details, '{}'::jsonb);
    FOR k IN SELECT jsonb_object_keys(j) LOOP
      IF k ~* '(phone|recipient|mobile|number|customer|name|email|user|address|token|pin)' THEN j := j - k; END IF;
    END LOOP;
    RAISE NOTICE 'E1 % | ₦% | bill=% | ref=% | note=%', to_char(r.created_at AT TIME ZONE 'Africa/Lagos', 'MM-DD HH24:MI'), r.amount, r.bill_status, coalesce(r.ref, '-'), left(r.note_m, 220);
    RAISE NOTICE 'E2   details=%', left(regexp_replace(j::text, '\d+(\d{4})', '…\1', 'g'), 260);
    IF r.ref IS NOT NULL THEN
      FOR a IN SELECT to_jsonb(p) - 'bg_meta' AS j FROM public.bill_provider_attempts p WHERE p.request_id = r.ref LOOP
        RAISE NOTICE 'E3   claim=%', left(a.j::text, 260);
      END LOOP;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM public.bill_plan_blocks ORDER BY last_refused_at LOOP
    RAISE NOTICE 'E4 hidden: % % % "%" until % (refused %x)', r.provider, r.network, r.plan_id, r.plan_name,
      to_char(r.blocked_until AT TIME ZONE 'Africa/Lagos', 'MM-DD HH24:MI'), r.refused_count;
  END LOOP;
  FOR r IN
    SELECT n.created_at, n.title, regexp_replace(coalesce(n.message, ''), '\d+(\d{4})', '…\1', 'g') AS msg,
           regexp_replace(coalesce(n.metadata::text, ''), '\d+(\d{4})', '…\1', 'g') AS meta
      FROM public.admin_notifications n
     WHERE n.created_at > now() - interval '6 hours' AND n.category = 'finance' AND n.title !~* 'profit report'
     ORDER BY n.created_at LOOP
    IF (r.title || r.msg || r.meta) ~* '(balance|wallet is low|wallet_low|float)' THEN
      RAISE NOTICE 'E5 % | % | (wallet alert, figures hidden)', to_char(r.created_at AT TIME ZONE 'Africa/Lagos', 'MM-DD HH24:MI'), r.title;
    ELSE
      RAISE NOTICE 'E5 % | % | % | %', to_char(r.created_at AT TIME ZONE 'Africa/Lagos', 'MM-DD HH24:MI'), r.title, left(r.msg, 200), left(r.meta, 160);
    END IF;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
