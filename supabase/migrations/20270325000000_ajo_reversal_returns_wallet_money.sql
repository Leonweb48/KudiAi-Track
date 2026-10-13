-- Ajo reversals move real wallet money when the original moved real wallet money (2026-10-13).
--
-- Until now ajo_reverse_contribution only corrected the savings record (client balance + a "Reversal" line). That is right
-- for cash / bank-transfer entries (no app money moved), but WRONG for a contribution the client paid from their KudiAI
-- wallet: that money went client wallet → business wallet, and a reversal left it in the business wallet while the
-- client's savings balance went down — the client simply lost it.
--
-- Now:
--   • contribution paid from a wallet (it has the 'ajo_contribution' debit ledger row) → the exact amount the client paid
--     goes back: business wallet → client wallet, two 'ajo_reversal' ledger rows. Refused (nothing changes) if the business
--     wallet can't cover it, or either wallet is closed. A platform wallet fee the client paid is not refunded (the
--     transfer service was used).
--   • withdrawal already PAID into the client's wallet → refused (taking money back out of a customer's wallet is not
--     something a reversal should do silently). A wallet payout still WAITING for that withdrawal is cancelled, so it
--     can't go out after the withdrawal was reversed.
--   • cash / transfer entries: unchanged — record only.
-- Plus a read-out of earlier reversals of wallet-paid contributions that returned nothing (counts and amounts only).

-- ── 1. new ledger source 'ajo_reversal' (extend the live list; never rewrite from a list we couldn't read) ─────────
DO $$
DECLARE v_def text; v_have text[]; v_all text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.wallet_ledger'::regclass AND conname = 'wallet_ledger_source_check';
  IF v_def IS NULL THEN RAISE EXCEPTION 'wallet_ledger_source_check not found — refusing to guess its contents'; END IF;
  SELECT COALESCE(array_agg(DISTINCT m[1]), ARRAY[]::text[]) INTO v_have FROM regexp_matches(v_def, '''([a-z_]+)''', 'g') AS m;
  IF 'ajo_reversal' = ANY (v_have) THEN RETURN; END IF;
  IF COALESCE(array_length(v_have, 1), 0) < 10 THEN
    RAISE EXCEPTION 'wallet_ledger_source_check parsed to only % sources — refusing to rewrite it. Definition: %', COALESCE(array_length(v_have, 1), 0), v_def;
  END IF;
  SELECT array_agg(DISTINCT s ORDER BY s) INTO v_all FROM unnest(v_have || ARRAY['ajo_reversal']) AS s;
  ALTER TABLE public.wallet_ledger DROP CONSTRAINT wallet_ledger_source_check;
  EXECUTE format('ALTER TABLE public.wallet_ledger ADD CONSTRAINT wallet_ledger_source_check CHECK (source IN (%s))',
                 (SELECT string_agg(quote_literal(s), ', ' ORDER BY s) FROM unnest(v_all) AS s));
END $$;

-- ── 2. the reversal ─────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION ajo_reverse_contribution(
  p_original_id UUID,
  p_owner_id    UUID,
  p_reason      TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_original      RECORD;
  v_client        RECORD;
  v_fee_rows      RECORD;
  v_balance_delta NUMERIC := 0;
  v_fee_sum       NUMERIC := 0;
  v_reversal_ids  UUID[]  := '{}';
  v_rev_net_id    UUID;
  v_rev_type      TEXT;
  v_rev_fee_type  TEXT;
  -- wallet money
  v_paid          public.wallet_ledger;       -- the client's wallet debit for the original contribution
  v_refund_kobo   BIGINT := 0;
  v_cw            public.wallets;              -- client wallet
  v_ow            public.wallets;              -- business (owner) wallet
  v_cw_new        BIGINT;
  v_ow_new        BIGINT;
  v_paid_payouts  INT := 0;
  v_cancelled     INT := 0;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Reason must be at least 5 characters');
  END IF;

  SELECT * INTO v_original FROM ajo_contributions WHERE id = p_original_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Row not found');
  END IF;

  IF v_original.status != 'completed' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not completed — only completed rows can be reversed');
  END IF;

  IF v_original.reverses_contribution_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Is a reversal — cannot reverse a reversal row');
  END IF;

  IF v_original.owner_id IS NOT NULL AND v_original.owner_id != p_owner_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unauthorized');
  END IF;

  IF v_original.fee_for_contribution_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Is a fee row — reverse the parent transaction instead');
  END IF;

  IF EXISTS (
    SELECT 1 FROM ajo_contributions WHERE reverses_contribution_id = p_original_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Already reversed');
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_fee_sum
  FROM ajo_contributions
  WHERE fee_for_contribution_id = p_original_id AND status = 'completed';

  CASE v_original.type
    WHEN 'contribution' THEN
      v_rev_type      := 'reversal_contribution';
      v_balance_delta := -(v_original.amount - v_fee_sum);
    WHEN 'withdrawal' THEN
      v_rev_type      := 'reversal_withdrawal';
      v_balance_delta := v_original.amount + v_fee_sum;
    ELSE
      RETURN jsonb_build_object('ok', false, 'error', 'Unsupported type: ' || v_original.type);
  END CASE;

  SELECT * INTO v_client FROM aso_clients WHERE id = v_original.aso_client_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Client not found');
  END IF;

  IF COALESCE(v_client.current_balance, 0) + v_balance_delta < 0 THEN
    RETURN jsonb_build_object(
      'ok',    false,
      'error', 'Client balance insufficient to reverse this entry'
    );
  END IF;

  -- ── wallet checks — all BEFORE anything is written, so a refusal changes nothing ────────────────────────────
  IF v_original.type = 'contribution' THEN
    SELECT * INTO v_paid FROM public.wallet_ledger
     WHERE related_txn_id = v_original.id AND source = 'ajo_contribution' AND direction = 'debit' AND status = 'completed'
     ORDER BY created_at LIMIT 1;
    IF FOUND THEN
      v_refund_kobo := v_paid.amount_kobo;
      -- the business wallet is the one the contribution was credited to (fallback: the owner's wallet)
      SELECT w.* INTO v_ow FROM public.wallet_ledger l JOIN public.wallets w ON w.id = l.wallet_id
       WHERE l.related_txn_id = v_original.id AND l.direction = 'credit' AND l.status = 'completed' AND l.wallet_id <> v_paid.wallet_id
       ORDER BY l.created_at LIMIT 1;
      IF NOT FOUND THEN SELECT * INTO v_ow FROM public.wallets WHERE user_id = v_original.owner_id; END IF;
      IF v_ow.id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'This contribution was paid from the client''s wallet, but your business wallet could not be found to return it.');
      END IF;
      -- lock both wallets in a fixed order (no deadlock with a transfer running the other way)
      IF v_ow.id < v_paid.wallet_id THEN
        SELECT * INTO v_ow FROM public.wallets WHERE id = v_ow.id FOR UPDATE;
        SELECT * INTO v_cw FROM public.wallets WHERE id = v_paid.wallet_id FOR UPDATE;
      ELSE
        SELECT * INTO v_cw FROM public.wallets WHERE id = v_paid.wallet_id FOR UPDATE;
        SELECT * INTO v_ow FROM public.wallets WHERE id = v_ow.id FOR UPDATE;
      END IF;
      IF v_cw.id IS NULL OR v_cw.status = 'closed' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'The client''s wallet is closed, so the money can''t be returned to it. Pay the client back another way, then record it.');
      END IF;
      IF v_ow.status <> 'active' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Your business wallet isn''t active, so the money can''t be returned from it. Contact support.');
      END IF;
      IF v_ow.balance_kobo < v_refund_kobo THEN
        RETURN jsonb_build_object('ok', false, 'code', 'wallet_short',
          'error', format('This contribution was paid from the client''s wallet, so reversing it returns ₦%s to them — but your wallet has only ₦%s. Fund your wallet, then reverse again.',
                          to_char(v_refund_kobo / 100.0, 'FM999,999,990.00'), to_char(v_ow.balance_kobo / 100.0, 'FM999,999,990.00')));
      END IF;
    END IF;
  ELSE
    SELECT count(*) INTO v_paid_payouts FROM public.ajo_wallet_payouts WHERE withdrawal_id = v_original.id AND status = 'paid';
    IF v_paid_payouts > 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'This withdrawal was already paid into the client''s wallet, so it can''t be reversed here. Ask the client to pay it back as a contribution instead.');
    END IF;
  END IF;

  -- ── the savings record (unchanged) ──────────────────────────────────────────────────────────────────────────
  INSERT INTO ajo_contributions (
    aso_client_id, owner_id, amount, type, payment_method,
    status, notes, recorded_by, reverses_contribution_id, paystack_status,
    cycle_id, group_id, contribution_context
  ) VALUES (
    v_original.aso_client_id, v_original.owner_id,
    v_original.amount, v_rev_type, v_original.payment_method,
    'completed', 'Reversal: ' || p_reason, p_owner_id,
    v_original.id, 'completed',
    v_original.cycle_id, v_original.group_id, v_original.contribution_context
  )
  RETURNING id INTO v_rev_net_id;

  v_reversal_ids := array_append(v_reversal_ids, v_rev_net_id);

  FOR v_fee_rows IN
    SELECT * FROM ajo_contributions
    WHERE fee_for_contribution_id = p_original_id AND status = 'completed'
  LOOP
    v_rev_fee_type := CASE v_fee_rows.type
      WHEN 'withdrawal_fee'    THEN 'reversal_withdrawal_fee'
      WHEN 'registration_fee'  THEN 'reversal_registration_fee'
      ELSE 'reversal_' || v_fee_rows.type
    END;

    DECLARE v_rev_fee_id UUID;
    BEGIN
      INSERT INTO ajo_contributions (
        aso_client_id, owner_id, amount, type, payment_method,
        status, notes, recorded_by,
        reverses_contribution_id, fee_for_contribution_id, paystack_status,
        cycle_id, group_id, contribution_context
      ) VALUES (
        v_fee_rows.aso_client_id, v_fee_rows.owner_id,
        v_fee_rows.amount, v_rev_fee_type, v_fee_rows.payment_method,
        'completed', 'Fee reversal: ' || p_reason, p_owner_id,
        v_fee_rows.id, v_rev_net_id, 'completed',
        v_fee_rows.cycle_id, v_fee_rows.group_id, v_fee_rows.contribution_context
      )
      RETURNING id INTO v_rev_fee_id;
      v_reversal_ids := array_append(v_reversal_ids, v_rev_fee_id);

      IF v_fee_rows.type = 'commission' AND v_fee_rows.cycle_id IS NOT NULL THEN
        UPDATE ajo_cycles SET commission_balance = 0 WHERE id = v_fee_rows.cycle_id;
      END IF;
    END;
  END LOOP;

  UPDATE aso_clients SET
    current_balance = COALESCE(current_balance, 0) + v_balance_delta,
    total_saved = CASE
      WHEN v_original.type = 'contribution'
        THEN GREATEST(0, COALESCE(total_saved, 0) - v_original.amount)
      ELSE total_saved
    END,
    total_withdrawn = CASE
      WHEN v_original.type = 'withdrawal'
        THEN GREATEST(0, COALESCE(total_withdrawn, 0) - v_original.amount)
      ELSE total_withdrawn
    END
  WHERE id = v_original.aso_client_id;

  -- ── wallet money back to the client (contribution paid from their wallet) ───────────────────────────────────
  IF v_refund_kobo > 0 THEN
    PERFORM set_config('kudi.allow_wallet_write', '1', true);
    v_ow_new := v_ow.balance_kobo - v_refund_kobo;
    v_cw_new := v_cw.balance_kobo + v_refund_kobo;
    UPDATE public.wallets SET balance_kobo = v_ow_new WHERE id = v_ow.id;
    UPDATE public.wallets SET balance_kobo = v_cw_new WHERE id = v_cw.id;
    INSERT INTO public.wallet_ledger (wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
                                      source, status, reference, narration, related_txn_id, meta)
    VALUES (v_ow.id, v_ow.user_id, 'debit', v_refund_kobo, v_ow_new,
            'ajo_reversal', 'completed', v_rev_net_id::text,
            'Contribution reversed — returned to ' || COALESCE(NULLIF(v_client.full_name, ''), 'the client'), v_rev_net_id,
            jsonb_build_object('original_contribution_id', v_original.id, 'reason', left(p_reason, 200)));
    INSERT INTO public.wallet_ledger (wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
                                      source, status, reference, narration, related_txn_id, meta)
    VALUES (v_cw.id, v_cw.user_id, 'credit', v_refund_kobo, v_cw_new,
            'ajo_reversal', 'completed', v_rev_net_id::text,
            'Savings contribution reversed — money returned', v_rev_net_id,
            jsonb_build_object('original_contribution_id', v_original.id, 'reason', left(p_reason, 200)));
  END IF;

  -- a wallet payout still waiting for a reversed withdrawal must never go out
  IF v_original.type = 'withdrawal' THEN
    UPDATE public.ajo_wallet_payouts SET status = 'cancelled', failure_reason = 'Withdrawal reversed by the business'
     WHERE withdrawal_id = v_original.id AND status = 'pending';
    GET DIAGNOSTICS v_cancelled = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok',                 true,
    'reversal_ids',       v_reversal_ids,
    'new_balance',        COALESCE(v_client.current_balance, 0) + v_balance_delta,
    'wallet_refund_kobo', v_refund_kobo,
    'payouts_cancelled',  v_cancelled
  );
END;
$$;

REVOKE ALL ON FUNCTION ajo_reverse_contribution(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION ajo_reverse_contribution(UUID, UUID, TEXT) TO service_role;

-- ── 3. read-out: earlier reversals that should have returned wallet money (counts/amounts only — CI logs are public) ──
DO $$
DECLARE r RECORD; n int := 0; total bigint := 0; covered int := 0; wd_paid int := 0; wd_pending int := 0;
BEGIN
  FOR r IN
    SELECT rev.created_at::date AS d, l.amount_kobo, ow.balance_kobo AS owner_bal, cw.status AS client_wallet_status
      FROM public.ajo_contributions rev
      JOIN public.ajo_contributions orig ON orig.id = rev.reverses_contribution_id AND orig.type = 'contribution'
      JOIN public.wallet_ledger l ON l.related_txn_id = orig.id AND l.source = 'ajo_contribution' AND l.direction = 'debit' AND l.status = 'completed'
      LEFT JOIN public.wallets cw ON cw.id = l.wallet_id
      LEFT JOIN public.wallets ow ON ow.user_id = orig.owner_id
     WHERE rev.type = 'reversal_contribution'
       AND NOT EXISTS (SELECT 1 FROM public.wallet_ledger x WHERE x.related_txn_id = rev.id AND x.source = 'ajo_reversal')
     ORDER BY rev.created_at
  LOOP
    n := n + 1; total := total + r.amount_kobo;
    IF COALESCE(r.owner_bal, 0) >= r.amount_kobo THEN covered := covered + 1; END IF;
    RAISE NOTICE 'ajo-reversal | past wallet-paid reversal #%: % · ₦% · business wallet covers it now: % · client wallet: %',
      n, r.d, to_char(r.amount_kobo / 100.0, 'FM999,999,990.00'), (COALESCE(r.owner_bal, 0) >= r.amount_kobo), COALESCE(r.client_wallet_status, 'none');
  END LOOP;
  RAISE NOTICE 'ajo-reversal | % earlier reversal(s) of wallet-paid contributions returned nothing, ₦% in total (% coverable from the business wallet today)',
    n, to_char(total / 100.0, 'FM999,999,990.00'), covered;

  SELECT count(*) FILTER (WHERE p.status = 'paid'), count(*) FILTER (WHERE p.status = 'pending') INTO wd_paid, wd_pending
    FROM public.ajo_contributions rev JOIN public.ajo_wallet_payouts p ON p.withdrawal_id = rev.reverses_contribution_id
   WHERE rev.type = 'reversal_withdrawal';
  RAISE NOTICE 'ajo-reversal | reversed withdrawals with a wallet payout: % paid, % still pending', wd_paid, wd_pending;
END $$;
