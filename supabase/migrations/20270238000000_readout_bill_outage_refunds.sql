-- READ-ONLY diagnostic — for today's ClubKonnect outage (bill failures whose error was a raw HTML page): did every
-- customer get their money back, and has the provider recovered? Aggregates only — CI logs of this repo are public,
-- so no names, phones, user ids or full references are printed. No writes; safe to leave applied.
DO $$
DECLARE
  v_failed int; v_wallet int; v_reversed int; v_open int; v_open_kobo bigint; v_no_debit int;
  v_refund_html int; r record;
BEGIN
  WITH f AS (
    SELECT substring(note from '\| PS: (\S+)\s*$') AS ref
      FROM public.transactions
     WHERE bill_status = 'failed' AND note LIKE 'FAILED: <!DOCTYPE%' AND created_at > now() - interval '2 days'
  ), d AS (
    SELECT f.ref, l.id, l.status, l.amount_kobo
      FROM f LEFT JOIN public.wallet_ledger l ON l.reference = f.ref AND l.source = 'bill_spend'
  )
  SELECT count(*),
         count(*) FILTER (WHERE id IS NOT NULL),
         count(*) FILTER (WHERE status = 'reversed'),
         count(*) FILTER (WHERE id IS NOT NULL AND status IS DISTINCT FROM 'reversed'),
         COALESCE(sum(amount_kobo) FILTER (WHERE id IS NOT NULL AND status IS DISTINCT FROM 'reversed'), 0),
         count(*) FILTER (WHERE id IS NULL)
    INTO v_failed, v_wallet, v_reversed, v_open, v_open_kobo, v_no_debit
    FROM d;
  RAISE NOTICE 'outage failures: % | paid from wallet: % | wallet debit reversed (refunded): % | wallet debit NOT reversed: % (₦%) | no wallet debit found (card/free/other): %',
    v_failed, v_wallet, v_reversed, v_open, round(v_open_kobo / 100.0, 2), v_no_debit;

  SELECT count(*) INTO v_refund_html FROM public.wallet_ledger
   WHERE source = 'bill_reversal' AND narration LIKE '%<!DOCTYPE%' AND created_at > now() - interval '2 days';
  RAISE NOTICE 'refund ledger rows whose narration contains the raw HTML page: %', v_refund_html;

  -- has the provider recovered? successful vs failed bill purchases per hour (UTC), today
  FOR r IN
    SELECT date_trunc('hour', created_at) AS hr,
           count(*) FILTER (WHERE bill_status = 'failed')  AS failed,
           count(*) FILTER (WHERE bill_status = 'pending') AS pending,
           count(*) FILTER (WHERE bill_status IS DISTINCT FROM 'failed' AND bill_status IS DISTINCT FROM 'pending') AS ok
      FROM public.transactions
     WHERE payment_type = 'bill_payment' AND created_at > now() - interval '12 hours'
     GROUP BY 1 ORDER BY 1
  LOOP
    RAISE NOTICE 'bills %: ok=% failed=% pending=%', to_char(r.hr, 'YYYY-MM-DD HH24:00'), r.ok, r.failed, r.pending;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
