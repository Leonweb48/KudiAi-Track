-- READ-ONLY check (2026-10-02): the 26 Sept electricity order (ClubKonnect ORDER_REFUNDED/899) was refunded by the sweep
-- with the owner's OK. Confirm: order marked failed, its own wallet debit reversed, a matching credit written, customer
-- notified. Statuses, booleans and times only (CI logs are public). No writes.
DO $$
DECLARE t record; l record; r record;
BEGIN
  SELECT id, user_id, amount, bill_status, note, bill_details INTO t FROM public.transactions
   WHERE category = 'electricity' AND payment_type = 'bill_payment'
     AND created_at BETWEEN '2026-09-26 05:58:00+00' AND '2026-09-26 06:00:00+00' LIMIT 1;
  IF NOT FOUND THEN RAISE NOTICE 'R0 order not found'; RETURN; END IF;
  RAISE NOTICE 'R1 order: status=% still_token_loading=% refund_marker=%', t.bill_status, (t.note ~ 'Token loading'), t.bill_details ->> 'refund';

  SELECT id, status, amount_kobo, wallet_id INTO l FROM public.wallet_ledger WHERE related_txn_id = t.id AND source = 'bill_spend';
  RAISE NOTICE 'R2 its wallet debit: found=% status=% amount_matches_order=%', FOUND, l.status, (l.amount_kobo = round(t.amount * 100));

  SELECT count(*) AS n, bool_and(amount_kobo = l.amount_kobo) AS same_amount, to_char(max(created_at), 'MM-DD HH24:MI') AS at INTO r
    FROM public.wallet_ledger
   WHERE wallet_id = l.wallet_id AND direction = 'credit' AND created_at > now() - interval '2 hours'
     AND (source ILIKE '%reversal%' OR source ILIKE '%refund%' OR narration ILIKE '%refund%');
  RAISE NOTICE 'R3 refund credit to that wallet in the last 2 h: n=% same_amount=% at=%', r.n, r.same_amount, r.at;

  RAISE NOTICE 'R4 customer notified in the last 2 h: %', (SELECT count(*) FROM public.notifications
    WHERE user_id = t.user_id AND created_at > now() - interval '2 hours' AND title ILIKE '%electricity%refund%');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
