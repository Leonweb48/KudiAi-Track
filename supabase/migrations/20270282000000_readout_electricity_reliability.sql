-- READ-ONLY diagnostic (2026-10-06): the owner finds ClubKonnect electricity unreliable and is choosing another
-- provider. How did electricity actually go over the last 60 days: delivered with a token on the spot, token only
-- later, no token, failed (and why), sales turned away before payment — by electricity company and meter type.
-- CI logs are public: counts, enums and dates ONLY. No note text, names, meter numbers, tokens, phone numbers or
-- references are printed (the 2026-10-01 leak) — free text is reduced to fixed labels with CASE. No writes.
DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE '== A. electricity orders by outcome (60 days)';
  FOR r IN
    WITH e AS (
      SELECT t.*,
        CASE
          WHEN t.bill_status = 'failed' AND coalesce((t.bill_details->>'provider_refunded')::boolean, false) THEN 'failed: provider refunded after accepting'
          WHEN t.bill_status = 'failed' THEN 'failed: refused at purchase'
          WHEN t.bill_status = 'pending' THEN 'still pending'
          WHEN t.bill_status IN ('success', 'completed') AND coalesce(t.bill_details->>'token_found_by', '') = 'sweep' THEN 'success: token found LATER by the sweep'
          WHEN t.bill_status IN ('success', 'completed') AND (coalesce(t.bill_details->>'token', '') <> '' OR t.note ~* 'token[: ]+[0-9]') THEN 'success: token in the app'
          WHEN t.bill_status IN ('success', 'completed') AND t.note ~* 'postpaid' THEN 'success: postpaid (no token expected)'
          WHEN t.bill_status IN ('success', 'completed') THEN 'success: PREPAID BUT NO TOKEN on record'
          ELSE 'other: ' || coalesce(t.bill_status, 'null')
        END AS outcome
      FROM public.transactions t
      WHERE t.payment_type = 'bill_payment' AND t.category = 'electricity' AND t.created_at > now() - interval '60 days'
    )
    SELECT outcome, count(*) AS n, count(DISTINCT user_id) AS customers,
           to_char(min(created_at), 'MM-DD') AS first, to_char(max(created_at), 'MM-DD') AS last
      FROM e GROUP BY 1 ORDER BY n DESC
  LOOP
    RAISE NOTICE 'A n=% customers=% first=% last=% | %', r.n, r.customers, r.first, r.last, r.outcome;
  END LOOP;

  RAISE NOTICE '== B. by electricity company and meter type (60 days)';
  FOR r IN
    WITH e AS (
      SELECT t.bill_status, t.bill_details, t.note,
        CASE
          WHEN t.note ~* 'Provider:[^|]*ikeja'                THEN 'Ikeja'
          WHEN t.note ~* 'Provider:[^|]*eko'                  THEN 'Eko'
          WHEN t.note ~* 'Provider:[^|]*abuja'                THEN 'Abuja'
          WHEN t.note ~* 'Provider:[^|]*kano'                 THEN 'Kano'
          WHEN t.note ~* 'Provider:[^|]*port ?harcourt|PHED' THEN 'Port Harcourt'
          WHEN t.note ~* 'Provider:[^|]*jos'                  THEN 'Jos'
          WHEN t.note ~* 'Provider:[^|]*ibadan'               THEN 'Ibadan'
          WHEN t.note ~* 'Provider:[^|]*kaduna'               THEN 'Kaduna'
          WHEN t.note ~* 'Provider:[^|]*enugu'                THEN 'Enugu'
          WHEN t.note ~* 'Provider:[^|]*benin'                THEN 'Benin'
          WHEN t.note ~* 'Provider:[^|]*yola'                 THEN 'Yola'
          WHEN t.note ~* 'Provider:[^|]*aba'                  THEN 'Aba'
          ELSE 'unknown'
        END AS disco,
        CASE WHEN t.note ~* 'Type:[^|]*postpaid' THEN 'postpaid' WHEN t.note ~* 'Type:[^|]*prepaid' THEN 'prepaid' ELSE '?' END AS mtype
      FROM public.transactions t
      WHERE t.payment_type = 'bill_payment' AND t.category = 'electricity' AND t.created_at > now() - interval '60 days'
    )
    SELECT disco, mtype, count(*) AS n,
           count(*) FILTER (WHERE bill_status IN ('success', 'completed') AND (coalesce(bill_details->>'token', '') <> '' OR note ~* 'token[: ]+[0-9]')) AS with_token,
           count(*) FILTER (WHERE bill_status IN ('success', 'completed') AND coalesce(bill_details->>'token_found_by', '') = 'sweep') AS late_token,
           count(*) FILTER (WHERE bill_status = 'failed') AS failed,
           count(*) FILTER (WHERE bill_status = 'pending') AS pending
      FROM e GROUP BY 1, 2 ORDER BY n DESC
  LOOP
    RAISE NOTICE 'B % % n=% token=% (late=%) failed=% pending=%', r.disco, r.mtype, r.n, r.with_token, r.late_token, r.failed, r.pending;
  END LOOP;

  RAISE NOTICE '== C. why electricity orders failed (60 days) — reasons reduced to fixed labels';
  FOR r IN
    SELECT CASE
             WHEN coalesce((bill_details->>'provider_refunded')::boolean, false) OR note ~* 'REFUND|899|REVERS' THEN 'ClubKonnect refunded the order (no token)'
             WHEN note ~* 'CANCEL'                                          THEN 'cancelled'
             WHEN note ~* 'INSUFFICIENT|WALLET|LOW BAL'                     THEN 'ClubKonnect wallet too low'
             WHEN note ~* 'CREDENTIAL|INVALID_KEY|UNAUTHOR|INVALID USER'    THEN 'ClubKonnect rejected our key'
             WHEN note ~* 'METER|CUSTOMER|ACCOUNT' AND note ~* 'INVALID|NOT FOUND|WRONG' THEN 'invalid meter / customer'
             WHEN note ~* 'MINIMUM|LESS THAN|BELOW|TOO LOW|AMOUNT'          THEN 'amount below the company minimum'
             WHEN note ~* 'UNAVAILABLE|503|502|500|IIS|HTML|DOWN|MAINTEN'   THEN 'service down / unavailable'
             WHEN note ~* 'TIMEOUT|TIMED OUT|NETWORK|FETCH'                 THEN 'timeout / connection'
             WHEN note ~* 'PAYMENT|GATE'                                    THEN 'payment check refused'
             ELSE 'other'
           END AS reason,
           count(*) AS n, to_char(max(created_at), 'MM-DD') AS last
      FROM public.transactions
     WHERE payment_type = 'bill_payment' AND category = 'electricity' AND bill_status = 'failed' AND created_at > now() - interval '60 days'
     GROUP BY 1 ORDER BY n DESC
  LOOP
    RAISE NOTICE 'C n=% last=% | %', r.n, r.last, r.reason;
  END LOOP;

  RAISE NOTICE '== D. electricity orders per week (60 days)';
  FOR r IN
    SELECT to_char(date_trunc('week', created_at), 'MM-DD') AS wk, count(*) AS n,
           count(*) FILTER (WHERE bill_status IN ('success', 'completed')) AS ok,
           count(*) FILTER (WHERE bill_status = 'failed') AS failed,
           count(*) FILTER (WHERE bill_status = 'pending') AS pending
      FROM public.transactions
     WHERE payment_type = 'bill_payment' AND category = 'electricity' AND created_at > now() - interval '60 days'
     GROUP BY 1 ORDER BY 1
  LOOP
    RAISE NOTICE 'D week of % n=% ok=% failed=% pending=%', r.wk, r.n, r.ok, r.failed, r.pending;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'part A-D failed: %', SQLERRM;
END $$;

DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE '== E. electricity purchases started vs recorded (60 days): payment-check claims by verdict';
  FOR r IN
    SELECT verdict, count(*) AS n, to_char(max(created_at), 'MM-DD') AS last
      FROM public.bill_gate_claims WHERE cat = 'electricity' AND created_at > now() - interval '60 days'
     GROUP BY 1 ORDER BY n DESC
  LOOP
    RAISE NOTICE 'E verdict=% n=% last=%', r.verdict, r.n, r.last;
  END LOOP;
  FOR r IN
    SELECT reason, enforced, count(*) AS n FROM public.bill_gate_log
     WHERE cat = 'electricity' AND created_at > now() - interval '60 days' GROUP BY 1, 2 ORDER BY n DESC
  LOOP
    RAISE NOTICE 'E gate reason=% enforced=% n=%', r.reason, r.enforced, r.n;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'part E failed: %', SQLERRM;
END $$;

DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE '== F. admin alerts about ClubKonnect / electricity (60 days) — fixed labels';
  FOR r IN
    SELECT CASE
             WHEN title ILIKE '%bill sales paused%'                    THEN 'ClubKonnect down - bill sales paused'
             WHEN title ILIKE '%wallet too low%' OR title ILIKE '%Low Bill-Payment Wallet%' THEN 'ClubKonnect wallet too low'
             WHEN title ILIKE '%Electricity order needs a manual refund%' THEN 'electricity: manual refund needed'
             WHEN title ILIKE '%Electricity token still missing%'      THEN 'electricity: token missing after 48 h'
             WHEN title ILIKE '%unconfirmed%electric%'                 THEN 'electricity: order unconfirmed (held)'
             WHEN title ILIKE '%Service wallet failure%electric%'      THEN 'electricity: service wallet failure'
             WHEN title ILIKE '%backup route%' OR title ILIKE '%main AND backup%' THEN 'ClubKonnect route down'
             WHEN title ILIKE '%order held%'                           THEN 'ClubKonnect order held'
             ELSE NULL
           END AS label,
           count(*) AS n, to_char(max(created_at), 'MM-DD') AS last
      FROM public.admin_notifications
     WHERE created_at > now() - interval '60 days'
     GROUP BY 1
     ORDER BY n DESC
  LOOP
    IF r.label IS NOT NULL THEN RAISE NOTICE 'F n=% last=% | %', r.n, r.last, r.label; END IF;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'part F failed: %', SQLERRM;
END $$;
