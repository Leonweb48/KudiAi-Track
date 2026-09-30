-- READ-ONLY diagnostic (2026-09-30): bills reported working on the web but not in the Android app. Every bill attempt, gate
-- decision, provider claim, pending Paystack bill and wallet bill debit of the last 5 hours, in 15-minute buckets. Aggregates
-- and error TEXT only — digit runs (phone / meter numbers, references) are masked — because CI logs are public. No writes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT to_char(date_bin('15 minutes', created_at, '2026-01-01'), 'HH24:MI') AS hr, coalesce(category, '?') AS cat, coalesce(bill_status, '?') AS st,
           left(regexp_replace(coalesce(nullif(split_part(split_part(note, 'FAILED: ', 2), ' | PS:', 1), ''), '-'), '\d{5,}', '#', 'g'), 110) AS err,
           count(*) AS n
      FROM public.transactions
     WHERE payment_type = 'bill_payment' AND created_at > now() - interval '5 hours'
     GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3
  LOOP
    RAISE NOTICE 'bill txn % cat=% status=% n=% err=%', r.hr, r.cat, r.st, r.n, r.err;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'part A (transactions) failed: %', SQLERRM;
END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT to_char(date_bin('15 minutes', created_at, '2026-01-01'), 'HH24:MI') AS hr, cat, reason, enforced, count(*) AS n
      FROM public.bill_gate_log WHERE created_at > now() - interval '5 hours' GROUP BY 1, 2, 3, 4 ORDER BY 1, 2
  LOOP
    RAISE NOTICE 'gate % cat=% reason=% enforced=% n=%', r.hr, r.cat, r.reason, r.enforced, r.n;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'part B (bill_gate_log) failed: %', SQLERRM;
END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT to_char(date_bin('15 minutes', created_at, '2026-01-01'), 'HH24:MI') AS hr, service, array_to_string(providers, '>') AS prov, count(*) AS n
      FROM public.bill_provider_attempts WHERE created_at > now() - interval '5 hours' GROUP BY 1, 2, 3 ORDER BY 1, 2
  LOOP
    RAISE NOTICE 'claims % service=% providers=% n=%', r.hr, r.service, r.prov, r.n;
  END LOOP;
  FOR r IN
    SELECT to_char(date_bin('15 minutes', created_at, '2026-01-01'), 'HH24:MI') AS hr, status, count(*) AS n
      FROM public.pending_bills WHERE created_at > now() - interval '5 hours' GROUP BY 1, 2 ORDER BY 1, 2
  LOOP
    RAISE NOTICE 'pending_bills % status=% n=%', r.hr, r.status, r.n;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'part C (claims / pending) failed: %', SQLERRM;
END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT to_char(date_bin('15 minutes', created_at, '2026-01-01'), 'HH24:MI') AS hr, source, status, count(*) AS n
      FROM public.wallet_ledger WHERE source IN ('bill_spend', 'bill_reversal') AND created_at > now() - interval '5 hours'
     GROUP BY 1, 2, 3 ORDER BY 1, 2
  LOOP
    RAISE NOTICE 'wallet ledger % source=% status=% n=%', r.hr, r.source, r.status, r.n;
  END LOOP;
  FOR r IN
    SELECT to_char(created_at, 'HH24:MI') AS at, left(title, 80) AS title, left(regexp_replace(regexp_replace(message, '\s+', ' ', 'g'), '\d{5,}', '#', 'g'), 150) AS msg
      FROM public.admin_notifications
     WHERE created_at > now() - interval '5 hours'
       AND (title ILIKE '%clubkonnect%' OR title ILIKE '%bill%' OR title ILIKE '%wallet%' OR title ILIKE '%vtpass%' OR title ILIKE '%provider%')
     ORDER BY created_at DESC LIMIT 12
  LOOP
    RAISE NOTICE 'admin alert % % — %', r.at, r.title, r.msg;
  END LOOP;
  RAISE NOTICE 'readout time (UTC): %', to_char(now(), 'YYYY-MM-DD HH24:MI');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'part D (ledger / alerts) failed: %', SQLERRM;
END $$;
