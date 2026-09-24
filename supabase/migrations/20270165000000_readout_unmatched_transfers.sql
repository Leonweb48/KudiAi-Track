-- READ-ONLY diagnostic (no writes): were any Flutterwave TRANSFERS made that the app did not initiate?
--
-- Context: until the security fix in this same change set, the `flutterwave` function accepted an unsigned token that
-- merely claimed role=service_role, so `disburse` (a bank payout) was reachable without credentials. If anyone used it,
-- Flutterwave would have sent transfer webhooks for payouts whose reference is not one of our wallet_withdrawals ids.
-- This lists exactly those. (A payout made by hand in the Flutterwave dashboard also shows up here — compare the amounts
-- and dates against what was done by hand.) Recipient details are not printed.
-- Read with:  gh run view <id> --log | grep NOTICE
DO $$
DECLARE r record; n_all bigint; n_unmatched bigint;
BEGIN
  SELECT count(*) INTO n_all FROM public.wallet_webhook_log WHERE event LIKE 'transfer.%';
  SELECT count(*) INTO n_unmatched
    FROM public.wallet_webhook_log l
   WHERE l.event LIKE 'transfer.%'
     AND NOT EXISTS (SELECT 1 FROM public.wallet_withdrawals w
                      WHERE w.id::text = l.payload -> 'data' ->> 'reference'
                         OR w.flw_transfer_id = l.payload -> 'data' ->> 'id');
  RAISE NOTICE 'transfer webhooks received: % — with NO matching wallet withdrawal: %', n_all, n_unmatched;

  FOR r IN
    SELECT l.processed_at, l.event,
           l.payload -> 'data' ->> 'reference' AS reference,
           l.payload -> 'data' ->> 'status'    AS status,
           l.payload -> 'data' -> 'amount' ->> 'value' AS amount_value,
           l.payload -> 'data' ->> 'amount'    AS amount_plain
      FROM public.wallet_webhook_log l
     WHERE l.event LIKE 'transfer.%'
       AND NOT EXISTS (SELECT 1 FROM public.wallet_withdrawals w
                        WHERE w.id::text = l.payload -> 'data' ->> 'reference'
                           OR w.flw_transfer_id = l.payload -> 'data' ->> 'id')
     ORDER BY l.processed_at DESC LIMIT 15
  LOOP
    RAISE NOTICE 'unmatched at=% event=% status=% amount=% reference=%',
      r.processed_at, r.event, r.status, COALESCE(r.amount_value, r.amount_plain), r.reference;
  END LOOP;

  RAISE NOTICE 'withdrawals rows whose transfer never got a Flutterwave id: %',
    (SELECT count(*) FROM public.wallet_withdrawals WHERE flw_transfer_id IS NULL AND status IN ('successful', 'processing', 'pending'));
END $$;
