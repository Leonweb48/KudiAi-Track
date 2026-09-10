-- ═════════════════════════════════════════════════════════════════════════════
-- transfer.disburse webhook: match the withdrawal by our reference too.
--
-- The payout succeeded but flw_transfer_id was stored empty (a since-fixed edge
-- bug), so the webhook couldn't match the row and it stuck at 'processing'.
-- The webhook payload also echoes data.reference = our wallet_withdrawals.id, so
-- match on either, and backfill flw_transfer_id when found by reference.
-- Also finalises the one row that got stuck.
-- ═════════════════════════════════════════════════════════════════════════════

-- replace the 2-arg version so a 2-arg call can't resolve to the old logic
DROP FUNCTION IF EXISTS public.wallet_mark_withdrawal(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.wallet_mark_withdrawal(
  p_flw_transfer_id TEXT,
  p_status          TEXT,
  p_reference       TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wd     public.wallet_withdrawals%ROWTYPE;
  v_wallet public.wallets;
  v_new    BIGINT;
  v_txn_id UUID;
  v_ref_id UUID;
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
    UPDATE public.wallet_withdrawals SET status = p_status, updated_at = now() WHERE id = v_wd.id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_mark_withdrawal(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wallet_mark_withdrawal(TEXT, TEXT, TEXT) TO service_role;

-- ── finalise the stuck payout (trf_ou7ESvBg5CQJG43RGZous / ref b29ec81c…) ────
DO $$
BEGIN
  PERFORM public.wallet_mark_withdrawal(
    'trf_ou7ESvBg5CQJG43RGZous', 'successful',
    'b29ec81c-f002-4c49-b847-9d12a6dc803f');
END $$;
