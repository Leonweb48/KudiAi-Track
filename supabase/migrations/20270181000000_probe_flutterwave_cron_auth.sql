-- Proves the repaired cron authentication on the LIVE system. Fires the two cron-only flutterwave actions exactly as the SQL cron jobs
-- do (Vault cron_secret in x-cron-secret), with a random id / an unknown user so NOTHING can happen:
--   process-scheduled-transfer (random id)     -> expect HTTP 404 "Scheduled transfer not found"   (was 401 Unauthorized before the fix)
--   send-ajo-payout-email      (unknown user)   -> expect HTTP 200 {"ok":true,"sent":false,...}      (was 401 Unauthorized before the fix)
-- The answers are read by the NEXT migration (pg_net delivers after this transaction commits).
DO $$
DECLARE v_secret text; v_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret';
  IF v_secret IS NULL THEN RAISE NOTICE 'PROBE no cron_secret in Vault'; RETURN; END IF;

  SELECT net.http_post(
    url     := 'https://eztohcuzbxxxvnondxfz.supabase.co/functions/v1/flutterwave',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body    := jsonb_build_object('action', 'process-scheduled-transfer', 'scheduled_transfer_id', gen_random_uuid()),
    timeout_milliseconds := 30000
  ) INTO v_id;
  RAISE NOTICE 'PROBE-1 process-scheduled-transfer (random id) = request %', v_id;

  SELECT net.http_post(
    url     := 'https://eztohcuzbxxxvnondxfz.supabase.co/functions/v1/flutterwave',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body    := jsonb_build_object('action', 'send-ajo-payout-email', 'client_user_id', gen_random_uuid(), 'amount_kobo', 100),
    timeout_milliseconds := 30000
  ) INTO v_id;
  RAISE NOTICE 'PROBE-2 send-ajo-payout-email (unknown user) = request %', v_id;
END $$;
