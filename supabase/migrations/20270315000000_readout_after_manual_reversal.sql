-- READ-ONLY (2026-10-13): after reversing the two transfers left PENDING at Flutterwave — their status now, whether a
-- refund credit was written for each, and that nothing is still open. Counts/statuses only. No writes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT w.status, to_char(w.created_at AT TIME ZONE 'Africa/Lagos', 'HH24:MI') wat,
                  (SELECT count(*) FROM public.wallet_ledger l WHERE l.user_id = w.user_id AND l.source = 'withdrawal_reversal'
                      AND l.direction = 'credit' AND l.amount_kobo = w.amount_kobo AND l.created_at > now() - interval '1 hour') refund_rows,
                  (SELECT status FROM public.wallet_ledger WHERE id = w.ledger_id) hold_status
             FROM public.wallet_withdrawals w WHERE w.created_at > '2026-10-13 07:00:00+00' ORDER BY w.created_at LOOP
    RAISE NOTICE 'R1 % at % WAT | refund credit rows (last hour) % | original debit %', r.status, r.wat, r.refund_rows, r.hold_status;
  END LOOP;
  RAISE NOTICE 'R2 still pending/processing (any date) = %', (SELECT count(*) FROM public.wallet_withdrawals WHERE status IN ('pending', 'processing'));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
