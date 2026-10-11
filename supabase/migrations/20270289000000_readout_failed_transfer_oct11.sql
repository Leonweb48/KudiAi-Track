-- READ-ONLY (2026-10-11): today's one failed wallet transfer — why, and was the money returned? Time, bank code,
-- Flutterwave's type/code/HTTP status and statuses only; digits in any message are masked; no account number, name,
-- reference or amount (CI logs are public). No writes.
DO $$
DECLARE w record; a record; l record;
BEGIN
  FOR w IN
    SELECT id, created_at, updated_at, bank_code, (flw_transfer_id IS NOT NULL) AS flw_accepted, ledger_id
      FROM public.wallet_withdrawals
     WHERE status = 'failed' AND created_at > '2026-10-11 00:00:00+01' ORDER BY created_at
  LOOP
    RAISE NOTICE 'T1 at=% WAT failed_at=% WAT bank=% flutterwave_accepted_it=%',
      to_char(w.created_at AT TIME ZONE 'Africa/Lagos', 'HH24:MI'), to_char(w.updated_at AT TIME ZONE 'Africa/Lagos', 'HH24:MI'),
      w.bank_code, w.flw_accepted;
    FOR a IN
      SELECT metadata->>'flw_type' AS t, metadata->>'flw_code' AS c, metadata->>'http' AS h,
             left(regexp_replace(coalesce(metadata->>'flw_message', ''), '[0-9]', '#', 'g'), 120) AS m
        FROM public.admin_notifications WHERE metadata->>'withdrawal_id' = w.id::text
    LOOP
      RAISE NOTICE 'T2 refused: type=% code=% http=% message="%"', a.t, a.c, a.h, a.m;
    END LOOP;
    IF NOT FOUND THEN RAISE NOTICE 'T2 no "refused" alert (so it failed later, via the transfer webhook)'; END IF;
    FOR l IN
      SELECT source, status, (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(coalesce(meta, '{}'::jsonb)) k) AS keys,
             left(regexp_replace(coalesce(meta->>'complete_message', meta->>'reason', meta->>'failure_reason', ''), '[0-9]', '#', 'g'), 120) AS why
        FROM public.wallet_ledger WHERE id = w.ledger_id OR (meta->>'withdrawal_id') = w.id::text
    LOOP
      RAISE NOTICE 'T3 ledger: %/% why="%" keys=%', l.source, l.status, l.why, l.keys;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'T4 transfers in the last 7 days: %', (SELECT string_agg(status || '=' || n, ', ') FROM (
    SELECT status, count(*) n FROM public.wallet_withdrawals WHERE created_at > now() - interval '7 days' GROUP BY 1 ORDER BY 1) x);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
