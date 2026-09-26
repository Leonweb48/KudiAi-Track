-- READ-ONLY diagnostic: which KEYS the provider responses stored in pending_bills.fulfillment contain (names only — no values, no counts, no identifiers).
-- Read with:  gh run view <id> --log | grep NOTICE
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT cat, string_agg(DISTINCT k, ', ' ORDER BY k) AS keys
             FROM (SELECT cat, jsonb_object_keys(fulfillment) AS k FROM public.pending_bills WHERE jsonb_typeof(fulfillment) = 'object') s
            GROUP BY cat ORDER BY cat
  LOOP RAISE NOTICE 'FULFIL top-level keys | cat=% | %', r.cat, r.keys; END LOOP;
  FOR r IN SELECT DISTINCT cat, k FROM (SELECT cat, jsonb_object_keys(fulfillment -> 'raw') AS k FROM public.pending_bills WHERE jsonb_typeof(fulfillment -> 'raw') = 'object') s ORDER BY 1, 2
  LOOP RAISE NOTICE 'FULFIL raw key | cat=% | %', r.cat, r.k; END LOOP;
  FOR r IN SELECT DISTINCT k FROM (SELECT jsonb_object_keys(form_data) AS k FROM public.pending_bills WHERE jsonb_typeof(form_data) = 'object') s ORDER BY 1
  LOOP RAISE NOTICE 'FORM_DATA key | %', r.k; END LOOP;
  FOR r IN SELECT DISTINCT k FROM (SELECT jsonb_object_keys(meta) AS k FROM public.wallet_ledger WHERE source IN ('bill_spend', 'bill_reversal', 'subscription_spend', 'transfer_fee', 'wallet_fee') AND jsonb_typeof(meta) = 'object') s ORDER BY 1
  LOOP RAISE NOTICE 'LEDGER meta key | %', r.k; END LOOP;
  RAISE NOTICE 'wallet_withdrawals statuses: %', (SELECT string_agg(DISTINCT status, ', ') FROM public.wallet_withdrawals);
  RAISE NOTICE 'partner_commission_records statuses: %', (SELECT string_agg(DISTINCT status, ', ') FROM public.partner_commission_records);
  RAISE NOTICE 'marketer_commissions statuses: %', (SELECT string_agg(DISTINCT status, ', ') FROM public.marketer_commissions);
  RAISE NOTICE 'marketer_commissions event types: %', (SELECT string_agg(DISTINCT event_type, ', ') FROM public.marketer_commissions);
  RAISE NOTICE 'subscriptions statuses: %', (SELECT string_agg(DISTINCT status, ', ') FROM public.subscriptions);
  RAISE NOTICE 'transactions bill_status values: %', (SELECT string_agg(DISTINCT bill_status, ', ') FROM public.transactions WHERE payment_type = 'bill_payment');
  RAISE NOTICE 'sms_log statuses: %', (SELECT string_agg(DISTINCT status, ', ') FROM public.sms_log);
  RAISE NOTICE 'referral reward types: %', (SELECT string_agg(DISTINCT reward_type, ', ') FROM public.referrals);
  RAISE NOTICE 'wallet_ledger statuses: %', (SELECT string_agg(DISTINCT status, ', ') FROM public.wallet_ledger);
END $$;
