-- ═════════════════════════════════════════════════════════════════════════════
-- CBN Electronic Money Transfer Levy (₦50 flat, on electronic transfers of
-- ₦10,000 or more) — applied on both directions of real, bank-touching wallet
-- movement: funding the wallet from a bank (topup) and transferring out of the
-- wallet to a bank (Transfer). Every fee collected — this levy, and on the
-- outgoing side Flutterwave's own real transfer fee — is credited to a
-- dedicated platform settlement wallet instead of just vanishing from the
-- ledger, so KudiAI can see and eventually withdraw accumulated fee revenue
-- through the exact same wallet machinery everyone else uses.
--
-- Deliberately NOT applied to internal wallet-to-wallet movement (an Ajo
-- client's contribution into their collector's wallet, or a withdrawal payout
-- crediting a client from the owner) — that money never leaves KudiAI's own
-- ledger onto the interbank electronic transfer rails, so no CBN levy is
-- actually incurred there.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. The platform settlement wallet ───────────────────────────────────────
-- A fixed, well-known system account — not a real login (no password set via
-- this migration; the wallet is only ever touched by the RPCs below and read
-- by admins directly). Idempotent: safe to re-run.
DO $$
DECLARE
  v_settlement_id CONSTANT UUID := '00000000-0000-0000-0000-000000000001';
BEGIN
  INSERT INTO auth.users (id, email, aud, role)
  VALUES (v_settlement_id, 'settlement@kudiai.app', 'authenticated', 'authenticated')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, email, business_name, full_name)
  VALUES (v_settlement_id, 'settlement@kudiai.app', 'KudiAI Settlement', 'KudiAI Settlement')
  ON CONFLICT (id) DO NOTHING;

  PERFORM set_config('kudi.allow_wallet_write', '1', true);
  INSERT INTO public.wallets (user_id, balance_kobo, status)
  VALUES (v_settlement_id, 0, 'active')
  ON CONFLICT (user_id) DO NOTHING;
END $$;

-- ── 2. CBN levy calculator ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wallet_cbn_levy_kobo(p_amount_kobo BIGINT)
RETURNS BIGINT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN COALESCE(p_amount_kobo, 0) >= 1000000 THEN 5000 ELSE 0 END;
$$;
REVOKE ALL ON FUNCTION public.wallet_cbn_levy_kobo(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wallet_cbn_levy_kobo(BIGINT) TO authenticated, service_role;

-- ── 3. Internal helper: credit the settlement wallet ────────────────────────
-- Not exposed to any role directly — called only from within the SECURITY
-- DEFINER RPCs below, in the same transaction as the matching user-side debit.
CREATE OR REPLACE FUNCTION public.wallet_credit_settlement(
  p_amount_kobo    BIGINT,
  p_source         TEXT,
  p_narration      TEXT,
  p_related_txn_id UUID DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_settlement_id CONSTANT UUID := '00000000-0000-0000-0000-000000000001';
  v_wallet public.wallets;
  v_new    BIGINT;
BEGIN
  IF COALESCE(p_amount_kobo, 0) <= 0 THEN RETURN; END IF;

  PERFORM set_config('kudi.allow_wallet_write', '1', true);
  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_settlement_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.wallets (user_id, balance_kobo, status) VALUES (v_settlement_id, 0, 'active')
    ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
    RETURNING * INTO v_wallet;
  END IF;

  v_new := v_wallet.balance_kobo + p_amount_kobo;
  UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_wallet.id;

  INSERT INTO public.wallet_ledger (
    wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
    source, status, narration, related_txn_id
  ) VALUES (
    v_wallet.id, v_settlement_id, 'credit', p_amount_kobo, v_new,
    p_source, 'completed', p_narration, p_related_txn_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_credit_settlement(BIGINT, TEXT, TEXT, UUID) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_credit_settlement(BIGINT, TEXT, TEXT, UUID) TO service_role;

-- ── 4. Widen the ledger source check for the new fee/settlement source ─────
ALTER TABLE public.wallet_ledger DROP CONSTRAINT IF EXISTS wallet_ledger_source_check;
ALTER TABLE public.wallet_ledger ADD CONSTRAINT wallet_ledger_source_check
  CHECK (source IN (
    'topup','sale','bill_spend','bill_reversal',
    'withdrawal','withdrawal_reversal','adjustment',
    'ajo_contribution','ajo_collection','ajo_payout',
    'transfer_fee','cbn_levy'));

-- ── 5. wallet_transfer_sent — outgoing transfer: FLW fee (unchanged from the
--       prior migration) + CBN levy (new), both charged to the sender and
--       both credited to settlement. Exact same guard structure/shape as the
--       live version this replaces — only the new levy block is added. ─────
CREATE OR REPLACE FUNCTION public.wallet_transfer_sent(
  p_withdrawal_id UUID, p_flw_transfer_id TEXT, p_fee_kobo BIGINT DEFAULT 0
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wd     public.wallet_withdrawals%ROWTYPE;
  v_wallet public.wallets;
  v_new    BIGINT;
  v_levy   BIGINT;
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
      PERFORM public.wallet_credit_settlement(p_fee_kobo, 'transfer_fee',
        'Transfer fee — withdrawal ' || p_withdrawal_id::text, p_withdrawal_id);
    END IF;
  END IF;

  -- ── NEW: CBN electronic money transfer levy (₦50, transfers ≥ ₦10,000) —
  --    same best-effort balance check, independent of the FLW fee above. ────
  IF FOUND THEN
    v_levy := public.wallet_cbn_levy_kobo(v_wd.amount_kobo);
    IF v_levy > 0 THEN
      SELECT * INTO v_wallet FROM public.wallets WHERE id = v_wd.wallet_id FOR UPDATE;
      IF FOUND AND v_wallet.balance_kobo >= v_levy THEN
        v_new := v_wallet.balance_kobo - v_levy;
        UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_wallet.id;
        INSERT INTO public.wallet_ledger (
          wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
          source, status, reference, narration, related_txn_id
        ) VALUES (
          v_wallet.id, v_wd.user_id, 'debit', v_levy, v_new,
          'cbn_levy', 'completed', p_withdrawal_id::text,
          'CBN electronic transfer levy', p_withdrawal_id
        );
        PERFORM public.wallet_credit_settlement(v_levy, 'cbn_levy',
          'CBN levy — withdrawal ' || p_withdrawal_id::text, p_withdrawal_id);
      END IF;
    END IF;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_transfer_sent(UUID, TEXT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wallet_transfer_sent(UUID, TEXT, BIGINT) TO service_role;

-- ── 6. wallet_credit — incoming topup: CBN levy on ≥ ₦10,000, credited to
--       settlement, net credited to the wallet. Applies only to source='topup'
--       (a real bank transfer in) — sales/ajo/adjustment/etc. are untouched.
--       Exact same structure/idempotency-on-conflict shape as the live
--       version this replaces (flw_reference column + partial unique index,
--       early-return on a duplicate without re-crediting) — only the levy
--       split and the settlement credit (on the fresh-insert path only) are
--       new. ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wallet_credit(
  p_user_id       UUID,
  p_amount_kobo   BIGINT,
  p_source        TEXT,
  p_flw_reference TEXT,
  p_narration     TEXT DEFAULT NULL,
  p_meta          JSONB DEFAULT '{}'::jsonb
) RETURNS public.wallet_ledger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wallet public.wallets;
  v_row    public.wallet_ledger;
  v_new    BIGINT;
  v_levy   BIGINT := 0;
  v_net    BIGINT;
BEGIN
  IF p_amount_kobo IS NULL OR p_amount_kobo <= 0 THEN
    RAISE EXCEPTION 'credit amount must be positive';
  END IF;

  -- idempotency: return the existing row if this reference was already credited
  IF p_flw_reference IS NOT NULL THEN
    SELECT * INTO v_row FROM public.wallet_ledger
     WHERE source = p_source AND flw_reference = p_flw_reference;
    IF FOUND THEN RETURN v_row; END IF;
  END IF;

  v_net := p_amount_kobo;
  IF p_source = 'topup' THEN
    v_levy := public.wallet_cbn_levy_kobo(p_amount_kobo);
    v_net  := p_amount_kobo - v_levy;
  END IF;

  PERFORM set_config('kudi.allow_wallet_write', '1', true);

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.wallets (user_id) VALUES (p_user_id) RETURNING * INTO v_wallet;
  END IF;

  v_new := v_wallet.balance_kobo + v_net;

  -- Insert the ledger row first. If a concurrent call already credited this
  -- reference the partial unique index rejects it → no row back → do NOT touch
  -- the balance or credit settlement again, just return the row that won.
  IF p_flw_reference IS NOT NULL THEN
    INSERT INTO public.wallet_ledger (
      wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
      source, status, flw_reference, narration, meta
    ) VALUES (
      v_wallet.id, p_user_id, 'credit', v_net, v_new,
      p_source, 'completed', p_flw_reference, p_narration,
      CASE WHEN v_levy > 0 THEN COALESCE(p_meta, '{}'::jsonb) || jsonb_build_object('gross_amount_kobo', p_amount_kobo, 'fee_kobo', v_levy)
           ELSE COALESCE(p_meta, '{}'::jsonb) END
    )
    ON CONFLICT (source, flw_reference) WHERE flw_reference IS NOT NULL DO NOTHING
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
      SELECT * INTO v_row FROM public.wallet_ledger
       WHERE source = p_source AND flw_reference = p_flw_reference;
      RETURN v_row;
    END IF;
  ELSE
    INSERT INTO public.wallet_ledger (
      wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
      source, status, flw_reference, narration, meta
    ) VALUES (
      v_wallet.id, p_user_id, 'credit', v_net, v_new,
      p_source, 'completed', NULL, p_narration,
      CASE WHEN v_levy > 0 THEN COALESCE(p_meta, '{}'::jsonb) || jsonb_build_object('gross_amount_kobo', p_amount_kobo, 'fee_kobo', v_levy)
           ELSE COALESCE(p_meta, '{}'::jsonb) END
    )
    RETURNING * INTO v_row;
  END IF;

  UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_wallet.id;

  IF v_levy > 0 THEN
    PERFORM public.wallet_credit_settlement(v_levy, 'cbn_levy',
      'CBN levy — wallet top-up ' || COALESCE(p_flw_reference, v_row.id::text), v_row.id);
  END IF;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_credit(UUID, BIGINT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_credit(UUID, BIGINT, TEXT, TEXT, TEXT, JSONB) TO service_role;
