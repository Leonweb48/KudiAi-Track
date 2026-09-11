-- ═════════════════════════════════════════════════════════════════════════════
-- Pass Flutterwave's real transfer fee (and, on the incoming side, the CBN
-- stamp-duty/collection fee already reported in their charge payload — see
-- the flutterwave-webhook edge function change alongside this migration) on
-- to the wallet owner, instead of the platform silently absorbing it. Applies
-- identically to business-owner wallets and Ajo-client wallets — both use
-- this same RPC for transfers out, so both are covered by one change.
--
-- Internal wallet-to-wallet movements (an Ajo client paying a contribution
-- into their collector's wallet, or a withdrawal payout crediting a client's
-- wallet from the owner's) are NOT a real bank transfer on Flutterwave's
-- rails — nothing is charged there, on either side, and this migration
-- doesn't touch that code path.
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.wallet_ledger DROP CONSTRAINT IF EXISTS wallet_ledger_source_check;
ALTER TABLE public.wallet_ledger ADD CONSTRAINT wallet_ledger_source_check
  CHECK (source IN (
    'topup','sale','bill_spend','bill_reversal',
    'withdrawal','withdrawal_reversal','adjustment',
    'ajo_contribution','ajo_collection','ajo_payout',
    'transfer_fee'));

CREATE OR REPLACE FUNCTION public.wallet_transfer_sent(
  p_withdrawal_id UUID, p_flw_transfer_id TEXT, p_fee_kobo BIGINT DEFAULT 0
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wd     public.wallet_withdrawals%ROWTYPE;
  v_wallet public.wallets;
  v_new    BIGINT;
BEGIN
  PERFORM set_config('kudi.allow_wallet_write', '1', true);
  UPDATE public.wallet_withdrawals SET
    status = 'processing',
    flw_transfer_id = COALESCE(p_flw_transfer_id, flw_transfer_id),
    fee_kobo = COALESCE(NULLIF(p_fee_kobo, 0), fee_kobo),
    updated_at = now()
  WHERE id = p_withdrawal_id
  RETURNING * INTO v_wd;

  -- ── Charge the real transfer fee to the same wallet, best-effort. ─────────
  -- The transfer amount itself was already held/debited at wallet_hold_transfer
  -- time (before the fee was known); this is a separate, additional debit for
  -- the fee alone, booked the moment Flutterwave reports the real number. If
  -- the wallet doesn't have quite enough left to cover a few extra naira of
  -- fee (rare — fees are small relative to the transfer just sent), this is
  -- skipped rather than blocking or reversing an already-successful transfer.
  IF FOUND AND COALESCE(p_fee_kobo, 0) > 0 THEN
    SELECT * INTO v_wallet FROM public.wallets WHERE id = v_wd.wallet_id FOR UPDATE;
    IF FOUND AND v_wallet.balance_kobo >= p_fee_kobo THEN
      v_new := v_wallet.balance_kobo - p_fee_kobo;
      UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_wallet.id;
      INSERT INTO public.wallet_ledger (
        wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
        source, status, reference, narration, related_txn_id
      ) VALUES (
        v_wallet.id, v_wd.user_id, 'debit', p_fee_kobo, v_new,
        'transfer_fee', 'completed', p_withdrawal_id::text,
        'Transfer fee', p_withdrawal_id
      );
    END IF;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_transfer_sent(UUID, TEXT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wallet_transfer_sent(UUID, TEXT, BIGINT) TO service_role;
