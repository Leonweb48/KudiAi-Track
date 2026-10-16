-- READ-ONLY (2026-10-16): failed/reversed bank transfers since 13 Oct grouped by day and Flutterwave's generic reason
-- (digits masked — CI logs are public). Also the newest successful transfer's day, to see if transfers work now. No writes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT to_char(w.created_at AT TIME ZONE 'Africa/Lagos', 'DD Mon') d, w.status,
                  left(regexp_replace(coalesce(
                    (SELECT coalesce(l.payload->'data'->>'complete_message', l.payload->'data'->>'status_message', l.payload->'data'->'status_reason'->>'message', l.payload->'data'->>'status')
                       FROM public.wallet_webhook_log l WHERE l.payload->'data'->>'reference' = w.id::text ORDER BY l.id DESC LIMIT 1),
                    (SELECT n.metadata->>'flw_message' FROM public.admin_notifications n WHERE n.metadata->>'withdrawal_id' = w.id::text LIMIT 1),
                    '?'), '[0-9]', '#', 'g'), 100) why, count(*) n
             FROM public.wallet_withdrawals w
            WHERE w.status IN ('failed', 'reversed') AND w.created_at > '2026-10-13'
            GROUP BY 1, 2, 3 ORDER BY 1, 2 LOOP
    RAISE NOTICE 'T1 % | % | % | x%', r.d, r.status, r.why, r.n;
  END LOOP;
  RAISE NOTICE 'T2 newest successful transfer (WAT): %',
    (SELECT to_char(max(w.created_at) AT TIME ZONE 'Africa/Lagos', 'DD Mon HH24:MI') FROM public.wallet_withdrawals w WHERE w.status = 'successful');
  RAISE NOTICE 'T3 newest failed transfer (WAT): %',
    (SELECT to_char(max(w.created_at) AT TIME ZONE 'Africa/Lagos', 'DD Mon HH24:MI') FROM public.wallet_withdrawals w WHERE w.status IN ('failed', 'reversed'));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
