-- READ-ONLY diagnostic (2026-10-01): full bill-payments audit requested by the owner ("some data plans are not working
-- and some other bill payments; electricity tokens are not generated immediately"). Last 14 days. Aggregates and error
-- TEXT only; every run of 5+ digits (phone / meter numbers, references, tokens, PINs) is masked — CI logs are public.
-- No writes.
DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE '== A. outcome by category (14 days)';
  FOR r IN
    SELECT coalesce(category, '?') AS cat, count(*) AS n,
           count(*) FILTER (WHERE bill_status IN ('success', 'completed')) AS ok,
           count(*) FILTER (WHERE bill_status = 'failed') AS failed,
           count(*) FILTER (WHERE bill_status = 'pending') AS pending,
           count(*) FILTER (WHERE bill_status IS NULL OR bill_status NOT IN ('success', 'completed', 'failed', 'pending')) AS other
      FROM public.transactions
     WHERE payment_type = 'bill_payment' AND created_at > now() - interval '14 days'
     GROUP BY 1 ORDER BY n DESC
  LOOP
    RAISE NOTICE 'A % n=% ok=% failed=% pending=% other=%', r.cat, r.n, r.ok, r.failed, r.pending, r.other;
  END LOOP;

  RAISE NOTICE '== B. failure reasons (14 days)';
  FOR r IN
    SELECT coalesce(category, '?') AS cat,
           left(regexp_replace(coalesce(nullif(split_part(split_part(note, 'FAILED: ', 2), ' | PS:', 1), ''), '(no reason)'), '\d{5,}', '#', 'g'), 150) AS err,
           count(*) AS n, to_char(max(created_at), 'MM-DD HH24:MI') AS last
      FROM public.transactions
     WHERE payment_type = 'bill_payment' AND bill_status = 'failed' AND created_at > now() - interval '14 days'
     GROUP BY 1, 2 ORDER BY 1, n DESC
  LOOP
    RAISE NOTICE 'B % n=% last=% err=%', r.cat, r.n, r.last, r.err;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'part A/B failed: %', SQLERRM;
END $$;

DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE '== C. data by network and outcome (14 days); delivered plans from the note';
  FOR r IN
    SELECT coalesce(substring(note FROM 'Network: ([A-Za-z0-9]+)'), '?') AS net, bill_status AS st,
           left(regexp_replace(coalesce(substring(note FROM 'Plan: ([^|]+)'), '?'), '\d{5,}', '#', 'g'), 60) AS plan, count(*) AS n
      FROM public.transactions
     WHERE payment_type = 'bill_payment' AND category = 'data' AND created_at > now() - interval '14 days'
     GROUP BY 1, 2, 3 ORDER BY 1, 2, n DESC
  LOOP
    RAISE NOTICE 'C net=% st=% n=% plan=%', r.net, r.st, r.n, r.plan;
  END LOOP;
  RAISE NOTICE '== C2. card-paid bill intents (pending_bills) not fulfilled — the form shows the plan / service asked for';
  FOR r IN
    SELECT to_char(created_at, 'MM-DD HH24:MI') AS at, cat, status,
           coalesce(form_data->>'network', '') AS net, left(coalesce(form_data->>'planName', form_data->>'planId', form_data->>'disco', ''), 50) AS what,
           left(regexp_replace(coalesce(fulfillment::text, ''), '\d{5,}', '#', 'g'), 140) AS fulfil
      FROM public.pending_bills
     WHERE created_at > now() - interval '14 days' AND status <> 'fulfilled'
     ORDER BY created_at DESC LIMIT 25
  LOOP
    RAISE NOTICE 'C2 % % % net=% what=% fulfilment=%', r.at, r.cat, r.status, r.net, r.what, r.fulfil;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'part C failed: %', SQLERRM;
END $$;

DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE '== D. electricity: token on the record or not (14 days)';
  FOR r IN
    SELECT bill_status AS st,
           (coalesce(bill_details->>'token', '') <> '' OR note ~* 'token[: ]+[0-9]') AS has_token,
           (coalesce(bill_details->>'orderId', '') <> '') AS has_order,
           (note ~* 'postpaid') AS postpaid,
           count(*) AS n, to_char(max(created_at), 'MM-DD HH24:MI') AS last
      FROM public.transactions
     WHERE payment_type = 'bill_payment' AND category = 'electricity' AND created_at > now() - interval '14 days'
     GROUP BY 1, 2, 3, 4 ORDER BY 1, 2
  LOOP
    RAISE NOTICE 'D st=% token=% orderId=% postpaid=% n=% last=%', r.st, r.has_token, r.has_order, r.postpaid, r.n, r.last;
  END LOOP;
  RAISE NOTICE '== D2. last 12 electricity orders (shape only)';
  FOR r IN
    SELECT to_char(created_at, 'MM-DD HH24:MI') AS at, bill_status AS st, amount,
           (coalesce(bill_details->>'token', '') <> '') AS tok, coalesce(bill_details->>'units', '') <> '' AS units,
           left(regexp_replace(regexp_replace(coalesce(note, ''), '__PINS__.*$', ''), '\d{5,}', '#', 'g'), 150) AS note
      FROM public.transactions
     WHERE payment_type = 'bill_payment' AND category = 'electricity' AND created_at > now() - interval '14 days'
     ORDER BY created_at DESC LIMIT 12
  LOOP
    RAISE NOTICE 'D2 % % amt=% token=% units=% note=%', r.at, r.st, r.amount, r.tok, r.units, r.note;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'part D failed: %', SQLERRM;
END $$;

DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE '== E. payment-gate decisions that blocked or would block (14 days)';
  FOR r IN
    SELECT cat, reason, enforced, count(*) AS n, to_char(max(created_at), 'MM-DD HH24:MI') AS last
      FROM public.bill_gate_log WHERE created_at > now() - interval '14 days'
     GROUP BY 1, 2, 3 ORDER BY n DESC
  LOOP
    RAISE NOTICE 'E cat=% reason=% enforced=% n=% last=%', r.cat, r.reason, r.enforced, r.n, r.last;
  END LOOP;
  RAISE NOTICE '== F. which provider handled orders (14 days)';
  FOR r IN
    SELECT service, array_to_string(providers, '>') AS prov, count(*) AS n
      FROM public.bill_provider_attempts WHERE created_at > now() - interval '14 days' GROUP BY 1, 2 ORDER BY n DESC
  LOOP
    RAISE NOTICE 'F % % n=%', r.service, r.prov, r.n;
  END LOOP;
  RAISE NOTICE '== G. bill / provider admin alerts (7 days)';
  FOR r IN
    SELECT left(title, 90) AS title, count(*) AS n, to_char(max(created_at), 'MM-DD HH24:MI') AS last
      FROM public.admin_notifications
     WHERE created_at > now() - interval '7 days'
       AND (title ILIKE '%clubkonnect%' OR title ILIKE '%bill%' OR title ILIKE '%electric%' OR title ILIKE '%data%' OR title ILIKE '%vtpass%' OR title ILIKE '%provider%' OR title ILIKE '%token%')
     GROUP BY 1 ORDER BY n DESC LIMIT 20
  LOOP
    RAISE NOTICE 'G n=% last=% %', r.n, r.last, r.title;
  END LOOP;
  RAISE NOTICE 'readout time (UTC): %', to_char(now(), 'MM-DD HH24:MI');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'part E-G failed: %', SQLERRM;
END $$;
