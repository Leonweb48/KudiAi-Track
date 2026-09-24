-- READ-ONLY diagnostic (no writes): the provider_response / debit_information of the most recent FAILED transfer webhooks.
-- (payment_information — the recipient — is NOT printed.) Read with:  gh run view <id> --log | grep NOTICE
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT processed_at, payload -> 'data' AS d
      FROM public.wallet_webhook_log
     WHERE event = 'transfer.disburse' AND payload -> 'data' ->> 'status' = 'FAILED'
     ORDER BY processed_at DESC LIMIT 3
  LOOP
    RAISE NOTICE '% | provider_response=% | debit_information=%', r.processed_at, r.d -> 'provider_response', r.d -> 'debit_information';
  END LOOP;
END $$;
