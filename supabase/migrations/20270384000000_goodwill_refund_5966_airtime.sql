-- Owner's decision (2026-10-21): goodwill refund. The customer at …5966 reports the ₦400 MTN airtime of 21 Oct 12:03
-- (KDT-BILL-1792580584894, paid from the wallet) never arrived. ClubKonnect's record says ORDER_COMPLETED (it charged
-- us ₦388); the owner refunds the customer anyway and will raise it with ClubKonnect.
-- Returns the ₦400 to the wallet (wallet_reverse_bill on the order's own debit), takes back the cashback earned on it,
-- marks the bill failed, tells the customer. Runs once (skips if the debit is already reversed).
DO $refund$
DECLARE
  v_ref constant text := 'KDT-BILL-1792580584894';
  l record; t record; v_email text; v_earned numeric;
BEGIN
  SELECT * INTO l FROM public.wallet_ledger WHERE reference = v_ref AND source = 'bill_spend' ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RAISE NOTICE 'refund | wallet debit not found — nothing changed'; RETURN; END IF;
  IF l.status = 'reversed' THEN RAISE NOTICE 'refund | already refunded'; RETURN; END IF;
  IF l.amount_kobo <> 40000 THEN RAISE NOTICE 'refund | debit is ₦% not ₦400 — nothing changed', l.amount_kobo / 100.0; RETURN; END IF;
  SELECT * INTO t FROM public.transactions WHERE id = l.related_txn_id;

  PERFORM public.wallet_reverse_bill(l.id, 'Refund: ₦400 MTN airtime of 21 Oct reported not received');

  -- cashback earned on this purchase (same account, within 2 minutes) is taken back
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = l.user_id;
  IF v_email IS NOT NULL THEN
    SELECT sum(amount) INTO v_earned FROM public.cashback_transactions
     WHERE user_email = v_email AND type = 'earned' AND bill_type = 'airtime'
       AND created_at BETWEEN l.created_at - interval '2 minutes' AND l.created_at + interval '2 minutes';
    IF coalesce(v_earned, 0) > 0 THEN
      INSERT INTO public.cashback_transactions (user_email, amount, type, bill_type, description)
      VALUES (v_email, v_earned, 'redeemed', 'airtime', 'Cashback taken back: the 21 Oct ₦400 airtime was refunded');
    END IF;
  END IF;

  IF t.id IS NOT NULL THEN
    UPDATE public.transactions
       SET bill_status = 'failed',
           bill_details = coalesce(bill_details, '{}'::jsonb) || jsonb_build_object('refund', 'wallet', 'refund_reason', 'customer reported not received — goodwill refund')
     WHERE id = t.id;
  END IF;

  BEGIN
    INSERT INTO public.notifications (user_id, type, category, title, body, deep_link, priority, dedupe_key)
    VALUES (l.user_id, 'bill_payment_failed', 'bills', 'Airtime refunded',
            'We''re sorry your ₦400 MTN airtime on 21 Oct didn''t reach you. ₦400 is back in your wallet.',
            '{"tab":"bills"}'::jsonb, 'high', 'bill_refund_' || v_ref);
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'refund | notification skipped: %', SQLERRM; END;

  UPDATE public.bill_delivery_rechecks SET action = 'goodwill-refund-wallet' WHERE request_id = v_ref;
  RAISE NOTICE 'refund | ₦400 back in the wallet, cashback taken back ₦%, bill marked failed', coalesce(v_earned, 0);
END $refund$;
