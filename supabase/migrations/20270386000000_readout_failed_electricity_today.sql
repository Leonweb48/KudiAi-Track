-- READ-ONLY (2026-10-22): the owner reports electricity not working. Every electricity bill of the last 36 hours: time,
-- amount, status, our note (5+ digit runs masked — meters, tokens), the provider claim row; wallet charges for electricity;
-- and bill alerts sent to admins today. No balances, no full meter numbers or tokens. No writes.
DO $$
DECLARE r record; a record; ok int; bad int;
BEGIN
  SELECT count(*) FILTER (WHERE bill_status IN ('success', 'delivered', 'completed')), count(*) FILTER (WHERE coalesce(bill_status, '') NOT IN ('success', 'delivered', 'completed'))
    INTO ok, bad FROM public.transactions WHERE payment_type = 'bill_payment' AND category = 'electricity' AND created_at > now() - interval '36 hours';
  RAISE NOTICE 'E0 electricity bills 36h: ok=% not-ok=%', ok, bad;
  FOR r IN
    SELECT t.created_at, t.amount, t.bill_status,
           substring(t.note FROM '(KDT-BILL-[0-9]+)') AS ref,
           regexp_replace(regexp_replace(coalesce(t.note, ''), 'KDT-BILL-[0-9]+', 'REF', 'g'), '\d+(\d{4})', '…\1', 'g') AS note_m
      FROM public.transactions t
     WHERE t.payment_type = 'bill_payment' AND t.category = 'electricity' AND t.created_at > now() - interval '36 hours'
     ORDER BY t.created_at LOOP
    RAISE NOTICE 'E1 % | ₦% | bill=% | ref=% | note=%', to_char(r.created_at AT TIME ZONE 'Africa/Lagos', 'MM-DD HH24:MI'), r.amount, r.bill_status, coalesce(r.ref, '-'), left(r.note_m, 260);
    IF r.ref IS NOT NULL THEN
      FOR a IN SELECT to_jsonb(p) - 'bg_meta' AS j FROM public.bill_provider_attempts p WHERE p.request_id = r.ref LOOP
        RAISE NOTICE 'E2   claim=%', left(a.j::text, 300);
      END LOOP;
    END IF;
  END LOOP;
  FOR r IN SELECT l.created_at, l.status, l.amount_kobo, l.reference FROM public.wallet_ledger l
            WHERE l.source = 'bill_spend' AND l.created_at > now() - interval '36 hours' AND l.narration ~* '(electric|meter|prepaid|postpaid)'
            ORDER BY l.created_at LOOP
    RAISE NOTICE 'E3 charge % | % | ₦% | %', to_char(r.created_at AT TIME ZONE 'Africa/Lagos', 'MM-DD HH24:MI'), r.status, r.amount_kobo / 100.0, coalesce(r.reference, '-');
    FOR a IN SELECT to_jsonb(p) - 'bg_meta' AS j FROM public.bill_provider_attempts p WHERE p.request_id = r.reference LOOP
      RAISE NOTICE 'E4   claim=%', left(a.j::text, 300);
    END LOOP;
  END LOOP;
  FOR r IN
    SELECT n.created_at, n.title, regexp_replace(coalesce(n.message, ''), '\d+(\d{4})', '…\1', 'g') AS msg,
           regexp_replace(coalesce(n.metadata::text, ''), '\d+(\d{4})', '…\1', 'g') AS meta
      FROM public.admin_notifications n
     WHERE n.created_at > now() - interval '24 hours' AND n.category = 'finance' AND n.title !~* '(profit report|old wallet numbers)'
     ORDER BY n.created_at LOOP
    IF (r.title || r.msg || r.meta) ~* '(balance|wallet is low|wallet_low|float)' THEN
      RAISE NOTICE 'E5 % | % | (wallet alert, figures hidden)', to_char(r.created_at AT TIME ZONE 'Africa/Lagos', 'MM-DD HH24:MI'), r.title;
    ELSE
      RAISE NOTICE 'E5 % | % | % | %', to_char(r.created_at AT TIME ZONE 'Africa/Lagos', 'MM-DD HH24:MI'), r.title, left(r.msg, 220), left(r.meta, 200);
    END IF;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
