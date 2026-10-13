-- One-off (2026-10-13, owner approved): return the money for the ONE earlier reversal of a wallet-paid Ajo contribution
-- that returned nothing (found by 20270325000000's read-out: 20 Sept 2026, ₦175). Same movement the fixed
-- ajo_reverse_contribution now makes: business wallet → client wallet, two 'ajo_reversal' ledger rows.
-- Strict: if the live data isn't exactly one such reversal totalling ₦175, or a wallet can't take it, NOTHING moves.
-- Re-running is safe: a refunded reversal has an 'ajo_reversal' ledger row and is no longer selected.

DO $$
DECLARE
  c_expected_count CONSTANT int    := 1;
  c_expected_kobo  CONSTANT bigint := 17500;
  r      RECORD;
  n      int := 0;
  total  bigint := 0;
  v_ow   public.wallets;
  v_cw   public.wallets;
  v_ow_new bigint;
  v_cw_new bigint;
BEGIN
  SELECT count(*), COALESCE(sum(l.amount_kobo), 0) INTO n, total
    FROM public.ajo_contributions rev
    JOIN public.ajo_contributions orig ON orig.id = rev.reverses_contribution_id AND orig.type = 'contribution'
    JOIN public.wallet_ledger l ON l.related_txn_id = orig.id AND l.source = 'ajo_contribution' AND l.direction = 'debit' AND l.status = 'completed'
   WHERE rev.type = 'reversal_contribution'
     AND NOT EXISTS (SELECT 1 FROM public.wallet_ledger x WHERE x.related_txn_id = rev.id AND x.source = 'ajo_reversal');

  IF n = 0 THEN
    RAISE NOTICE 'reversal-refund | nothing to refund (already done)';
    RETURN;
  END IF;
  IF n <> c_expected_count OR total <> c_expected_kobo THEN
    RAISE NOTICE 'reversal-refund | found % reversal(s) totalling ₦% — not the approved % / ₦%; nothing moved',
      n, to_char(total / 100.0, 'FM999,999,990.00'), c_expected_count, to_char(c_expected_kobo / 100.0, 'FM999,999,990.00');
    RETURN;
  END IF;

  FOR r IN
    SELECT rev.id AS rev_id, orig.id AS orig_id, orig.owner_id, l.amount_kobo, l.wallet_id AS client_wallet_id,
           (SELECT full_name FROM public.aso_clients c WHERE c.id = orig.aso_client_id) AS client_name
      FROM public.ajo_contributions rev
      JOIN public.ajo_contributions orig ON orig.id = rev.reverses_contribution_id AND orig.type = 'contribution'
      JOIN public.wallet_ledger l ON l.related_txn_id = orig.id AND l.source = 'ajo_contribution' AND l.direction = 'debit' AND l.status = 'completed'
     WHERE rev.type = 'reversal_contribution'
       AND NOT EXISTS (SELECT 1 FROM public.wallet_ledger x WHERE x.related_txn_id = rev.id AND x.source = 'ajo_reversal')
  LOOP
    -- the business wallet the contribution was credited to (fallback: the owner's wallet)
    SELECT w.* INTO v_ow FROM public.wallet_ledger cl JOIN public.wallets w ON w.id = cl.wallet_id
     WHERE cl.related_txn_id = r.orig_id AND cl.direction = 'credit' AND cl.status = 'completed' AND cl.wallet_id <> r.client_wallet_id
     ORDER BY cl.created_at LIMIT 1;
    IF NOT FOUND THEN SELECT * INTO v_ow FROM public.wallets WHERE user_id = r.owner_id; END IF;

    IF v_ow.id < r.client_wallet_id THEN
      SELECT * INTO v_ow FROM public.wallets WHERE id = v_ow.id FOR UPDATE;
      SELECT * INTO v_cw FROM public.wallets WHERE id = r.client_wallet_id FOR UPDATE;
    ELSE
      SELECT * INTO v_cw FROM public.wallets WHERE id = r.client_wallet_id FOR UPDATE;
      SELECT * INTO v_ow FROM public.wallets WHERE id = v_ow.id FOR UPDATE;
    END IF;

    IF v_ow.id IS NULL OR v_ow.status <> 'active' OR v_ow.balance_kobo < r.amount_kobo THEN
      RAISE EXCEPTION 'reversal-refund | business wallet missing, inactive or short — nothing moved';
    END IF;
    IF v_cw.id IS NULL OR v_cw.status = 'closed' THEN
      RAISE EXCEPTION 'reversal-refund | client wallet missing or closed — nothing moved';
    END IF;

    PERFORM set_config('kudi.allow_wallet_write', '1', true);
    v_ow_new := v_ow.balance_kobo - r.amount_kobo;
    v_cw_new := v_cw.balance_kobo + r.amount_kobo;
    UPDATE public.wallets SET balance_kobo = v_ow_new WHERE id = v_ow.id;
    UPDATE public.wallets SET balance_kobo = v_cw_new WHERE id = v_cw.id;
    INSERT INTO public.wallet_ledger (wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
                                      source, status, reference, narration, related_txn_id, meta)
    VALUES (v_ow.id, v_ow.user_id, 'debit', r.amount_kobo, v_ow_new, 'ajo_reversal', 'completed', r.rev_id::text,
            'Contribution reversed — returned to ' || COALESCE(NULLIF(r.client_name, ''), 'the client'), r.rev_id,
            jsonb_build_object('original_contribution_id', r.orig_id, 'late_refund', true));
    INSERT INTO public.wallet_ledger (wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
                                      source, status, reference, narration, related_txn_id, meta)
    VALUES (v_cw.id, v_cw.user_id, 'credit', r.amount_kobo, v_cw_new, 'ajo_reversal', 'completed', r.rev_id::text,
            'Savings contribution reversed — money returned', r.rev_id,
            jsonb_build_object('original_contribution_id', r.orig_id, 'late_refund', true));
    RAISE NOTICE 'reversal-refund | returned ₦% to the client''s wallet (business wallet covered it)', to_char(r.amount_kobo / 100.0, 'FM999,999,990.00');
  END LOOP;
END $$;
