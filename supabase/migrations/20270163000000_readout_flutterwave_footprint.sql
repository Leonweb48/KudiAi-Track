-- READ-ONLY diagnostic (no writes): how much of production is tied to the CURRENT Flutterwave account —
-- test/live flags, wallets with virtual accounts, money sitting in wallets, in-flight transfers and bills.
-- No names or account numbers are printed. Read with:  gh run view <id> --log | grep NOTICE
DO $$
DECLARE r record;
BEGIN
  BEGIN
    RAISE NOTICE '── platform_config flags ──';
    FOR r IN SELECT key, value FROM public.platform_config
              WHERE key IN ('wallet_enabled','wallet_test_mode','bvn_verification_enabled','flw_bills_enabled','wallet_max_balance_kobo')
              ORDER BY key
    LOOP RAISE NOTICE '%=%', r.key, r.value; END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'flags block failed: %', SQLERRM; END;

  BEGIN
    RAISE NOTICE '── wallets ──';
    RAISE NOTICE 'total=% with_virtual_account=% with_customer_id=% funded(balance>0)=% total_balance_ngn=% max_balance_ngn=%',
      (SELECT count(*) FROM public.wallets),
      (SELECT count(*) FROM public.wallets WHERE flw_account_number IS NOT NULL),
      (SELECT count(*) FROM public.wallets WHERE flw_customer_id IS NOT NULL),
      (SELECT count(*) FROM public.wallets WHERE balance_kobo > 0),
      (SELECT COALESCE(sum(balance_kobo),0)/100.0 FROM public.wallets),
      (SELECT COALESCE(max(balance_kobo),0)/100.0 FROM public.wallets);
    RAISE NOTICE 'by holder: business_owners=% ajo_clients=% staff=%',
      (SELECT count(*) FROM public.wallets w WHERE EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = w.user_id)),
      (SELECT count(*) FROM public.wallets w WHERE EXISTS (SELECT 1 FROM public.aso_clients c WHERE c.client_user_id = w.user_id)),
      (SELECT count(*) FROM public.wallets w WHERE EXISTS (SELECT 1 FROM public.staff s WHERE s.user_id = w.user_id));
    FOR r IN SELECT COALESCE(flw_account_bank,'(none)') AS bank, count(*) AS n FROM public.wallets GROUP BY 1 ORDER BY 2 DESC LIMIT 5
    LOOP RAISE NOTICE 'va bank=% wallets=%', r.bank, r.n; END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'wallets block failed: %', SQLERRM; END;

  BEGIN
    RAISE NOTICE '── ledger (money that actually moved) ──';
    FOR r IN SELECT source, direction, count(*) AS n, COALESCE(sum(amount_kobo),0)/100.0 AS ngn, min(created_at) AS first_at, max(created_at) AS last_at
               FROM public.wallet_ledger GROUP BY source, direction ORDER BY 3 DESC LIMIT 14
    LOOP RAISE NOTICE 'source=% dir=% rows=% ngn=% first=% last=%', r.source, r.direction, r.n, r.ngn, r.first_at, r.last_at; END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'ledger block failed: %', SQLERRM; END;

  BEGIN
    RAISE NOTICE '── webhooks received from Flutterwave ──';
    FOR r IN SELECT event, count(*) AS n, min(created_at) AS first_at, max(created_at) AS last_at FROM public.wallet_webhook_log GROUP BY event ORDER BY 2 DESC LIMIT 8
    LOOP RAISE NOTICE 'event=% count=% first=% last=%', r.event, r.n, r.first_at, r.last_at; END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'webhook block failed: %', SQLERRM; END;

  BEGIN
    RAISE NOTICE '── in flight ──';
    FOR r IN SELECT status, count(*) AS n, COALESCE(sum(amount_kobo),0)/100.0 AS ngn FROM public.wallet_withdrawals GROUP BY status ORDER BY 2 DESC
    LOOP RAISE NOTICE 'withdrawals status=% count=% ngn=%', r.status, r.n, r.ngn; END LOOP;
    RAISE NOTICE 'pending wallet_payment_requests=%', (SELECT count(*) FROM public.wallet_payment_requests WHERE status = 'pending');
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'in-flight block failed: %', SQLERRM; END;

  BEGIN
    RAISE NOTICE 'pending_bills (all statuses): %', (SELECT string_agg(status || '=' || n, ', ') FROM (SELECT status, count(*) AS n FROM public.pending_bills GROUP BY status) x);
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pending_bills block failed: %', SQLERRM; END;
END $$;
