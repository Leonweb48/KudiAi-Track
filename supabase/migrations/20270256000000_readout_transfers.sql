-- READ-ONLY diagnostic (2026-10-02): "transfers stopped going through". Wallet → bank transfers of the last 7 days:
-- outcome per day, why the failed ones failed (reason text with every 4+ digit run masked — CI logs are public), ones
-- still waiting on Flutterwave, the last success, and the transfer webhooks received. No names, numbers, amounts per
-- person or references. No writes.
DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE '== W1. transfers per day (UTC) and status, last 7 days';
  FOR r IN
    SELECT to_char(created_at, 'MM-DD') AS d, status, count(*) AS n,
           count(*) FILTER (WHERE flw_transfer_id IS NOT NULL AND flw_transfer_id <> '') AS with_flw_id
      FROM public.wallet_withdrawals
     WHERE created_at > now() - interval '7 days'
     GROUP BY 1, 2 ORDER BY 1, 2
  LOOP
    RAISE NOTICE 'W1 % % n=% with_flw_id=%', r.d, r.status, r.n, r.with_flw_id;
  END LOOP;

  RAISE NOTICE '== W2. last successful / last failed / last created (UTC)';
  SELECT to_char(max(created_at) FILTER (WHERE status = 'successful'), 'MM-DD HH24:MI') AS ok,
         to_char(max(created_at) FILTER (WHERE status = 'failed'), 'MM-DD HH24:MI') AS failed,
         to_char(max(created_at), 'MM-DD HH24:MI') AS last
    INTO r FROM public.wallet_withdrawals;
  RAISE NOTICE 'W2 last_successful=% last_failed=% last_created=%', r.ok, r.failed, r.last;

  RAISE NOTICE '== W3. why they failed (refund narration), last 7 days';
  FOR r IN
    SELECT left(regexp_replace(coalesce(l.narration, '(none)'), '\d{4,}', '#', 'g'), 220) AS why, count(*) AS n,
           to_char(min(l.created_at), 'MM-DD HH24:MI') AS first, to_char(max(l.created_at), 'MM-DD HH24:MI') AS last
      FROM public.wallet_ledger l
     WHERE l.source = 'withdrawal_reversal' AND l.created_at > now() - interval '7 days'
     GROUP BY 1 ORDER BY max(l.created_at) DESC
  LOOP
    RAISE NOTICE 'W3 n=% first=% last=% why=%', r.n, r.first, r.last, r.why;
  END LOOP;

  RAISE NOTICE '== W4. still pending / processing';
  FOR r IN
    SELECT status, count(*) AS n,
           count(*) FILTER (WHERE flw_transfer_id IS NULL OR flw_transfer_id = '') AS no_flw_id,
           to_char(min(created_at), 'MM-DD HH24:MI') AS oldest, to_char(max(created_at), 'MM-DD HH24:MI') AS newest
      FROM public.wallet_withdrawals WHERE status IN ('pending', 'processing') GROUP BY 1
  LOOP
    RAISE NOTICE 'W4 % n=% no_flw_id=% oldest=% newest=%', r.status, r.n, r.no_flw_id, r.oldest, r.newest;
  END LOOP;

  RAISE NOTICE '== W5. transfer webhooks received per day, last 7 days';
  FOR r IN
    SELECT to_char(processed_at, 'MM-DD') AS d, left(event, 40) AS ev, count(*) AS n
      FROM public.wallet_webhook_log
     WHERE processed_at > now() - interval '7 days' AND event ILIKE '%transfer%'
     GROUP BY 1, 2 ORDER BY 1, 2
  LOOP
    RAISE NOTICE 'W5 % % n=%', r.d, r.ev, r.n;
  END LOOP;

  RAISE NOTICE '== W6. payout config';
  FOR r IN
    SELECT key, left(value::text, 40) AS v FROM public.platform_config
     WHERE key ~* '^(flw_active_account|wallet_enabled|wallet_transfers?_enabled|transfers?_enabled|wallet_transfer.*paused|.*transfer.*kill.*|.*payout.*enabled)$'
     ORDER BY key
  LOOP
    RAISE NOTICE 'W6 % = %', r.key, r.v;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
