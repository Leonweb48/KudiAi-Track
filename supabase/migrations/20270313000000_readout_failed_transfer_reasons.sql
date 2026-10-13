-- READ-ONLY (2026-10-13): why recent bank transfers failed — Flutterwave's own message from the webhook and from the
-- send-time refusal alert. Generic provider text only; digits masked (CI logs are public). No writes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT to_char(w.created_at AT TIME ZONE 'Africa/Lagos', 'DD Mon HH24:MI') wat,
                  CASE WHEN w.amount_kobo < 500000 THEN '<=5k' WHEN w.amount_kobo < 1000000 THEN '5k-10k' ELSE '>=10k' END band,
                  left(regexp_replace(coalesce(
                    (SELECT coalesce(l.payload->'data'->>'complete_message', l.payload->'data'->>'status_message', l.payload->'data'->'status_reason'->>'message', l.payload->'data'->>'status')
                       FROM public.wallet_webhook_log l WHERE l.payload->'data'->>'reference' = w.id::text ORDER BY l.id DESC LIMIT 1),
                    (SELECT n.metadata->>'flw_message' FROM public.admin_notifications n WHERE n.metadata->>'withdrawal_id' = w.id::text LIMIT 1),
                    '?'), '[0-9]', '#', 'g'), 120) why
             FROM public.wallet_withdrawals w
            WHERE w.status IN ('failed', 'reversed') AND w.created_at > now() - interval '4 days' ORDER BY w.created_at LOOP
    RAISE NOTICE 'F1 % | % | %', r.wat, r.band, r.why;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
