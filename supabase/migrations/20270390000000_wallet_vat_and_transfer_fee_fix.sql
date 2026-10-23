-- Owner's decision (2026-10-23, approved): Amaya & Co. Technologies is VAT-registered. 7.5% VAT is added to our wallet
-- FEES — the bank transfer fee, the ₦10 wallet-to-wallet "Charge fee" and the Free-plan deposit fee — and remitted to the
-- Nigeria Revenue Service (formerly FIRS). VAT is on the fee only, never on the money moved; stamp duty carries none.
--
-- How: one rule for every path. Whenever a fee debit ('transfer_fee', 'wallet_fee', 'deposit_fee') is written to a
-- customer's ledger, the trigger below takes VAT on that fee as its OWN line ('vat', "VAT 7.5% on transfer fee") and
-- credits it to the settlement wallet, so the customer sees it separately and the business knows exactly what to remit
-- (finance line 'wallet.vat_payable', outside profit). Once per fee (unique on the fee's ledger id); a VAT that can't be
-- taken (balance short, circle-pot guard) never blocks the payment. Switch: platform_config.wallet_vat_enabled.
--
-- Also fixed here (found while mapping the fees): wallet_transfer_sent only charged a transfer still 'pending', but
-- transfers have been created 'processing' since 20270178 — so NO bank transfer fee or stamp duty was taken (readout
-- 20270389: 0 of 7 transfers since 21 Oct). It now charges once Flutterwave has accepted the transfer, whatever its
-- interim status, exactly once (guarded by the fee/duty rows themselves). Past transfers are NOT back-charged.

-- ── 1. settings ────────────────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO public.platform_config (key, value, description) VALUES
  ('wallet_vat_enabled', 'true', 'Charge VAT on wallet fees (transfer fee, wallet charge fee, deposit fee). true / false.'),
  ('wallet_vat_rate_bp', '750',  'VAT rate on wallet fees in basis points (750 = 7.5%).')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.wallet_vat_kobo(p_fee_kobo bigint) RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_fee_kobo IS NULL OR p_fee_kobo <= 0 THEN RETURN 0; END IF;
  IF lower(coalesce((SELECT value FROM public.platform_config WHERE key = 'wallet_vat_enabled'), 'false')) <> 'true' THEN RETURN 0; END IF;
  RETURN round(p_fee_kobo * GREATEST(public.wallet_cfg_int('wallet_vat_rate_bp', 750), 0) / 10000.0)::bigint;
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_vat_kobo(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_vat_kobo(bigint) TO service_role;

-- ── 2. 'vat' is a ledger source ─────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_def text; v_have text[];
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_constraint c
   WHERE c.conrelid = 'public.wallet_ledger'::regclass AND c.conname = 'wallet_ledger_source_check';
  IF v_def IS NULL THEN RAISE NOTICE 'vat | no source check constraint, nothing to extend'; RETURN; END IF;
  SELECT array_agg(m[1]) INTO v_have FROM regexp_matches(v_def, '''([a-z_]+)''', 'g') AS m;
  IF 'vat' = ANY(v_have) THEN RETURN; END IF;
  IF coalesce(array_length(v_have, 1), 0) < 10 THEN RAISE EXCEPTION 'vat | source list looks wrong (%), not touching it', v_def; END IF;
  ALTER TABLE public.wallet_ledger DROP CONSTRAINT wallet_ledger_source_check;
  EXECUTE format('ALTER TABLE public.wallet_ledger ADD CONSTRAINT wallet_ledger_source_check CHECK (source IN (%s))',
    (SELECT string_agg(quote_literal(s), ', ') FROM unnest(v_have || ARRAY['vat']) AS s));
  RAISE NOTICE 'vat | ledger source added (% sources)', array_length(v_have, 1) + 1;
END $$;

-- one VAT line per fee line
CREATE UNIQUE INDEX IF NOT EXISTS wallet_ledger_one_vat_per_fee
  ON public.wallet_ledger ((meta->>'fee_ledger_id')) WHERE source = 'vat' AND direction = 'debit';

-- ── 3. VAT on every fee, as its own line ───────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wallet_charge_vat_on_fee() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  SETTLEMENT constant uuid := '00000000-0000-0000-0000-000000000001';
  v_vat bigint; v_bp bigint; v_w public.wallets%ROWTYPE; v_new bigint; v_rate text; v_what text;
BEGIN
  IF NEW.user_id = SETTLEMENT THEN RETURN NEW; END IF;
  v_vat := public.wallet_vat_kobo(NEW.amount_kobo);
  IF v_vat <= 0 THEN RETURN NEW; END IF;
  v_bp   := public.wallet_cfg_int('wallet_vat_rate_bp', 750);
  v_rate := rtrim(rtrim(to_char(v_bp / 100.0, 'FM999990.00'), '0'), '.');
  v_what := CASE NEW.source WHEN 'transfer_fee' THEN 'transfer fee' WHEN 'wallet_fee' THEN 'charge fee' ELSE 'deposit fee' END;
  BEGIN   -- its own sub-transaction: a VAT that can't be taken never undoes the payment it rides on
    PERFORM set_config('kudi.allow_wallet_write', '1', true);
    SELECT * INTO v_w FROM public.wallets WHERE id = NEW.wallet_id FOR UPDATE;
    IF NOT FOUND OR v_w.balance_kobo < v_vat THEN
      RAISE NOTICE 'vat | not taken on % % (balance short)', NEW.source, NEW.id;
      RETURN NEW;
    END IF;
    v_new := v_w.balance_kobo - v_vat;
    UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_w.id;
    INSERT INTO public.wallet_ledger (wallet_id, user_id, direction, amount_kobo, balance_after_kobo, source, status, reference, narration, related_txn_id, meta)
    VALUES (v_w.id, NEW.user_id, 'debit', v_vat, v_new, 'vat', 'completed', NEW.reference, 'VAT ' || v_rate || '% on ' || v_what, NEW.related_txn_id,
            jsonb_build_object('fee_ledger_id', NEW.id::text, 'on_source', NEW.source, 'fee_kobo', NEW.amount_kobo, 'rate_bp', v_bp));
    PERFORM public.wallet_credit_settlement(v_vat, 'vat', 'VAT on ' || v_what || ' — ' || coalesce(NEW.reference, NEW.related_txn_id::text, NEW.id::text), NEW.related_txn_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'vat | not taken on % %: %', NEW.source, NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_charge_vat_on_fee() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_wallet_charge_vat_on_fee ON public.wallet_ledger;
CREATE TRIGGER trg_wallet_charge_vat_on_fee AFTER INSERT ON public.wallet_ledger
  FOR EACH ROW WHEN (NEW.direction = 'debit' AND NEW.status = 'completed' AND NEW.source IN ('transfer_fee', 'wallet_fee', 'deposit_fee'))
  EXECUTE FUNCTION public.wallet_charge_vat_on_fee();

-- ── 4. bank transfer fee: charge once Flutterwave accepts, whatever the interim status (was: only while 'pending') ────
CREATE OR REPLACE FUNCTION public.wallet_transfer_sent(p_withdrawal_id uuid, p_flw_transfer_id text, p_fee_kobo bigint DEFAULT 0)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_wd public.wallet_withdrawals%ROWTYPE; s jsonb;
BEGIN
  PERFORM set_config('kudi.allow_wallet_write', '1', true);
  -- the row lock makes a repeated / concurrent call wait, then see the charges the first one wrote
  UPDATE public.wallet_withdrawals SET
    status = CASE WHEN status = 'pending' THEN 'processing' ELSE status END,
    flw_transfer_id = COALESCE(p_flw_transfer_id, flw_transfer_id),
    fee_kobo = COALESCE(NULLIF(p_fee_kobo, 0), fee_kobo),
    updated_at = now()
  WHERE id = p_withdrawal_id
  RETURNING * INTO v_wd;
  IF NOT FOUND THEN RETURN; END IF;
  -- a transfer that already failed / was reversed is not charged
  IF v_wd.status NOT IN ('pending', 'processing', 'successful') THEN RETURN; END IF;
  -- once only: the fee / stamp duty lines of this transfer are the record that it was charged
  IF EXISTS (SELECT 1 FROM public.wallet_ledger WHERE related_txn_id = v_wd.id AND direction = 'debit' AND source IN ('transfer_fee', 'cbn_levy')) THEN RETURN; END IF;

  -- the transfer's own hold already exists, so `used` includes it: free while used <= allowance
  s := public.wallet_free_transfer_state(v_wd.user_id);
  IF (s->>'used')::bigint > (s->>'allowance')::bigint THEN
    PERFORM public.wallet_take_transfer_charge(v_wd, public.wallet_bank_transfer_fee_for(v_wd.user_id, v_wd.amount_kobo), 'transfer_fee', 'Transfer fee',
      jsonb_build_object('tier', s->>'tier', 'period', s->>'period', 'allowance', (s->>'allowance')::bigint, 'used', (s->>'used')::bigint));
  END IF;
  PERFORM public.wallet_take_transfer_charge(v_wd, public.wallet_stamp_duty_kobo(v_wd.amount_kobo), 'cbn_levy', 'Stamp duty',
    jsonb_build_object('kind', 'stamp_duty'));
END;
$function$;
REVOKE ALL ON FUNCTION public.wallet_transfer_sent(uuid, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_transfer_sent(uuid, text, bigint) TO service_role;

-- ── 5. the quote shown before a bank transfer carries the VAT ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wallet_bank_transfer_quote(p_amount_kobo bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); s jsonb; v_free boolean; v_fee bigint; v_vat bigint; v_duty bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  s := public.wallet_free_transfer_state(v_uid);
  v_free := (s->>'used')::bigint < (s->>'allowance')::bigint;
  v_fee  := CASE WHEN v_free THEN 0 ELSE public.wallet_bank_transfer_fee_for(v_uid, p_amount_kobo) END;
  v_vat  := public.wallet_vat_kobo(v_fee);
  v_duty := public.wallet_stamp_duty_kobo(p_amount_kobo);
  RETURN s || jsonb_build_object('free', v_free, 'fee_kobo', v_fee, 'vat_kobo', v_vat, 'vat_rate_bp', public.wallet_cfg_int('wallet_vat_rate_bp', 750),
    'stamp_duty_kobo', v_duty, 'total_charges_kobo', v_fee + v_vat + v_duty,
    'free_left', GREATEST((s->>'allowance')::bigint - (s->>'used')::bigint, 0));
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_bank_transfer_quote(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wallet_bank_transfer_quote(bigint) TO authenticated;

-- ── 6. finance: VAT collected is owed to the tax authority — a memo line, outside profit ─────────────────────────────────
INSERT INTO public.finance_lines (code, name, section, stream, counts_toward_profit, allow_manual, sort_order, description)
SELECT 'wallet.vat_payable', 'VAT collected on wallet fees (to remit)', 'memo', 'wallet', false, false, 96,
       '7.5% VAT charged on transfer fees, the wallet charge fee and deposit fees — owed to the Nigeria Revenue Service, not KudiAI income.'
WHERE NOT EXISTS (SELECT 1 FROM public.finance_lines WHERE code = 'wallet.vat_payable');

CREATE OR REPLACE FUNCTION public.finance_sync_vat(p_full boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE SETTLEMENT constant uuid := '00000000-0000-0000-0000-000000000001'; n bigint;
BEGIN
  INSERT INTO public.finance_entries (occurred_at, line_code, amount_kobo, source_type, source_id, reference, category, estimated, note)
  SELECT l.created_at, 'wallet.vat_payable', l.amount_kobo, 'wallet_ledger', l.id::text, COALESCE(l.related_txn_id::text, l.reference), 'vat', false, l.narration
    FROM public.wallet_ledger l
   WHERE l.user_id = SETTLEMENT AND l.source = 'vat' AND l.direction = 'credit' AND l.status = 'completed' AND l.amount_kobo > 0
     AND (p_full OR l.created_at > now() - interval '4 days')
  ON CONFLICT (line_code, source_type, source_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('vat_payable', n);
END;
$$;
REVOKE ALL ON FUNCTION public.finance_sync_vat(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_sync_vat(boolean) TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('finance-sync-vat') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'finance-sync-vat');
  PERFORM cron.schedule('finance-sync-vat', '*/10 * * * *', $c$SELECT public.finance_sync_vat(false)$c$);
  RAISE NOTICE 'vat | collected VAT synced to the finance ledger every 10 minutes';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'vat | finance sync not scheduled: %', SQLERRM;
END $$;

-- ── 7. Terms v13: 4.10(f) — VAT is now charged (no re-acceptance prompt: owner's rule; customers are told by email) ─────
DO $tnc$
DECLARE
  src      public.legal_documents%ROWTYPE;
  next_ver integer;
  today    text := trim(to_char(now() AT TIME ZONE 'Africa/Lagos', 'FMDD FMMonth YYYY'));
  old_f    text := '<p><strong>(f) Taxes.</strong> Where the law requires us to charge Value Added Tax (VAT) on our fees, it will be shown separately before you confirm.</p>';
  new_f    text := '<p><strong>(f) Taxes.</strong> Value Added Tax (VAT) at 7.5% is charged on our fees — the bank transfer fee, the wallet charge fee and the deposit fee — and remitted to the Nigeria Revenue Service. VAT is charged on the fee only, never on the amount you send or receive, and it is shown separately before you confirm and on your transaction history. Stamp duty is a government levy and carries no VAT.</p>';
  content  text;
  body     text;
BEGIN
  SELECT * INTO src FROM public.legal_documents WHERE type = 'tnc' AND status = 'published' ORDER BY version DESC LIMIT 1;
  IF NOT FOUND THEN RAISE NOTICE 'terms | no published copy, skipped'; RETURN; END IF;
  content := replace(src.content, E'\r\n', E'\n');
  IF position(new_f IN content) > 0 THEN RAISE NOTICE 'terms | v% already has it, skipped', src.version; RETURN; END IF;
  IF position(old_f IN content) = 0 THEN
    RAISE NOTICE 'terms | 4.10(f) text not found in v% (edited by hand?) — NOT published, update the Terms in admin', src.version; RETURN;
  END IF;
  SELECT max(version) + 1 INTO next_ver FROM public.legal_documents WHERE type = 'tnc';
  body := replace(content, old_f, new_f);
  body := regexp_replace(body,
    '<p><strong>Effective Date:</strong>[^<]*<br><strong>Last Updated:</strong>[^<]*<br><strong>Version:</strong>[^<]*</p>',
    '<p><strong>Effective Date:</strong> ' || today || '<br><strong>Last Updated:</strong> ' || today || '<br><strong>Version:</strong> ' || next_ver || '</p>');
  INSERT INTO public.legal_documents (type, content, version, status, published_at, published_by, editor_name, requires_reacceptance, change_summary)
  VALUES ('tnc', body, next_ver, 'published', now(), 'system', 'System', false,
    'Section 4.10(f): 7.5% VAT is now charged on our wallet fees (transfer fee, wallet charge fee, deposit fee), shown separately and remitted to the Nigeria Revenue Service.');
  RAISE NOTICE 'terms | v% published from v% WITHOUT a re-acceptance prompt', next_ver, src.version;
END $tnc$;

DO $$
BEGIN
  RAISE NOTICE 'vat | enabled=% rate_bp=% | VAT on ₦10=% kobo, ₦25=% kobo, ₦60=% kobo',
    (SELECT value FROM public.platform_config WHERE key = 'wallet_vat_enabled'), public.wallet_cfg_int('wallet_vat_rate_bp', 750),
    public.wallet_vat_kobo(1000), public.wallet_vat_kobo(2500), public.wallet_vat_kobo(6000);
END $$;
