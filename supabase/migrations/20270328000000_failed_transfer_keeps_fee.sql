-- Failed / reversed bank transfers keep our transfer fee (owner's decision, 2026-10-13): Flutterwave does not give back its
-- own fee on a failed attempt, so neither do we. The amount and the ₦50 stamp duty are still returned (stamp duty is only
-- owed on a transfer that actually went through). Our fee is only ever charged once Flutterwave ACCEPTS a transfer
-- (wallet_transfer_sent), so a transfer refused at the start costs nothing. Terms v8 updates 4.10(e) to say so.
-- wallet_mark_withdrawal below is 20270314 with the one change marked "OUR TRANSFER FEE IS KEPT".

CREATE OR REPLACE FUNCTION public.wallet_mark_withdrawal(
  p_flw_transfer_id TEXT,
  p_status          TEXT,
  p_reference       TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wd     public.wallet_withdrawals%ROWTYPE;
  v_wallet public.wallets;
  v_set    public.wallets;
  v_new    BIGINT;
  v_txn_id UUID;
  v_ref_id UUID;
  c        public.wallet_ledger%ROWTYPE;
  v_label  TEXT;
BEGIN
  -- 1) by Flutterwave transfer id
  IF COALESCE(p_flw_transfer_id, '') <> '' THEN
    SELECT * INTO v_wd FROM public.wallet_withdrawals
     WHERE flw_transfer_id = p_flw_transfer_id FOR UPDATE;
  END IF;

  -- 2) fall back to our reference (webhook echoes it as data.reference)
  IF v_wd.id IS NULL AND COALESCE(p_reference, '') <> '' THEN
    BEGIN v_ref_id := p_reference::uuid; EXCEPTION WHEN others THEN v_ref_id := NULL; END;
    IF v_ref_id IS NOT NULL THEN
      SELECT * INTO v_wd FROM public.wallet_withdrawals WHERE id = v_ref_id FOR UPDATE;
    END IF;
  END IF;

  IF v_wd.id IS NULL THEN
    RAISE WARNING 'wallet_mark_withdrawal: no withdrawal for tid=% ref=%', p_flw_transfer_id, p_reference;
    RETURN;
  END IF;

  PERFORM set_config('kudi.allow_wallet_write', '1', true);

  -- backfill the transfer id if we matched by reference
  IF COALESCE(p_flw_transfer_id, '') <> '' AND COALESCE(v_wd.flw_transfer_id, '') = '' THEN
    UPDATE public.wallet_withdrawals SET flw_transfer_id = p_flw_transfer_id WHERE id = v_wd.id;
    v_wd.flw_transfer_id := p_flw_transfer_id;
  END IF;

  -- Refunded earlier (failed, or reversed by hand while Flutterwave still showed it pending) but Flutterwave now says it was
  -- PAID: the customer has both the refund and the transfer. Never flip it silently — leave it as it is and tell finance
  -- admins exactly what to recover. (Added 2026-10-13 with the manual reversal of transfers stuck pending at Flutterwave.)
  IF p_status = 'successful' AND v_wd.status IN ('failed', 'reversed') THEN
    BEGIN
      INSERT INTO public.admin_notifications (type, category, title, message, target_roles, metadata)
      VALUES ('error', 'finance', 'Refunded transfer was later paid by Flutterwave',
        'A ₦' || to_char(v_wd.amount_kobo / 100.0, 'FM999,999,999,990.00') || ' bank transfer was refunded to the customer''s wallet, but Flutterwave has now '
          || 'reported it as paid. The customer has both the refund and the money at the bank — recover ₦'
          || to_char(v_wd.amount_kobo / 100.0, 'FM999,999,999,990.00') || ' from their wallet. Withdrawal ' || v_wd.id::text || '.',
        ARRAY['finance_admin', 'super_admin'],
        jsonb_build_object('withdrawal_id', v_wd.id, 'amount_kobo', v_wd.amount_kobo, 'flw_transfer_id', p_flw_transfer_id, 'kind', 'paid_after_refund'));
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'wallet_mark_withdrawal: paid-after-refund alert failed: %', SQLERRM;
    END;
    RETURN;
  ELSIF p_status = 'successful' AND v_wd.status <> 'successful' THEN
    UPDATE public.wallet_withdrawals SET status = 'successful', updated_at = now() WHERE id = v_wd.id;
    UPDATE public.wallet_ledger SET status = 'completed' WHERE id = v_wd.ledger_id AND status = 'pending';

    IF v_wd.book_expense AND v_wd.txn_id IS NULL THEN
      INSERT INTO public.transactions (
        user_id, type, category, amount, customer_name, payment_type, note,
        transaction_date, client_txn_id
      ) VALUES (
        v_wd.user_id, 'out', 'expense', (v_wd.amount_kobo::numeric / 100),
        NULLIF(v_wd.account_name, ''), 'wallet',
        COALESCE(NULLIF(v_wd.narration, ''), 'Wallet transfer'),
        current_date, v_wd.id
      )
      ON CONFLICT (client_txn_id) DO NOTHING
      RETURNING id INTO v_txn_id;
      IF v_txn_id IS NULL THEN
        SELECT id INTO v_txn_id FROM public.transactions WHERE client_txn_id = v_wd.id;
      END IF;
      UPDATE public.wallet_withdrawals SET txn_id = v_txn_id WHERE id = v_wd.id;
      UPDATE public.wallet_ledger SET related_txn_id = v_txn_id WHERE id = v_wd.ledger_id;
    END IF;

  ELSIF p_status IN ('failed','reversed') AND v_wd.status NOT IN ('failed','reversed') THEN
    SELECT * INTO v_wallet FROM public.wallets WHERE id = v_wd.wallet_id FOR UPDATE;
    v_new := v_wallet.balance_kobo + v_wd.amount_kobo;
    UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_wallet.id;
    UPDATE public.wallet_ledger SET status = 'reversed' WHERE id = v_wd.ledger_id;
    INSERT INTO public.wallet_ledger (
      wallet_id, user_id, direction, amount_kobo, balance_after_kobo, source, status, narration
    ) VALUES (
      v_wallet.id, v_wd.user_id, 'credit', v_wd.amount_kobo, v_new,
      'withdrawal_reversal', 'completed', 'Transfer failed — refunded to wallet'
    );

    -- the stamp duty comes back (it is only owed on a transfer that went through), out of the platform settlement wallet when
    -- it can cover it. OUR TRANSFER FEE IS KEPT (owner, 2026-10-13): Flutterwave keeps its own fee on a failed attempt.
    FOR c IN SELECT * FROM public.wallet_ledger
              WHERE user_id = v_wd.user_id AND reference = v_wd.id::text AND direction = 'debit'
                AND source = 'cbn_levy' AND status = 'completed'
              ORDER BY created_at
    LOOP
      v_label := CASE c.source WHEN 'transfer_fee' THEN 'Transfer fee refunded' ELSE 'Stamp duty refunded' END;
      UPDATE public.wallet_ledger SET status = 'reversed' WHERE id = c.id;
      v_new := v_new + c.amount_kobo;
      UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_wallet.id;
      INSERT INTO public.wallet_ledger (wallet_id, user_id, direction, amount_kobo, balance_after_kobo, source, status, reference, narration, related_txn_id, meta)
      VALUES (v_wallet.id, v_wd.user_id, 'credit', c.amount_kobo, v_new, c.source, 'completed', v_wd.id::text, v_label, v_wd.id,
              jsonb_build_object('refund_of', c.id));
      SELECT * INTO v_set FROM public.wallets WHERE user_id = '00000000-0000-0000-0000-000000000001' FOR UPDATE;
      IF FOUND AND v_set.balance_kobo >= c.amount_kobo THEN
        UPDATE public.wallets SET balance_kobo = v_set.balance_kobo - c.amount_kobo WHERE id = v_set.id;
        INSERT INTO public.wallet_ledger (wallet_id, user_id, direction, amount_kobo, balance_after_kobo, source, status, reference, narration, related_txn_id)
        VALUES (v_set.id, v_set.user_id, 'debit', c.amount_kobo, v_set.balance_kobo - c.amount_kobo, c.source, 'completed', v_wd.id::text,
                v_label || ' — withdrawal ' || v_wd.id::text, v_wd.id);
      END IF;
    END LOOP;

    UPDATE public.wallet_withdrawals SET status = p_status, updated_at = now() WHERE id = v_wd.id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_mark_withdrawal(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_mark_withdrawal(TEXT, TEXT, TEXT) TO service_role;

-- ── Terms v8: 4.10(e) ───────────────────────────────────────────────────────────────────────────────────────────────────
DO $tnc$
DECLARE
  src      public.legal_documents%ROWTYPE;
  next_ver integer;
  today    text := trim(to_char(now() AT TIME ZONE 'Africa/Lagos', 'FMDD FMMonth YYYY'));
  old_e    text := '<p><strong>(e) Failed or reversed transfers.</strong> If a bank transfer fails or is reversed, the amount, our fee and any stamp duty are returned to your wallet.</p>';
  new_e    text := '<p><strong>(e) Failed or reversed transfers.</strong> If a bank transfer fails or is reversed after our payment partner has accepted it, the amount and any stamp duty are returned to your wallet. Our transfer fee is not refunded, because our payment partner still charges for the attempt. A transfer that is refused before it is sent carries no fee.</p>';
  body     text;
BEGIN
  SELECT * INTO src FROM public.legal_documents WHERE type = 'tnc' AND status = 'published' ORDER BY version DESC LIMIT 1;
  IF NOT FOUND THEN RAISE NOTICE 'terms | no published copy, skipped'; RETURN; END IF;
  IF position(new_e IN src.content) > 0 THEN RAISE NOTICE 'terms | v% already has the new 4.10(e), skipped', src.version; RETURN; END IF;
  IF position(old_e IN src.content) = 0 THEN RAISE EXCEPTION 'terms: 4.10(e) text not found — not publishing'; END IF;
  SELECT max(version) + 1 INTO next_ver FROM public.legal_documents WHERE type = 'tnc';
  body := replace(src.content, old_e, new_e);
  body := regexp_replace(body,
    '<p><strong>Effective Date:</strong>[^<]*<br><strong>Last Updated:</strong>[^<]*<br><strong>Version:</strong>[^<]*</p>',
    '<p><strong>Effective Date:</strong> ' || today || '<br><strong>Last Updated:</strong> ' || today || '<br><strong>Version:</strong> ' || next_ver || '</p>');
  INSERT INTO public.legal_documents (type, content, version, status, published_at, published_by, editor_name, requires_reacceptance, change_summary)
  VALUES ('tnc', body, next_ver, 'published', now(), 'system', 'System', true,
    'Section 4.10(e) updated: if a bank transfer fails or is reversed after our payment partner accepted it, the amount and any stamp duty are returned to your wallet, but the transfer fee is not refunded (our payment partner still charges for the attempt). A transfer refused before it is sent has no fee.');
  RAISE NOTICE 'terms | v% published from v% (4.10(e): transfer fee kept on failed transfers)', next_ver, src.version;
END $tnc$;
