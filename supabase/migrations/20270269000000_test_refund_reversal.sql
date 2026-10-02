-- ONE-OFF (2026-10-02, owner's go-ahead: "work on the remaining 2"): take back the ₦10,000 test credit put into the owner's
-- own wallet by 20270265000000_test_refund_owner_wallet.sql (adjustment, reference TEST-REFUND-2026-10-02).
-- Same ledger shape as the admin correction tool (source 'adjustment', completed), so the reconciliation's adjustment
-- credits and debits cancel out. Takes back at most what is still in the wallet (never below ₦0); runs once (skips if
-- the credit is missing or already reversed). Owner found by the SHA-256 of their sign-in email (the repo is public).
-- Prints yes/no and naira amounts only.
DO $$
DECLARE v_uid uuid; v_n int; v_credit public.wallet_ledger; v_wallet public.wallets; v_take bigint; v_new bigint;
BEGIN
  SELECT count(*) INTO v_n FROM auth.users
   WHERE encode(sha256(convert_to(lower(email), 'UTF8')), 'hex') = '7f7a1e43cb6cf514cd3af398f5006d8377ec92252ee90130152f8d9a69cfbfb6';
  IF v_n <> 1 THEN RAISE NOTICE 'TEST-REFUND-REVERSAL skipped: % matching sign-ins', v_n; RETURN; END IF;
  SELECT id INTO v_uid FROM auth.users
   WHERE encode(sha256(convert_to(lower(email), 'UTF8')), 'hex') = '7f7a1e43cb6cf514cd3af398f5006d8377ec92252ee90130152f8d9a69cfbfb6';

  SELECT * INTO v_credit FROM public.wallet_ledger
   WHERE source = 'adjustment' AND flw_reference = 'TEST-REFUND-2026-10-02' AND user_id = v_uid AND direction = 'credit';
  IF NOT FOUND THEN RAISE NOTICE 'TEST-REFUND-REVERSAL skipped: the test credit is not there'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.wallet_ledger WHERE source = 'adjustment' AND reference = 'TEST-REFUND-2026-10-02-REVERSAL') THEN
    RAISE NOTICE 'TEST-REFUND-REVERSAL skipped: already reversed'; RETURN;
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE id = v_credit.wallet_id FOR UPDATE;
  v_take := LEAST(v_credit.amount_kobo, GREATEST(v_wallet.balance_kobo, 0));
  IF v_take <= 0 THEN RAISE NOTICE 'TEST-REFUND-REVERSAL: wallet is empty, nothing taken back (short ₦%)', v_credit.amount_kobo / 100; RETURN; END IF;
  v_new := v_wallet.balance_kobo - v_take;

  PERFORM set_config('kudi.allow_wallet_write', '1', true);
  UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_wallet.id;
  INSERT INTO public.wallet_ledger (wallet_id, user_id, direction, amount_kobo, balance_after_kobo, source, status, reference, narration, meta)
  VALUES (v_wallet.id, v_uid, 'debit', v_take, v_new, 'adjustment', 'completed', 'TEST-REFUND-2026-10-02-REVERSAL',
          'Test refund taken back — KudiAI',
          jsonb_build_object('reverses', 'TEST-REFUND-2026-10-02', 'reverses_ledger_id', v_credit.id, 'test', true,
                             'partial', v_take < v_credit.amount_kobo));
  RAISE NOTICE 'TEST-REFUND-REVERSAL done: taken back ₦% of ₦% (full=%)', v_take / 100, v_credit.amount_kobo / 100, v_take = v_credit.amount_kobo;
END $$;
