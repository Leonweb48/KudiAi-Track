-- Owner's decision 2026-10-23: a client's savings payout into the client's own KudiAI wallet (a business approving the
-- client's withdrawal request, Ajo or Esusu) is FREE — no ₦10 charge fee and so no VAT on it. The only fee on a savings
-- withdrawal is the savings fee already shown on the request (the card's withdrawal fee / commission, per the one-fee
-- rule). Before, the business was charged the ₦10 charge fee (+ ₦0.75 VAT since 20270390) and approval was refused
-- unless its wallet covered payout + fee (20270360).
--
-- Edited in place, refusing to guess if the text isn't found exactly once:
--   ajo_settle_due_wallet_payouts — the payout itself: the charge-fee block never runs
--   ajo_wallet_payout_now_check   — the approval check: the payout amount only (20270360's additions reverted)
-- Other wallet-to-wallet moves (savings payments, circle contributions) keep the charge fee.

DO $mig$
DECLARE
  v_def text; n int;
  f_old constant text := 'IF public.wallet_daily_transfer_count(v_row.owner_id) > 3 THEN';
  f_new constant text := 'IF false THEN   -- savings payouts into a client''s wallet are free: no charge fee, no VAT (owner, 2026-10-23)';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'ajo_settle_due_wallet_payouts';
  IF v_def IS NULL THEN RAISE EXCEPTION 'ajo_settle_due_wallet_payouts not found'; END IF;
  IF position('savings payouts into a client''s wallet are free' IN v_def) > 0 THEN
    RAISE NOTICE 'free payouts | payout already free';
  ELSE
    n := (length(v_def) - length(replace(v_def, f_old, ''))) / length(f_old);
    IF n <> 1 THEN RAISE EXCEPTION 'ajo_settle_due_wallet_payouts: fee block found % times — refusing to guess', n; END IF;
    EXECUTE replace(v_def, f_old, f_new);
    RAISE NOTICE 'free payouts | payout charge fee removed';
  END IF;
END $mig$;

DO $mig2$
DECLARE
  v_def text; n int;
  c_new constant text := 'IF v_bal < NEW.amount_kobo + public.wallet_move_fee_due(NEW.owner_id, NEW.amount_kobo) THEN   -- payout + Charge fee (2026-10-19)';
  c_old constant text := 'IF v_bal < NEW.amount_kobo THEN   -- the payout only: savings payouts carry no charge fee (2026-10-23)';
  a_new constant text := 'is ₦% including the ₦10 charge fee. Top up your wallet, then approve again.''';
  a_old constant text := 'is ₦%. Top up your wallet, then approve again.''';
  b_new constant text := 'to_char((NEW.amount_kobo + public.wallet_move_fee_due(NEW.owner_id, NEW.amount_kobo)) / 100.0, ''FM999,999,999,990.00'');';
  b_old constant text := 'to_char(NEW.amount_kobo / 100.0, ''FM999,999,999,990.00'');';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'ajo_wallet_payout_now_check';
  IF v_def IS NULL THEN RAISE EXCEPTION 'ajo_wallet_payout_now_check not found'; END IF;
  IF position('savings payouts carry no charge fee (2026-10-23)' IN v_def) > 0 THEN RAISE NOTICE 'free payouts | check already reverted'; RETURN; END IF;
  FOREACH n IN ARRAY ARRAY[1, 2, 3] LOOP
    IF (length(v_def) - length(replace(v_def, (ARRAY[c_new, a_new, b_new])[n], ''))) / length((ARRAY[c_new, a_new, b_new])[n]) <> 1 THEN
      RAISE EXCEPTION 'ajo_wallet_payout_now_check: piece % not found exactly once — refusing to guess', n;
    END IF;
  END LOOP;
  EXECUTE replace(replace(replace(v_def, c_new, c_old), a_new, a_old), b_new, b_old);
  RAISE NOTICE 'free payouts | approval check is the payout amount only';
END $mig2$;

-- the in-place edits keep each function's grants; restate them
REVOKE ALL ON FUNCTION public.ajo_wallet_payout_now_check() FROM PUBLIC, anon, authenticated;

-- ── Terms: 4.10(d) — savings payouts into the client's wallet are free (no re-acceptance prompt: owner's rule) ─────
DO $tnc$
DECLARE
  src      public.legal_documents%ROWTYPE;
  next_ver integer;
  today    text := trim(to_char(now() AT TIME ZONE 'Africa/Lagos', 'FMDD FMMonth YYYY'));
  old_d    text := '<p><strong>(d) Moves between KudiAI wallets</strong> (for example Ajo/Esusu savings payments, savings circle contributions and a business paying a client''s approved withdrawal into the client''s wallet) carry a <strong>charge fee of ₦10</strong> each, paid by the sender and shown before you confirm. This applies to Business Owners, Ajo/Esusu Clients and personal wallets alike. Receiving money is free.</p>';
  new_d    text := '<p><strong>(d) Moves between KudiAI wallets</strong> (for example Ajo/Esusu savings payments and savings circle contributions) carry a <strong>charge fee of ₦10</strong> each, paid by the sender and shown before you confirm. This applies to Business Owners, Ajo/Esusu Clients and personal wallets alike. Receiving money is free. <strong>A client''s savings withdrawal paid into the client''s own KudiAI wallet is free</strong> — no charge fee and no VAT; the only fee is the savings fee shown on the withdrawal request.</p>';
  content  text;
  body     text;
BEGIN
  SELECT * INTO src FROM public.legal_documents WHERE type = 'tnc' AND status = 'published' ORDER BY version DESC LIMIT 1;
  IF NOT FOUND THEN RAISE NOTICE 'terms | no published copy, skipped'; RETURN; END IF;
  content := replace(src.content, E'\r\n', E'\n');
  IF position(new_d IN content) > 0 THEN RAISE NOTICE 'terms | v% already has it, skipped', src.version; RETURN; END IF;
  IF position(old_d IN content) = 0 THEN
    RAISE NOTICE 'terms | 4.10(d) text not found in v% (edited by hand?) — NOT published, update the Terms in admin', src.version; RETURN;
  END IF;
  SELECT max(version) + 1 INTO next_ver FROM public.legal_documents WHERE type = 'tnc';
  body := replace(content, old_d, new_d);
  body := regexp_replace(body,
    '<p><strong>Effective Date:</strong>[^<]*<br><strong>Last Updated:</strong>[^<]*<br><strong>Version:</strong>[^<]*</p>',
    '<p><strong>Effective Date:</strong> ' || today || '<br><strong>Last Updated:</strong> ' || today || '<br><strong>Version:</strong> ' || next_ver || '</p>');
  INSERT INTO public.legal_documents (type, content, version, status, published_at, published_by, editor_name, requires_reacceptance, change_summary)
  VALUES ('tnc', body, next_ver, 'published', now(), 'system', 'System', false,
    'Section 4.10(d): a client''s savings withdrawal paid into the client''s own KudiAI wallet is now free — no charge fee and no VAT.');
  RAISE NOTICE 'terms | v% published from v% WITHOUT a re-acceptance prompt', next_ver, src.version;
END $tnc$;
