-- READ-ONLY (2026-10-13): for today's transfers — did any Flutterwave webhook arrive for them (matched by our reference),
-- with which event/status; and how many recent transfers got a Flutterwave transfer id back at send time. Counts/statuses only.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT w.status, to_char(w.created_at AT TIME ZONE 'Africa/Lagos', 'HH24:MI') wat, (w.flw_transfer_id IS NOT NULL) has_id,
                  (SELECT count(*) FROM public.wallet_webhook_log l WHERE l.payload->'data'->>'reference' = w.id::text) hooks,
                  (SELECT string_agg(l.event || '/' || coalesce(l.payload->'data'->>'status', '?'), ',') FROM public.wallet_webhook_log l
                    WHERE l.payload->'data'->>'reference' = w.id::text) what
             FROM public.wallet_withdrawals w WHERE w.created_at > '2026-10-13 07:00:00+00' ORDER BY w.created_at LOOP
    RAISE NOTICE 'W1 % at % WAT | flw id % | webhooks % (%)', r.status, r.wat, r.has_id, r.hooks, r.what;
  END LOOP;
  FOR r IN SELECT status, (flw_transfer_id IS NOT NULL) has_id, count(*) n FROM public.wallet_withdrawals
            WHERE created_at > now() - interval '10 days' GROUP BY 1, 2 ORDER BY 1, 2 LOOP
    RAISE NOTICE 'W2 last 10 days: % | flw id % = %', r.status, r.has_id, r.n;
  END LOOP;
  RAISE NOTICE 'W3 transfer webhooks received today = %',
    (SELECT count(*) FROM public.wallet_webhook_log WHERE event LIKE 'transfer%' AND created_at > '2026-10-13 00:00:00+00');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
