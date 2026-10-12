-- Stamp duty like the banks, charges refunded on failed transfers, and Terms & Conditions v6 (owner, 2026-10-12: "Do what
-- other banks are doing and update the terms and conditions").
--
-- STAMP DUTY (Nigeria Tax Act 2025, from 1 Jan 2026): banks, OPay, PalmPay and Moniepoint take ₦50 from the SENDER on every
-- transfer of ₦10,000 or more, shown as its own line; below ₦10,000 and moves inside the same bank are exempt. Same here:
-- ₦50 on BANK transfers of ₦10,000 or more, charged even when our fee is free, never on moves between KudiAI wallets.
-- Booked under the existing pass-through ledger source 'cbn_levy' (already a memo line kept OUT of profit), relabelled
-- "Stamp duty". Switches in platform_config: wallet_stamp_duty_enabled / _kobo / _from_kobo.
-- VAT on our fees is NOT charged (only a VAT-registered business may charge it); the Terms say it would be shown separately.
--
-- FAILED / REVERSED transfers now also give back our fee and the stamp duty (before: the amount only), taken back out of
-- the platform settlement wallet, as banks reverse the charges of a failed transfer.

INSERT INTO public.platform_config (key, value, description) VALUES
  ('wallet_stamp_duty_enabled',   'true',    'Charge stamp duty to the sender on bank transfers at or above wallet_stamp_duty_from_kobo.'),
  ('wallet_stamp_duty_kobo',      '5000',    'Stamp duty per bank transfer, in kobo (₦50).'),
  ('wallet_stamp_duty_from_kobo', '1000000', 'Bank transfers of this amount (kobo) or more pay stamp duty (₦10,000).')
ON CONFLICT (key) DO NOTHING;

UPDATE public.finance_lines
   SET name = 'Stamp duty collected (to remit)',
       description = 'Stamp duty (₦50 on bank transfers of ₦10,000 or more) collected from senders for the tax authority — not KudiAI income, so kept out of profit. Refunds on failed transfers are taken off. (Before Oct 2026 this line held the old CBN levy.)'
 WHERE code = 'wallet.cbn_levy';

CREATE OR REPLACE FUNCTION public.wallet_stamp_duty_kobo(p_amount_kobo bigint) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN lower(COALESCE((SELECT value FROM public.platform_config WHERE key = 'wallet_stamp_duty_enabled'), 'true')) IN ('true', '1', 'yes')
               AND COALESCE(p_amount_kobo, 0) >= public.wallet_cfg_int('wallet_stamp_duty_from_kobo', 1000000)
              THEN public.wallet_cfg_int('wallet_stamp_duty_kobo', 5000) ELSE 0 END
$$;
REVOKE ALL ON FUNCTION public.wallet_stamp_duty_kobo(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_stamp_duty_kobo(bigint) TO service_role;

-- What the app shows before a bank transfer: our fee (or free), the stamp duty, and the two together.
CREATE OR REPLACE FUNCTION public.wallet_bank_transfer_quote(p_amount_kobo bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); s jsonb; v_free boolean; v_fee bigint; v_duty bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  s := public.wallet_free_transfer_state(v_uid);
  v_free := (s->>'used')::bigint < (s->>'allowance')::bigint;
  v_fee  := CASE WHEN v_free THEN 0 ELSE public.wallet_bank_transfer_fee_kobo(p_amount_kobo) END;
  v_duty := public.wallet_stamp_duty_kobo(p_amount_kobo);
  RETURN s || jsonb_build_object('free', v_free, 'fee_kobo', v_fee, 'stamp_duty_kobo', v_duty,
    'total_charges_kobo', v_fee + v_duty, 'free_left', GREATEST((s->>'allowance')::bigint - (s->>'used')::bigint, 0));
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_bank_transfer_quote(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wallet_bank_transfer_quote(bigint) TO authenticated;

-- One charge on a bank transfer (our fee or the stamp duty): customer debit + platform credit. Skipped — never blocking an
-- accepted transfer — if the balance can't cover it; the app stops such transfers before they are sent.
CREATE OR REPLACE FUNCTION public.wallet_take_transfer_charge(p_wd public.wallet_withdrawals, p_amount bigint, p_source text, p_label text, p_meta jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wallet public.wallets; v_new bigint;
BEGIN
  IF COALESCE(p_amount, 0) <= 0 THEN RETURN; END IF;
  SELECT * INTO v_wallet FROM public.wallets WHERE id = p_wd.wallet_id FOR UPDATE;
  IF NOT FOUND OR v_wallet.balance_kobo < p_amount THEN RETURN; END IF;
  v_new := v_wallet.balance_kobo - p_amount;
  UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_wallet.id;
  INSERT INTO public.wallet_ledger (wallet_id, user_id, direction, amount_kobo, balance_after_kobo, source, status, reference, narration, related_txn_id, meta)
  VALUES (v_wallet.id, p_wd.user_id, 'debit', p_amount, v_new, p_source, 'completed', p_wd.id::text, p_label, p_wd.id, COALESCE(p_meta, '{}'::jsonb));
  PERFORM public.wallet_credit_settlement(p_amount, p_source, p_label || ' — withdrawal ' || p_wd.id::text, p_wd.id);
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_take_transfer_charge(public.wallet_withdrawals, bigint, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_take_transfer_charge(public.wallet_withdrawals, bigint, text, text, jsonb) TO service_role;

-- Bank transfer accepted by Flutterwave: our fee (unless within the free allowance) + stamp duty (₦10,000 or more). Once only.
CREATE OR REPLACE FUNCTION public.wallet_transfer_sent(p_withdrawal_id uuid, p_flw_transfer_id text, p_fee_kobo bigint DEFAULT 0)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_wd public.wallet_withdrawals%ROWTYPE; s jsonb;
BEGIN
  PERFORM set_config('kudi.allow_wallet_write', '1', true);
  UPDATE public.wallet_withdrawals SET
    status = 'processing',
    flw_transfer_id = COALESCE(p_flw_transfer_id, flw_transfer_id),
    fee_kobo = COALESCE(NULLIF(p_fee_kobo, 0), fee_kobo),
    updated_at = now()
  WHERE id = p_withdrawal_id AND status = 'pending'          -- once only: a repeated call must never charge twice
  RETURNING * INTO v_wd;
  IF NOT FOUND THEN RETURN; END IF;

  -- the transfer's own hold (pending) already exists, so `used` includes it: free while used <= allowance
  s := public.wallet_free_transfer_state(v_wd.user_id);
  IF (s->>'used')::bigint > (s->>'allowance')::bigint THEN
    PERFORM public.wallet_take_transfer_charge(v_wd, public.wallet_bank_transfer_fee_kobo(v_wd.amount_kobo), 'transfer_fee', 'Transfer fee',
      jsonb_build_object('tier', s->>'tier', 'period', s->>'period', 'allowance', (s->>'allowance')::bigint, 'used', (s->>'used')::bigint));
  END IF;
  PERFORM public.wallet_take_transfer_charge(v_wd, public.wallet_stamp_duty_kobo(v_wd.amount_kobo), 'cbn_levy', 'Stamp duty',
    jsonb_build_object('kind', 'stamp_duty'));
END;
$function$;
REVOKE ALL ON FUNCTION public.wallet_transfer_sent(uuid, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_transfer_sent(uuid, text, bigint) TO service_role;

-- Failed / reversed transfer: the amount AND its charges (our fee, stamp duty) go back to the customer. Unchanged otherwise.
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

  IF p_status = 'successful' AND v_wd.status <> 'successful' THEN
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

    -- its charges come back too (our fee, the stamp duty), out of the platform settlement wallet when it can cover them
    FOR c IN SELECT * FROM public.wallet_ledger
              WHERE user_id = v_wd.user_id AND reference = v_wd.id::text AND direction = 'debit'
                AND source IN ('transfer_fee', 'cbn_levy') AND status = 'completed'
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

-- Reports: a refunded stamp duty comes off the "stamp duty collected" memo (a refunded fee is already the fee-refunds line).
CREATE OR REPLACE FUNCTION public.finance_sync_deposit_fees(p_full boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  SETTLEMENT constant uuid := '00000000-0000-0000-0000-000000000001';
  v_pct numeric; n bigint; n2 bigint;
BEGIN
  BEGIN v_pct := COALESCE(NULLIF((SELECT value FROM public.platform_config WHERE key = 'flw_collection_fee_pct'), '')::numeric, 2.15);
  EXCEPTION WHEN OTHERS THEN v_pct := 2.15; END;
  INSERT INTO public.finance_entries (occurred_at, line_code, amount_kobo, source_type, source_id, user_id, reference, category, estimated, note)
  SELECT l.created_at, 'wallet.deposit_fee',
         -COALESCE(NULLIF((l.meta ->> 'flw_fee_kobo')::bigint, 0), round(l.amount_kobo * v_pct / 100)::bigint),
         'wallet_ledger', l.id::text, l.user_id, l.flw_reference, 'deposit',
         (COALESCE((l.meta ->> 'flw_fee_kobo')::bigint, 0) = 0),
         CASE WHEN COALESCE((l.meta ->> 'flw_fee_kobo')::bigint, 0) > 0 THEN 'Flutterwave deposit fee'
              ELSE 'Estimated Flutterwave deposit fee (' || v_pct || '%)' END
    FROM public.wallet_ledger l
   WHERE l.source = 'topup' AND l.direction = 'credit' AND l.status = 'completed' AND l.amount_kobo > 0
     AND l.user_id <> SETTLEMENT AND (p_full OR l.created_at > now() - interval '4 days')
  ON CONFLICT (line_code, source_type, source_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO public.finance_entries (occurred_at, line_code, amount_kobo, source_type, source_id, user_id, reference, category, note)
  SELECT l.created_at, 'wallet.cbn_levy', -l.amount_kobo, 'wallet_ledger', l.id::text, l.user_id, l.reference, 'stamp_duty_refund', l.narration
    FROM public.wallet_ledger l
   WHERE l.source = 'cbn_levy' AND l.direction = 'credit' AND l.status = 'completed' AND l.amount_kobo > 0
     AND l.user_id <> SETTLEMENT AND (p_full OR l.created_at > now() - interval '4 days')
  ON CONFLICT (line_code, source_type, source_id) DO NOTHING;
  GET DIAGNOSTICS n2 = ROW_COUNT;
  RETURN jsonb_build_object('deposit_fees', n, 'stamp_duty_refunds', n2);
END;
$$;
REVOKE ALL ON FUNCTION public.finance_sync_deposit_fees(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_sync_deposit_fees(boolean) TO service_role;

-- The public /verify page names this charge too: rename it in the LIVE verify_receipt (edited in place, so nothing else
-- in that function can drift). The old "CBN electronic transfer levy" was this same ₦50; the law now calls it stamp duty.
DO $ren$
DECLARE d text; n text;
BEGIN
  SELECT pg_get_functiondef('public.verify_receipt(text)'::regprocedure) INTO d;
  n := replace(d, '''CBN transfer levy''', '''Stamp duty''');
  IF n <> d THEN EXECUTE n; RAISE NOTICE 'verify page | levy renamed to stamp duty';
  ELSE RAISE NOTICE 'verify page | no levy label found, unchanged'; END IF;
EXCEPTION WHEN undefined_function THEN RAISE NOTICE 'verify page | verify_receipt not found, skipped';
END $ren$;

-- ── Terms & Conditions v6: new section 4.10 "Wallet Fees and Charges". Fees are a material change, so everyone is asked to
--    accept the new version on their next visit; the website /terms shows the same published document. ──
DO $tnc$
DECLARE
  src      public.legal_documents%ROWTYPE;
  next_ver integer;
  today    text := trim(to_char(now() AT TIME ZONE 'Africa/Lagos', 'FMDD FMMonth YYYY'));
  body     text;
  section  text := $SEC$
<h3>4.10 Wallet Fees and Charges</h3>
<p>We show you every charge on a transfer <strong>before you confirm it</strong>. The charges below are taken from your Digital Wallet balance in addition to the amount you send, so the recipient always receives the full amount. If your balance cannot cover the amount plus its charges, the transfer will not go ahead.</p>
<p><strong>(a) Money into your wallet.</strong> Deposits (top-ups) and payments received into your Digital Wallet are free. We will give you notice before introducing any deposit fee.</p>
<p><strong>(b) Transfers from your wallet to a bank account.</strong></p>
<table>
<tr><th>Amount sent</th><th>Transfer fee</th></tr>
<tr><td>Up to ₦5,000</td><td>₦20</td></tr>
<tr><td>₦5,001 to ₦50,000</td><td>₦35</td></tr>
<tr><td>Above ₦50,000</td><td>₦60</td></tr>
</table>
<p>Free transfers: Ajo/Esusu Clients and personal wallets get their first <strong>3 transfers each day</strong> free (bank transfers and wallet savings payments count together). Business Owners get free bank transfers each <strong>calendar month</strong> according to their plan: <strong>Free plan — none; Standard plan — 10; Premium plan — 30</strong>. Unused free transfers do not carry over.</p>
<p><strong>(c) Stamp duty.</strong> As required by the Nigeria Tax Act 2025, a stamp duty of <strong>₦50</strong> is charged to the sender on every bank transfer of <strong>₦10,000 or more</strong>, in the same way as banks and other payment providers. It is shown separately from our fee, applies even when your transfer is free of our fee, and is collected on behalf of, and paid to, the relevant tax authority — it is not income to us. Transfers below ₦10,000 and moves between KudiAI wallets do not attract stamp duty.</p>
<p><strong>(d) Moves between KudiAI wallets</strong> (for example Ajo/Esusu savings payments and payouts) are free for your first 3 each day, then ₦10 for amounts below ₦10,000 and ₦50 for ₦10,000 or more.</p>
<p><strong>(e) Failed or reversed transfers.</strong> If a bank transfer fails or is reversed, the amount, our fee and any stamp duty are returned to your wallet.</p>
<p><strong>(f) Taxes.</strong> Where the law requires us to charge Value Added Tax (VAT) on our fees, it will be shown separately before you confirm.</p>
<p><strong>(g) Changes to fees.</strong> We may change these fees. We will tell you in the App before a change takes effect, and the fee that applies to a transfer is always shown before you confirm it. Charges made by our payment partner, Flutterwave, are covered by our fees and are never passed on to you separately.</p>
$SEC$;
BEGIN
  SELECT * INTO src FROM public.legal_documents WHERE type = 'tnc' AND status = 'published' ORDER BY version DESC LIMIT 1;
  IF NOT FOUND THEN RAISE NOTICE 'terms | no published copy, skipped'; RETURN; END IF;
  IF position('4.10 Wallet Fees and Charges' IN src.content) > 0 THEN RAISE NOTICE 'terms | v% already has 4.10, skipped', src.version; RETURN; END IF;
  IF position('<h2>5. SUBSCRIPTION PLANS AND BILLING</h2>' IN src.content) = 0 THEN RAISE EXCEPTION 'terms: section 5 heading not found — not publishing'; END IF;
  SELECT max(version) + 1 INTO next_ver FROM public.legal_documents WHERE type = 'tnc';
  body := replace(src.content, '<h2>5. SUBSCRIPTION PLANS AND BILLING</h2>', btrim(section, E' '||chr(13)||chr(10)) || E'\n<h2>5. SUBSCRIPTION PLANS AND BILLING</h2>');
  body := regexp_replace(body,
    '<p><strong>Effective Date:</strong>[^<]*<br><strong>Last Updated:</strong>[^<]*<br><strong>Version:</strong>[^<]*</p>',
    '<p><strong>Effective Date:</strong> ' || today || '<br><strong>Last Updated:</strong> ' || today || '<br><strong>Version:</strong> ' || next_ver || '</p>');
  INSERT INTO public.legal_documents (type, content, version, status, published_at, published_by, editor_name, requires_reacceptance, change_summary)
  VALUES ('tnc', body, next_ver, 'published', now(), 'system', 'System', true,
    'New section 4.10 Wallet Fees and Charges: bank transfers cost ₦20 (up to ₦5,000), ₦35 (up to ₦50,000) or ₦60 (above), always shown before you confirm; Ajo clients keep 3 free transfers a day and businesses get free transfers by plan (Free 0, Standard 10, Premium 30 a month); the government ₦50 stamp duty applies to bank transfers of ₦10,000 or more, as at every bank; deposits stay free; a failed transfer is refunded in full, charges included.');
  RAISE NOTICE 'terms | v% published from v% (section 4.10 added, everyone asked to accept)', next_ver, src.version;
END $tnc$;

DO $$
BEGIN
  IF public.wallet_stamp_duty_kobo(999999) <> 0 OR public.wallet_stamp_duty_kobo(1000000) <> 5000 THEN RAISE EXCEPTION 'stamp duty threshold wrong'; END IF;
  RAISE NOTICE 'stamp duty | ₦50 from ₦10,000, none below — ok';
END $$;
