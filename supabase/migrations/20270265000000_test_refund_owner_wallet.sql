-- ONE-OFF TEST CREDIT (2026-10-02), requested by the platform owner ("do a test refund of 10000 to the account, I want to
-- monitor something"; chose: their OWN wallet, to be taken back afterwards). Credits ₦10,000 to the owner's own KudiAI
-- wallet as an 'adjustment' — NOT 'bill_reversal', which the append-only finance ledger would book as a real bill refund.
-- The owner is found by the SHA-256 of their sign-in email (the repo is public — the address itself is not written here).
-- Idempotent: wallet_credit ignores a second credit with the same (source, reference). Never creates a wallet. The matching
-- reversal is a separate migration, run when the owner says they are done. Prints yes/no only.
DO $$
DECLARE v_uid uuid; v_n int; v_row public.wallet_ledger;
BEGIN
  SELECT count(*) INTO v_n FROM auth.users
   WHERE encode(sha256(convert_to(lower(email), 'UTF8')), 'hex') = '7f7a1e43cb6cf514cd3af398f5006d8377ec92252ee90130152f8d9a69cfbfb6';
  IF v_n <> 1 THEN RAISE NOTICE 'TEST-REFUND skipped: % matching sign-ins (need exactly 1)', v_n; RETURN; END IF;
  SELECT id INTO v_uid FROM auth.users
   WHERE encode(sha256(convert_to(lower(email), 'UTF8')), 'hex') = '7f7a1e43cb6cf514cd3af398f5006d8377ec92252ee90130152f8d9a69cfbfb6';

  IF NOT EXISTS (SELECT 1 FROM public.wallets WHERE user_id = v_uid) THEN
    RAISE NOTICE 'TEST-REFUND skipped: the owner has no wallet';
    RETURN;
  END IF;

  v_row := public.wallet_credit(v_uid, 1000000, 'adjustment', 'TEST-REFUND-2026-10-02',
                                'Test refund — KudiAI (will be taken back)', '{"test": true, "requested_by": "owner"}'::jsonb);
  RAISE NOTICE 'TEST-REFUND credited=% amount_ok=% status=%', v_row.id IS NOT NULL, v_row.amount_kobo = 1000000, v_row.status;
END $$;
