-- READ-ONLY (2026-10-16): health check before the Client Masterclass. Since 13 Oct: bills by status (business vs client),
-- wallet bill charges still pending > 30 min, bank transfers out by status, deposits credited, Ajo client withdrawal
-- requests by status, invites by status. Counts/statuses only (CI logs are public). No writes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT CASE WHEN t.user_id IN (SELECT client_user_id FROM public.aso_clients WHERE client_user_id IS NOT NULL) THEN 'client' ELSE 'business' END who,
           coalesce(t.bill_status, '?') st, count(*) n
      FROM public.transactions t
     WHERE t.payment_type = 'bill_payment' AND t.created_at > '2026-10-13'
     GROUP BY 1, 2 ORDER BY 1, 2
  LOOP
    RAISE NOTICE 'H1 bills % % = %', r.who, r.st, r.n;
  END LOOP;
  RAISE NOTICE 'H2 wallet bill charges pending > 30 min: %',
    (SELECT count(*) FROM public.wallet_ledger l WHERE l.source = 'bill_spend' AND l.status = 'pending' AND l.created_at < now() - interval '30 minutes');
  FOR r IN SELECT w.status, count(*) n FROM public.wallet_withdrawals w WHERE w.created_at > '2026-10-13' GROUP BY 1 ORDER BY 1 LOOP
    RAISE NOTICE 'H3 bank transfers out % = %', r.status, r.n;
  END LOOP;
  RAISE NOTICE 'H4 transfers stuck processing > 2 h: %',
    (SELECT count(*) FROM public.wallet_withdrawals w WHERE w.status IN ('processing', 'pending') AND w.created_at < now() - interval '2 hours');
  FOR r IN SELECT l.source, l.status, count(*) n FROM public.wallet_ledger l
            WHERE l.created_at > '2026-10-13' AND l.source IN ('deposit', 'ajo_contribution', 'ajo_withdrawal', 'referral_reward')
            GROUP BY 1, 2 ORDER BY 1, 2 LOOP
    RAISE NOTICE 'H5 ledger % % = %', r.source, r.status, r.n;
  END LOOP;
  FOR r IN SELECT coalesce(c.status, '?') st, count(*) n FROM public.ajo_contributions c
            WHERE c.created_at > '2026-10-13' AND c.type = 'withdrawal' GROUP BY 1 ORDER BY 1 LOOP
    RAISE NOTICE 'H6 Ajo withdrawals % = %', r.st, r.n;
  END LOOP;
  FOR r IN SELECT i.status, count(*) n FROM public.invites i GROUP BY 1 ORDER BY 1 LOOP
    RAISE NOTICE 'H7 invites % = %', r.status, r.n;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
