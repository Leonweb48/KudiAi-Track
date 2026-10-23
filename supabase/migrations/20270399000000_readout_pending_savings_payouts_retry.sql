-- READ-ONLY (2026-10-23, retry of 20270398 — requests use requested_at): an owner can't approve a client's savings payout into the client's wallet. Withdrawal
-- requests and wallet payouts of the last 3 days: ids, status, amounts, method, whether the owner's wallet covers the
-- payout with / without the ₦10 charge fee (yes/no only — no balances), the payout's last error. No names, no numbers
-- beyond amounts. No writes.
DO $$
DECLARE r record; j jsonb; k text;
BEGIN
  FOR r IN
    SELECT w.*, to_char(w.requested_at AT TIME ZONE 'Africa/Lagos', 'MM-DD HH24:MI') AS at_l FROM public.ajo_withdrawal_requests w
     WHERE w.requested_at > now() - interval '3 days' ORDER BY w.requested_at LOOP
    j := to_jsonb(r) - 'created_at' - 'requested_at';
    FOR k IN SELECT jsonb_object_keys(j) LOOP
      IF k ~* '(phone|name|email|account_number|bank|address|note|reason)' THEN j := j - k; END IF;
    END LOOP;
    RAISE NOTICE 'W1 % %', r.at_l, left(j::text, 700);
  END LOOP;
  FOR r IN
    SELECT p.*, to_char(p.created_at AT TIME ZONE 'Africa/Lagos', 'MM-DD HH24:MI') AS at_l,
           (SELECT balance_kobo >= p.amount_kobo FROM public.wallets WHERE user_id = p.owner_id) AS covers_amount,
           (SELECT balance_kobo >= p.amount_kobo + 1075 FROM public.wallets WHERE user_id = p.owner_id) AS covers_with_fee
      FROM public.ajo_wallet_payouts p WHERE p.created_at > now() - interval '3 days' ORDER BY p.created_at LOOP
    j := to_jsonb(r) - 'created_at' - 'requested_at';
    FOR k IN SELECT jsonb_object_keys(j) LOOP
      IF k ~* '(phone|name|email|account_number|bank|address)' THEN j := j - k; END IF;
    END LOOP;
    RAISE NOTICE 'W2 % %', r.at_l, left(regexp_replace(j::text, '\d{7,}', '…', 'g'), 700);
  END LOOP;
  -- pending requests: does the owner's wallet cover the client's net payout, with / without the fee?
  FOR r IN
    SELECT w.id, w.status, w.amount, w.net_amount,
           (SELECT balance_kobo >= round(coalesce(w.net_amount, w.amount) * 100) FROM public.wallets WHERE user_id = w.owner_id) AS covers_amount,
           (SELECT balance_kobo >= round(coalesce(w.net_amount, w.amount) * 100) + 1075 FROM public.wallets WHERE user_id = w.owner_id) AS covers_with_fee,
           (SELECT status FROM public.wallets WHERE user_id = w.owner_id) AS owner_wallet
      FROM public.ajo_withdrawal_requests w WHERE w.requested_at > now() - interval '3 days' LOOP
    RAISE NOTICE 'W3 req % | % | ₦% net ₦% | owner wallet % covers=% covers+fee=%', r.id, r.status, r.amount, r.net_amount, r.owner_wallet, r.covers_amount, r.covers_with_fee;
  END LOOP;
  RAISE NOTICE 'W4 settlement wallet covers ₦5,000: %', (SELECT balance_kobo >= 500000 FROM public.wallets WHERE user_id = '00000000-0000-0000-0000-000000000001');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
