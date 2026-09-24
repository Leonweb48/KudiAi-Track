-- READ-ONLY diagnostic (no writes): what happened to the wallet of solomonleonjohnson01@gmail.com during the Flutterwave dry run?
-- Prints the wallet's account fields (only the last 4 digits of account numbers), its recent withdrawals (recipient number / name
-- removed), recent ledger rows and the latest webhook events (type, time, status — no payloads). Read with:
--   gh run view <id> --log | grep NOTICE
DO $$
DECLARE
  uid uuid; w record; r record; n int;
BEGIN
  SELECT id INTO uid FROM auth.users WHERE lower(email) = 'solomonleonjohnson01@gmail.com' LIMIT 1;
  RAISE NOTICE 'user found: %', uid IS NOT NULL;
  IF uid IS NULL THEN RETURN; END IF;

  SELECT * INTO w FROM public.wallets WHERE user_id = uid;
  IF NOT FOUND THEN RAISE NOTICE 'no wallet row'; RETURN; END IF;
  RAISE NOTICE 'wallet: flw_account=% balance_kobo=% status=% number_tail=% bank=% customer_id_set=% va_id_set=% legacy_number_tail=% legacy_migrated_at=% notified_at=% emailed_at=%',
    w.flw_account, w.balance_kobo, w.status, right(coalesce(w.flw_account_number, ''), 4), w.flw_account_bank,
    w.flw_customer_id IS NOT NULL, w.flw_virtual_account_id IS NOT NULL,
    right(coalesce(w.legacy_flw_account_number, ''), 4), w.legacy_migrated_at, w.migration_notified_at, w.migration_emailed_at;

  n := 0;
  FOR r IN SELECT to_jsonb(x) - 'account_number' - 'account_name' - 'bank_code' AS j
             FROM public.wallet_withdrawals x WHERE x.user_id = uid ORDER BY x.created_at DESC LIMIT 6 LOOP
    n := n + 1; RAISE NOTICE 'withdrawal %: %', n, r.j;
  END LOOP;

  n := 0;
  FOR r IN SELECT l.created_at, l.source, l.direction, l.status, l.amount_kobo, left(coalesce(l.narration, ''), 80) AS narration
             FROM public.wallet_ledger l WHERE l.user_id = uid ORDER BY l.created_at DESC LIMIT 8 LOOP
    n := n + 1; RAISE NOTICE 'ledger %: % % % % % kobo | %', n, r.created_at, r.source, r.direction, r.status, r.amount_kobo, r.narration;
  END LOOP;

  n := 0;
  FOR r IN SELECT processed_at, event, payload -> 'data' ->> 'status' AS status, left(coalesce(payload -> 'data' ->> 'reference', ''), 12) AS ref
             FROM public.wallet_webhook_log ORDER BY processed_at DESC LIMIT 8 LOOP
    n := n + 1; RAISE NOTICE 'webhook %: % % status=% ref=%', n, r.processed_at, r.event, r.status, r.ref;
  END LOOP;
END $$;
