-- Wallet-to-wallet "Charge fee" (owner's decision 2026-10-19): ₦10 on every move between KudiAI wallets, for business
-- owners AND clients, no free ones. Shown before the PIN ("Charge fee") and on the history line; labelled "Charge fee",
-- never as a payment-partner cost.
--
-- Every wallet-move fee block already reads
--   IF wallet_daily_transfer_count(payer) > 3 THEN v_wfee := wallet_transfer_fee_kobo(amount) ...
-- (client savings payments — wallet_pay_ajo_contribution; circle contributions — peer_esusu_pay_contribution;
--  a business paying a client's approved withdrawal into the client's wallet — ajo_settle_due_wallet_payouts, also
--  used by the instant payout). So the price is set here, in those two helpers, without touching the callers:
--   - wallet_move_fee_kobo        (₦10)  the fee per move
--   - wallet_move_free_per_day    (0)    free moves a day before the fee starts (any tier)
-- Receiving money, deposits, Invite & Earn rewards, refunds/reversals and circle payouts carry no Charge fee.
-- If the payer's balance can't cover the fee after the payment, the callers skip it (unchanged behaviour).

INSERT INTO public.platform_config (key, value, description) VALUES
  ('wallet_move_fee_kobo',     '1000', 'Charge fee on every move between KudiAI wallets (savings payments, circle contributions, payouts into a client wallet), kobo. Paid by the sender.'),
  ('wallet_move_free_per_day', '0',    'Free wallet-to-wallet moves a day before the Charge fee applies (all wallets).')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description, updated_at = now();

CREATE OR REPLACE FUNCTION public.wallet_transfer_fee_kobo(p_amount_kobo bigint)
RETURNS bigint LANGUAGE sql STABLE SET search_path = public AS $function$
  SELECT GREATEST(public.wallet_cfg_int('wallet_move_fee_kobo', 1000), 0)::bigint;
$function$;

-- The callers charge when this is > 3. With no free moves it always is; otherwise it is today's moves shifted so the
-- fee starts after `wallet_move_free_per_day` of them.
CREATE OR REPLACE FUNCTION public.wallet_daily_transfer_count(p_user_id UUID)
RETURNS INT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_free int := public.wallet_cfg_int('wallet_move_free_per_day', 0);
BEGIN
  IF v_free <= 0 THEN RETURN 1000; END IF;
  RETURN 3 - v_free + (SELECT count(*)::int FROM public.wallet_ledger
           WHERE user_id = p_user_id
             AND direction = 'debit'
             AND source IN ('ajo_contribution', 'ajo_payout', 'peer_esusu_contribution')
             AND status = 'completed'
             AND (created_at AT TIME ZONE 'Africa/Lagos')::date = (now() AT TIME ZONE 'Africa/Lagos')::date);
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_daily_transfer_count(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wallet_daily_transfer_count(UUID) TO authenticated, service_role;

-- The fee line in the customer's history reads "Charge fee" (the callers' old narrations mention "daily free transfers").
CREATE OR REPLACE FUNCTION public.wallet_fee_narration()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.source = 'wallet_fee' AND NEW.direction = 'debit' THEN NEW.narration := 'Charge fee'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_wallet_fee_narration ON public.wallet_ledger;
CREATE TRIGGER trg_wallet_fee_narration BEFORE INSERT ON public.wallet_ledger
  FOR EACH ROW WHEN (NEW.source = 'wallet_fee') EXECUTE FUNCTION public.wallet_fee_narration();
REVOKE ALL ON FUNCTION public.wallet_fee_narration() FROM PUBLIC, anon, authenticated;

-- ── Terms v11: 4.10(d), and the client bank-transfer line no longer refers to our payment partner ─────────────────
DO $tnc$
DECLARE
  src      public.legal_documents%ROWTYPE;
  next_ver integer;
  today    text := trim(to_char(now() AT TIME ZONE 'Africa/Lagos', 'FMDD FMMonth YYYY'));
  old_d    text := '<p><strong>(d) Moves between KudiAI wallets</strong> (for example Ajo/Esusu savings payments, savings circle contributions and payouts) are <strong>always free for Ajo/Esusu Clients and personal wallets</strong>. For Business Owners they are free for the first 3 each day, then ₦10 for amounts below ₦10,000 and ₦50 for ₦10,000 or more.</p>';
  new_d    text := '<p><strong>(d) Moves between KudiAI wallets</strong> (for example Ajo/Esusu savings payments, savings circle contributions and a business paying a client''s approved withdrawal into the client''s wallet) carry a <strong>charge fee of ₦10</strong> each, paid by the sender and shown before you confirm. This applies to Business Owners, Ajo/Esusu Clients and personal wallets alike. Receiving money is free.</p>';
  old_cl   text := '<p><strong>Ajo/Esusu Clients and personal wallets</strong> pay only what our payment partner charges us for each bank transfer (there are no free bank transfers):</p>';
  new_cl   text := '<p><strong>Ajo/Esusu Clients and personal wallets</strong> pay a transfer fee for each bank transfer (there are no free bank transfers):</p>';
  content  text;
  body     text;
BEGIN
  SELECT * INTO src FROM public.legal_documents WHERE type = 'tnc' AND status = 'published' ORDER BY version DESC LIMIT 1;
  IF NOT FOUND THEN RAISE NOTICE 'terms | no published copy, skipped'; RETURN; END IF;
  content := replace(src.content, E'\r\n', E'\n');
  IF position(new_d IN content) > 0 THEN RAISE NOTICE 'terms | v% already has the charge fee, skipped', src.version; RETURN; END IF;
  IF position(old_d IN content) = 0 THEN
    RAISE NOTICE 'terms | 4.10(d) text not found in v% (edited by hand?) — NOT published, update the Terms in admin', src.version; RETURN;
  END IF;
  SELECT max(version) + 1 INTO next_ver FROM public.legal_documents WHERE type = 'tnc';
  body := replace(replace(content, old_d, new_d), old_cl, new_cl);
  body := regexp_replace(body,
    '<p><strong>Effective Date:</strong>[^<]*<br><strong>Last Updated:</strong>[^<]*<br><strong>Version:</strong>[^<]*</p>',
    '<p><strong>Effective Date:</strong> ' || today || '<br><strong>Last Updated:</strong> ' || today || '<br><strong>Version:</strong> ' || next_ver || '</p>');
  INSERT INTO public.legal_documents (type, content, version, status, published_at, published_by, editor_name, requires_reacceptance, change_summary)
  VALUES ('tnc', body, next_ver, 'published', now(), 'system', 'System', true,
    'Section 4.10(d) updated: every move between KudiAI wallets (savings payments, savings circle contributions, payouts into a client''s wallet) now carries a ₦10 charge fee, paid by the sender and shown before you confirm — for Business Owners, Ajo/Esusu Clients and personal wallets. Receiving money stays free. Bank transfer fees are unchanged.');
  RAISE NOTICE 'terms | v% published from v% (wallet-to-wallet charge fee)', next_ver, src.version;
END $tnc$;

DO $$
BEGIN
  RAISE NOTICE 'charge fee | per move ₦% | free a day % | gate value %',
    public.wallet_transfer_fee_kobo(500000) / 100, public.wallet_cfg_int('wallet_move_free_per_day', -1),
    public.wallet_daily_transfer_count('00000000-0000-0000-0000-000000000000');
END $$;
