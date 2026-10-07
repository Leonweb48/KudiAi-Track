-- READ-ONLY diagnostic (2026-10-07): the starting point for the go-to-market plan — how many businesses, paying plans,
-- savers, wallets, marketers and how much activity there is today, plus the live plan prices and marketer commission
-- settings. CI logs are public: COUNTS and configuration only — no names, emails, ids, balances or amounts. No writes.

DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE '== A. subscription plans (live configuration)';
  FOR r IN
    SELECT (SELECT jsonb_object_agg(k, v) FROM jsonb_each(to_jsonb(p)) AS e(k, v)
             WHERE k ~* '(slug|^name|price|monthly|yearly|annual|active|discount)') AS cfg
      FROM public.subscription_plans p
  LOOP
    RAISE NOTICE 'A %', r.cfg;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'part A failed: %', SQLERRM;
END $$;

DO $$
DECLARE n bigint; n7 bigint; n30 bigint; n90 bigint; a7 bigint; a30 bigint;
BEGIN
  RAISE NOTICE '== B. businesses';
  SELECT count(*), count(*) FILTER (WHERE created_at > now() - interval '7 days'),
         count(*) FILTER (WHERE created_at > now() - interval '30 days'), count(*) FILTER (WHERE created_at > now() - interval '90 days')
    INTO n, n7, n30, n90
    FROM public.profiles WHERE coalesce(business_name, '') <> '';
  SELECT count(DISTINCT user_id) FILTER (WHERE created_at > now() - interval '7 days'),
         count(DISTINCT user_id) FILTER (WHERE created_at > now() - interval '30 days')
    INTO a7, a30 FROM public.transactions WHERE created_at > now() - interval '30 days';
  RAISE NOTICE 'B registered=% new_7d=% new_30d=% new_90d=% | recorded_a_transaction_7d=% 30d=%', n, n7, n30, n90, a7, a30;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'part B failed: %', SQLERRM;
END $$;

DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE '== C. active subscriptions by plan';
  FOR r IN SELECT coalesce(plan, '?') AS plan, count(*) AS n FROM public.subscriptions WHERE status = 'active' GROUP BY 1 ORDER BY n DESC
  LOOP RAISE NOTICE 'C plan=% n=%', r.plan, r.n; END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'part C failed: %', SQLERRM;
END $$;

DO $$
DECLARE r record; n bigint; n30 bigint; portal bigint;
BEGIN
  RAISE NOTICE '== D. Ajo / Esusu savers (clients)';
  SELECT count(*), count(*) FILTER (WHERE created_at > now() - interval '30 days'), count(*) FILTER (WHERE client_user_id IS NOT NULL)
    INTO n, n30, portal FROM public.aso_clients;
  RAISE NOTICE 'D clients=% new_30d=% with_own_login=%', n, n30, portal;
  FOR r IN SELECT coalesce(status, '?') AS st, count(*) AS n FROM public.aso_clients GROUP BY 1 ORDER BY n DESC
  LOOP RAISE NOTICE 'D status=% n=%', r.st, r.n; END LOOP;
  SELECT count(DISTINCT user_id) INTO n FROM public.aso_clients;
  RAISE NOTICE 'D businesses_with_any_client=%', n;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'part D failed: %', SQLERRM;
END $$;

DO $$
DECLARE n bigint; with_acct bigint; n30 bigint;
BEGIN
  RAISE NOTICE '== E. wallets';
  SELECT count(*), count(*) FILTER (WHERE coalesce(to_jsonb(w)->>'account_number', '') <> ''),
         count(*) FILTER (WHERE (to_jsonb(w)->>'created_at')::timestamptz > now() - interval '30 days')
    INTO n, with_acct, n30 FROM public.wallets w;
  RAISE NOTICE 'E wallets=% with_account_number=% new_30d=%', n, with_acct, n30;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'part E failed: %', SQLERRM;
END $$;

DO $$
DECLARE r record; n bigint;
BEGIN
  RAISE NOTICE '== F. marketers';
  FOR r IN SELECT coalesce(status, '?') AS st, count(*) AS n FROM public.brm_marketers GROUP BY 1 ORDER BY n DESC
  LOOP RAISE NOTICE 'F marketers status=% n=%', r.st, r.n; END LOOP;
  SELECT count(*) INTO n FROM public.business_claims;   RAISE NOTICE 'F business_claims=%', n;
  SELECT count(*) INTO n FROM public.brm_clients;       RAISE NOTICE 'F brm_clients=%', n;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'part F failed: %', SQLERRM;
END $$;

DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE '== G. commission / referral / pricing settings (platform_config keys and values)';
  FOR r IN
    SELECT key, left(value, 160) AS value FROM public.platform_config
     WHERE key ~* '(commission|marketer|referral|referr|bonus|transfer_fee|free_transfer|plan_price|trial)'
       AND key !~* '(secret|token|key|password|passwd|hash|salt|jwt|cred|auth)'
       AND value !~ '[A-Za-z0-9_\-]{32,}'   -- nothing that looks like a key, even under an innocent name
     ORDER BY key
  LOOP RAISE NOTICE 'G % = %', r.key, r.value; END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'part G failed: %', SQLERRM;
END $$;

DO $$
DECLARE r record; n bigint;
BEGIN
  RAISE NOTICE '== H. activity, last 30 days (counts)';
  FOR r IN
    SELECT coalesce(category, '?') AS cat, count(*) AS n FROM public.transactions
     WHERE payment_type = 'bill_payment' AND created_at > now() - interval '30 days' AND bill_status IN ('success', 'completed')
     GROUP BY 1 ORDER BY n DESC
  LOOP RAISE NOTICE 'H bills % n=%', r.cat, r.n; END LOOP;
  SELECT count(*) INTO n FROM public.transactions WHERE created_at > now() - interval '30 days' AND coalesce(payment_type, '') <> 'bill_payment';
  RAISE NOTICE 'H sales_and_expenses_recorded=%', n;
  FOR r IN SELECT coalesce(type, '?') AS t, count(*) AS n FROM public.wallet_ledger WHERE created_at > now() - interval '30 days' GROUP BY 1 ORDER BY n DESC LIMIT 12
  LOOP RAISE NOTICE 'H wallet_ledger % n=%', r.t, r.n; END LOOP;
  SELECT count(*) INTO n FROM public.ajo_contributions WHERE created_at > now() - interval '30 days';
  RAISE NOTICE 'H ajo_contributions=%', n;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'part H failed: %', SQLERRM;
END $$;
