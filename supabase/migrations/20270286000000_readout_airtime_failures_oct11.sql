-- READ-ONLY diagnostic (2026-10-11): the owner reports two failed airtime purchases. Were they refused by the provider,
-- by our payment check, or by the network lock, and was the money returned? Also: did any bill setting change recently?
-- Times, statuses, error codes and setting names/values only — no reference, phone number, name or amount (CI logs
-- are public; digits in error text are masked). No writes.
DO $$
DECLARE r record; v_ref text; n int := 0;
BEGIN
  FOR r IN
    SELECT to_char(created_at AT TIME ZONE 'Africa/Lagos', 'MM-DD') AS d, category, coalesce(bill_status, '?') AS st, count(*) AS c
      FROM public.transactions
     WHERE payment_type = 'bill_payment' AND category IN ('airtime', 'data') AND created_at > '2026-10-05'
     GROUP BY 1, 2, 3 ORDER BY 1, 2, 3
  LOOP
    RAISE NOTICE 'A % % % = %', r.d, r.category, r.st, r.c;
  END LOOP;

  FOR r IN
    SELECT id, created_at, category, note, bill_details FROM public.transactions
     WHERE payment_type = 'bill_payment' AND bill_status = 'failed' AND created_at > '2026-10-08'
     ORDER BY created_at DESC LIMIT 12
  LOOP
    n := n + 1;
    v_ref := substring(r.note FROM 'PS: ([A-Za-z0-9_-]+)');
    RAISE NOTICE 'B% at=% WAT cat=% ref_kind=% paid_via=% err=%', n,
      to_char(r.created_at AT TIME ZONE 'Africa/Lagos', 'MM-DD HH24:MI'), r.category,
      CASE WHEN v_ref IS NULL THEN 'none' WHEN v_ref LIKE 'KDT-BILL-%' THEN 'KDT-BILL' ELSE left(regexp_replace(v_ref, '[0-9]', '#', 'g'), 6) || '…' END,
      coalesce(r.bill_details ->> 'paid_via', '?'),
      left(regexp_replace(split_part(coalesce(r.note, ''), '| PS:', 1), '[0-9]', '#', 'g'), 110);
    RAISE NOTICE 'B% providers=% gate=% ledger=%', n,
      (SELECT coalesce(array_to_string(providers, '>'), 'none') FROM public.bill_provider_attempts WHERE request_id = v_ref),
      (SELECT coalesce(string_agg(coalesce(reason, '?') || '/' || coalesce(enforced::text, '?'), ','), 'none') FROM public.bill_gate_log WHERE request_id = v_ref),
      (SELECT coalesce(string_agg(source || '/' || status, ',' ORDER BY created_at), 'none') FROM public.wallet_ledger WHERE reference = v_ref OR related_txn_id = r.id);
  END LOOP;
  IF n = 0 THEN RAISE NOTICE 'B none: no failed bill recorded since 10-08'; END IF;

  FOR r IN
    SELECT coalesce(cat, '?') AS cat, coalesce(reason, '?') AS reason, enforced, count(*) AS c
      FROM public.bill_gate_log WHERE created_at > now() - interval '3 days'
     GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 12
  LOOP
    RAISE NOTICE 'C gate 3d cat=% reason=% enforced=% n=%', r.cat, r.reason, r.enforced, r.c;
  END LOOP;

  FOR r IN
    SELECT key, value, updated_at FROM public.platform_config
     WHERE (key ~* '(bill|ck_|clubkonnect|vtpass|airtime|provider|relay|cashback)')
       AND key !~* '(secret|token|pass|apikey|api_key|_key$)'
     ORDER BY key
  LOOP
    RAISE NOTICE 'D % = % (updated %)', r.key, left(coalesce(r.value::text, 'null'), 40), coalesce(to_char(r.updated_at, 'MM-DD HH24:MI'), '?');
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
