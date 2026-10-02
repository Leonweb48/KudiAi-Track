-- READ-ONLY diagnostic (2026-10-02): the one bill refused during ClubKonnect's overnight key rejection (airtime, 1 Oct
-- 23:07 UTC, "INVALID_CREDENTIALS", not wallet-paid). How was it paid, and was anything raised to refund it? Booleans,
-- statuses and times only — no reference, number, name or amount (CI logs are public). No writes.
DO $$
DECLARE t record; r record; v_ref text;
BEGIN
  SELECT id, user_id, created_at, note, bill_details INTO t FROM public.transactions
   WHERE payment_type = 'bill_payment' AND bill_status = 'failed' AND note ~ 'INVALID_CREDENTIALS'
     AND created_at > '2026-10-01 20:30:00+00' ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RAISE NOTICE 'X0 no such failed bill'; RETURN; END IF;
  v_ref := substring(t.note FROM 'PS: ([A-Za-z0-9_-]+)');
  RAISE NOTICE 'X1 at=% ref_kind=% bill_details_keys=%', to_char(t.created_at, 'MM-DD HH24:MI'),
    CASE WHEN v_ref IS NULL THEN 'none' WHEN v_ref LIKE 'KDT-BILL-%' THEN 'KDT-BILL' ELSE left(regexp_replace(v_ref, '[0-9]', '#', 'g'), 6) || '…' END,
    (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(coalesce(t.bill_details, '{}'::jsonb)) k);
  RAISE NOTICE 'X2 paid_via=% coupon=% cashback_or_points=%',
    coalesce(t.bill_details ->> 'paid_via', '?'), (t.note ~* 'coupon' OR t.bill_details ? 'coupon'), (t.note ~* 'cashback|points');

  SELECT status, (fulfillment IS NOT NULL) AS has_fulfillment INTO r FROM public.pending_bills WHERE reference = v_ref;
  RAISE NOTICE 'X3 card intent (pending_bills): found=% status=% has_fulfillment=%', FOUND, r.status, r.has_fulfillment;

  RAISE NOTICE 'X4 wallet ledger rows with this reference: %',
    (SELECT coalesce(string_agg(source || '/' || status, ','), 'none') FROM public.wallet_ledger WHERE reference = v_ref OR related_txn_id = t.id);
  RAISE NOTICE 'X5 admin task: %', (SELECT coalesce(string_agg(status || ' @' || to_char(created_at, 'HH24:MI'), ','), 'none')
    FROM public.admin_tasks WHERE created_at BETWEEN t.created_at - interval '10 minutes' AND t.created_at + interval '30 minutes');
  RAISE NOTICE 'X6 support ticket: %', (SELECT coalesce(string_agg(status || ' @' || to_char(created_at, 'HH24:MI'), ','), 'none')
    FROM public.support_tickets WHERE created_at BETWEEN t.created_at - interval '10 minutes' AND t.created_at + interval '30 minutes');
  RAISE NOTICE 'X7 same user retried later and succeeded: %', (SELECT count(*) FROM public.transactions
    WHERE user_id = t.user_id AND payment_type = 'bill_payment' AND bill_status IN ('success', 'completed') AND created_at > t.created_at);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
