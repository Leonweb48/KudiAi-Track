-- Wallet pricing, owner's decisions 2026-10-13.
--
-- 1. BANK TRANSFER FEE — four bands (was ₦20 / ₦35 / ₦60), effective now:
--      under ₦5,000 → ₦10 · ₦5,000–₦9,999.99 → ₦25 · ₦10,000–₦50,000 → ₦35 · above ₦50,000 → ₦60.
--    Free allowances and the ₦50 stamp duty (₦10,000 and above) are unchanged.
--
-- 2. BUSINESS DEPOSIT FEE (Flutterwave keeps 2.15% of every deposit and we were absorbing all of it). Only BUSINESS wallets
--    pay, only on money that arrives through Flutterwave (bank top-ups and customers' sale payments), by plan:
--      Free plan 1% (max ₦200) · Standard 0.5% (max ₦100) · Premium free.
--    Ajo/Esusu clients and personal wallets: always free. Internal wallet moves: never charged.
--    Terms 4.10(a) promised notice before any deposit fee, so it starts on wallet_deposit_fee_start (1 November 2026) and
--    Terms v7 (published here, re-acceptance required) announces it. Taken as its own 'deposit_fee' ledger line right after
--    the deposit is credited, once per deposit (a repeated webhook can never charge twice), credited to the platform
--    settlement wallet and reported as income ("Deposit fees (businesses)").

-- ── config ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO public.platform_config (key, value, description) VALUES
  ('wallet_bank_fee_lowmid_kobo',          '2500',       'Bank transfer fee (kobo) for ₦5,000–₦9,999.99.'),
  ('wallet_deposit_fee_enabled',           'true',       'Business deposit fee on/off (Ajo clients and personal wallets are never charged).'),
  ('wallet_deposit_fee_start',             '2026-11-01', 'Business deposit fee applies to deposits on or after this date (Lagos time). Terms v7 gave notice of it.'),
  ('wallet_deposit_fee_free_pct',          '1',          'Business deposit fee, Free plan, % of the deposit.'),
  ('wallet_deposit_fee_free_cap_kobo',     '20000',      'Business deposit fee, Free plan, maximum per deposit (kobo).'),
  ('wallet_deposit_fee_standard_pct',      '0.5',        'Business deposit fee, Standard plan, % of the deposit.'),
  ('wallet_deposit_fee_standard_cap_kobo', '10000',      'Business deposit fee, Standard plan, maximum per deposit (kobo).'),
  ('wallet_deposit_fee_premium_pct',       '0',          'Business deposit fee, Premium plan, % of the deposit (0 = free).'),
  ('wallet_deposit_fee_premium_cap_kobo',  '0',          'Business deposit fee, Premium plan, maximum per deposit (kobo).')
ON CONFLICT (key) DO NOTHING;

UPDATE public.platform_config SET value = '1000', description = 'Bank transfer fee (kobo) for transfers under ₦5,000.' WHERE key = 'wallet_bank_fee_low_kobo';
UPDATE public.platform_config SET value = '3500', description = 'Bank transfer fee (kobo) for ₦10,000–₦50,000.'        WHERE key = 'wallet_bank_fee_mid_kobo';
UPDATE public.platform_config SET value = '6000', description = 'Bank transfer fee (kobo) above ₦50,000.'                WHERE key = 'wallet_bank_fee_high_kobo';

-- ── 1. transfer bands ──────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wallet_bank_transfer_fee_kobo(p_amount_kobo bigint) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN COALESCE(p_amount_kobo, 0) < 500000  THEN public.wallet_cfg_int('wallet_bank_fee_low_kobo', 1000)
              WHEN p_amount_kobo < 1000000               THEN public.wallet_cfg_int('wallet_bank_fee_lowmid_kobo', 2500)
              WHEN p_amount_kobo <= 5000000              THEN public.wallet_cfg_int('wallet_bank_fee_mid_kobo', 3500)
              ELSE public.wallet_cfg_int('wallet_bank_fee_high_kobo', 6000) END
$$;
REVOKE ALL ON FUNCTION public.wallet_bank_transfer_fee_kobo(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_bank_transfer_fee_kobo(bigint) TO service_role;

-- ── 2. deposit fee ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- new ledger source (extend the live list; never rewrite from a list we couldn't read)
DO $$
DECLARE v_def text; v_have text[]; v_all text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.wallet_ledger'::regclass AND conname = 'wallet_ledger_source_check';
  IF v_def IS NULL THEN RAISE EXCEPTION 'wallet_ledger_source_check not found — refusing to guess its contents'; END IF;
  SELECT COALESCE(array_agg(DISTINCT m[1]), ARRAY[]::text[]) INTO v_have FROM regexp_matches(v_def, '''([a-z_]+)''', 'g') AS m;
  IF 'deposit_fee' = ANY (v_have) THEN RETURN; END IF;
  IF COALESCE(array_length(v_have, 1), 0) < 10 THEN
    RAISE EXCEPTION 'wallet_ledger_source_check parsed to only % sources — refusing to rewrite it. Definition: %', COALESCE(array_length(v_have, 1), 0), v_def;
  END IF;
  SELECT array_agg(DISTINCT s ORDER BY s) INTO v_all FROM unnest(v_have || ARRAY['deposit_fee']) AS s;
  ALTER TABLE public.wallet_ledger DROP CONSTRAINT wallet_ledger_source_check;
  EXECUTE format('ALTER TABLE public.wallet_ledger ADD CONSTRAINT wallet_ledger_source_check CHECK (source IN (%s))',
                 (SELECT string_agg(quote_literal(s), ', ' ORDER BY s) FROM unnest(v_all) AS s));
END $$;

-- one fee per deposit, ever
CREATE UNIQUE INDEX IF NOT EXISTS wallet_ledger_one_deposit_fee
  ON public.wallet_ledger (related_txn_id) WHERE source = 'deposit_fee' AND direction = 'debit';

-- The rule for a wallet holder: { tier, pct, cap_kobo, starts, active }. Personal wallets and Ajo clients → pct 0.
CREATE OR REPLACE FUNCTION public.wallet_deposit_fee_rule(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tier text := public.wallet_fee_tier(p_user_id); v_pct numeric := 0; v_cap bigint := 0; v_start date; v_on boolean;
BEGIN
  v_on := lower(COALESCE((SELECT value FROM public.platform_config WHERE key = 'wallet_deposit_fee_enabled'), 'false')) = 'true';
  BEGIN v_start := (SELECT NULLIF(trim(value), '')::date FROM public.platform_config WHERE key = 'wallet_deposit_fee_start');
  EXCEPTION WHEN OTHERS THEN v_start := NULL; END;
  IF v_tier <> 'personal' THEN
    BEGIN v_pct := COALESCE(NULLIF(trim((SELECT value FROM public.platform_config WHERE key = 'wallet_deposit_fee_' || v_tier || '_pct')), '')::numeric, 0);
    EXCEPTION WHEN OTHERS THEN v_pct := 0; END;
    v_cap := public.wallet_cfg_int('wallet_deposit_fee_' || v_tier || '_cap_kobo', 0);
  END IF;
  RETURN jsonb_build_object('tier', v_tier, 'pct', GREATEST(v_pct, 0), 'cap_kobo', GREATEST(v_cap, 0), 'starts', v_start,
    'active', v_on AND v_start IS NOT NULL AND (now() AT TIME ZONE 'Africa/Lagos')::date >= v_start AND v_pct > 0 AND v_cap > 0);
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_deposit_fee_rule(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_deposit_fee_rule(uuid) TO service_role;

-- What the app shows a holder about receiving money (their own rule only).
CREATE OR REPLACE FUNCTION public.wallet_deposit_fee_quote() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  RETURN public.wallet_deposit_fee_rule(auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_deposit_fee_quote() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wallet_deposit_fee_quote() TO authenticated;

-- Take the fee for one credited deposit (ledger row of source 'topup' or 'sale'). Called by the Flutterwave webhook right
-- after the credit. Idempotent. Returns { fee_kobo, balance_after_kobo, pct, cap_kobo, tier }.
CREATE OR REPLACE FUNCTION public.wallet_take_deposit_fee(p_ledger_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dep  public.wallet_ledger;
  v_rule jsonb;
  v_fee  bigint;
  v_w    public.wallets;
  v_new  bigint;
  v_prev public.wallet_ledger;
BEGIN
  SELECT * INTO v_dep FROM public.wallet_ledger WHERE id = p_ledger_id;
  IF NOT FOUND OR v_dep.direction <> 'credit' OR v_dep.status <> 'completed' OR v_dep.source NOT IN ('topup', 'sale') OR v_dep.amount_kobo <= 0 THEN
    RETURN jsonb_build_object('fee_kobo', 0);
  END IF;
  SELECT * INTO v_prev FROM public.wallet_ledger WHERE related_txn_id = v_dep.id AND source = 'deposit_fee' AND direction = 'debit';
  IF FOUND THEN RETURN jsonb_build_object('fee_kobo', v_prev.amount_kobo, 'balance_after_kobo', v_prev.balance_after_kobo, 'already', true); END IF;

  v_rule := public.wallet_deposit_fee_rule(v_dep.user_id);
  -- the deposit's own date decides (a retried old deposit is never charged under a rule that started later)
  IF NOT (v_rule->>'active')::boolean OR (v_dep.created_at AT TIME ZONE 'Africa/Lagos')::date < (v_rule->>'starts')::date THEN
    RETURN jsonb_build_object('fee_kobo', 0, 'tier', v_rule->>'tier');
  END IF;
  v_fee := LEAST(round(v_dep.amount_kobo * (v_rule->>'pct')::numeric / 100)::bigint, (v_rule->>'cap_kobo')::bigint, v_dep.amount_kobo);
  IF v_fee <= 0 THEN RETURN jsonb_build_object('fee_kobo', 0, 'tier', v_rule->>'tier'); END IF;

  PERFORM set_config('kudi.allow_wallet_write', '1', true);
  SELECT * INTO v_w FROM public.wallets WHERE id = v_dep.wallet_id FOR UPDATE;
  IF NOT FOUND OR v_w.balance_kobo < v_fee THEN RETURN jsonb_build_object('fee_kobo', 0, 'skipped', 'balance'); END IF;
  v_new := v_w.balance_kobo - v_fee;
  UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_w.id;
  INSERT INTO public.wallet_ledger (wallet_id, user_id, direction, amount_kobo, balance_after_kobo, source, status, reference, narration, related_txn_id, meta)
  VALUES (v_w.id, v_dep.user_id, 'debit', v_fee, v_new, 'deposit_fee', 'completed', v_dep.id::text,
          'Deposit fee (' || (v_rule->>'pct') || '%, max ₦' || to_char((v_rule->>'cap_kobo')::bigint / 100.0, 'FM999,999,990') || ')', v_dep.id,
          jsonb_build_object('tier', v_rule->>'tier', 'pct', (v_rule->>'pct')::numeric, 'cap_kobo', (v_rule->>'cap_kobo')::bigint, 'deposit_kobo', v_dep.amount_kobo));
  PERFORM public.wallet_credit_settlement(v_fee, 'deposit_fee', 'Deposit fee — ' || v_dep.id::text, v_dep.id);
  RETURN jsonb_build_object('fee_kobo', v_fee, 'balance_after_kobo', v_new, 'pct', (v_rule->>'pct')::numeric, 'cap_kobo', (v_rule->>'cap_kobo')::bigint, 'tier', v_rule->>'tier');
EXCEPTION WHEN unique_violation THEN
  -- a concurrent call took it first
  SELECT * INTO v_prev FROM public.wallet_ledger WHERE related_txn_id = p_ledger_id AND source = 'deposit_fee' AND direction = 'debit';
  RETURN jsonb_build_object('fee_kobo', COALESCE(v_prev.amount_kobo, 0), 'balance_after_kobo', v_prev.balance_after_kobo, 'already', true);
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_take_deposit_fee(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_take_deposit_fee(uuid) TO service_role;

-- ── reports: deposit fees are income ───────────────────────────────────────────────────────────────────────────────────
INSERT INTO public.finance_lines (code, name, section, stream, counts_toward_profit, allow_manual, sort_order, description)
SELECT 'wallet.deposit_fee_income', 'Deposit fees (businesses)', 'revenue', 'wallet', true, false, 12,
       'Fee businesses pay on money received into their wallet (by plan), credited to the platform settlement wallet.'
WHERE NOT EXISTS (SELECT 1 FROM public.finance_lines WHERE code = 'wallet.deposit_fee_income');

CREATE OR REPLACE FUNCTION public.finance_sync_deposit_fee_income(p_full boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE SETTLEMENT constant uuid := '00000000-0000-0000-0000-000000000001'; n bigint;
BEGIN
  INSERT INTO public.finance_entries (occurred_at, line_code, amount_kobo, source_type, source_id, user_id, reference, category, estimated, note)
  SELECT l.created_at, 'wallet.deposit_fee_income', l.amount_kobo, 'wallet_ledger', l.id::text, d.user_id, l.related_txn_id::text, 'deposit_fee', false, 'Business deposit fee'
    FROM public.wallet_ledger l
    LEFT JOIN public.wallet_ledger d ON d.id = l.related_txn_id
   WHERE l.user_id = SETTLEMENT AND l.source = 'deposit_fee' AND l.direction = 'credit' AND l.status = 'completed' AND l.amount_kobo > 0
     AND (p_full OR l.created_at > now() - interval '4 days')
  ON CONFLICT (line_code, source_type, source_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('deposit_fee_income', n);
END;
$$;
REVOKE ALL ON FUNCTION public.finance_sync_deposit_fee_income(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_sync_deposit_fee_income(boolean) TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('finance-sync-deposit-fee-income') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'finance-sync-deposit-fee-income');
  PERFORM cron.schedule('finance-sync-deposit-fee-income', '*/10 * * * *', $c$SELECT public.finance_sync_deposit_fee_income(false)$c$);
  RAISE NOTICE 'deposit fee | income synced to the profit ledger every 10 minutes';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'deposit fee | income sync not scheduled: %', SQLERRM;
END $$;

-- ── Terms & Conditions v7: section 4.10 with the new bands and the business deposit fee (notice before it starts) ──────
DO $tnc$
DECLARE
  src      public.legal_documents%ROWTYPE;
  next_ver integer;
  today    text := trim(to_char(now() AT TIME ZONE 'Africa/Lagos', 'FMDD FMMonth YYYY'));
  body     text;
  a        int;
  b        int;
  section  text := $SEC$
<h3>4.10 Wallet Fees and Charges</h3>
<p>We show you every charge on a transfer <strong>before you confirm it</strong>. Transfer charges are taken from your Digital Wallet balance in addition to the amount you send, so the recipient always receives the full amount. If your balance cannot cover the amount plus its charges, the transfer will not go ahead.</p>
<p><strong>(a) Money into your wallet.</strong> Deposits (top-ups) and payments received are <strong>free for Ajo/Esusu Clients and personal wallets</strong>. From <strong>1 November 2026</strong>, money received into a <strong>Business Owner's</strong> wallet from a bank transfer (top-ups and customers' payments for sales) carries a deposit fee according to the business's plan:</p>
<table>
<tr><th>Plan</th><th>Deposit fee</th></tr>
<tr><td>Free plan</td><td>1% of the amount received, maximum ₦200</td></tr>
<tr><td>Standard plan</td><td>0.5% of the amount received, maximum ₦100</td></tr>
<tr><td>Premium plan</td><td>Free</td></tr>
</table>
<p>The deposit fee is shown on the deposit in your wallet history and receipt. Moves between KudiAI wallets (for example Ajo/Esusu savings payments) are not deposits and carry no deposit fee.</p>
<p><strong>(b) Transfers from your wallet to a bank account.</strong></p>
<table>
<tr><th>Amount sent</th><th>Transfer fee</th></tr>
<tr><td>Below ₦5,000</td><td>₦10</td></tr>
<tr><td>₦5,000 to ₦9,999.99</td><td>₦25</td></tr>
<tr><td>₦10,000 to ₦50,000</td><td>₦35</td></tr>
<tr><td>Above ₦50,000</td><td>₦60</td></tr>
</table>
<p>Free transfers: Ajo/Esusu Clients and personal wallets get their first <strong>3 transfers each day</strong> free (bank transfers and wallet savings payments count together). Business Owners get free bank transfers each <strong>calendar month</strong> according to their plan: <strong>Free plan — none; Standard plan — 10; Premium plan — 30</strong>. Unused free transfers do not carry over.</p>
<p><strong>(c) Stamp duty.</strong> As required by the Nigeria Tax Act 2025, a stamp duty of <strong>₦50</strong> is charged to the sender on every bank transfer of <strong>₦10,000 or more</strong>, in the same way as banks and other payment providers. It is shown separately from our fee, applies even when your transfer is free of our fee, and is collected on behalf of, and paid to, the relevant tax authority — it is not income to us. Transfers below ₦10,000 and moves between KudiAI wallets do not attract stamp duty.</p>
<p><strong>(d) Moves between KudiAI wallets</strong> (for example Ajo/Esusu savings payments and payouts) are free for your first 3 each day, then ₦10 for amounts below ₦10,000 and ₦50 for ₦10,000 or more.</p>
<p><strong>(e) Failed or reversed transfers.</strong> If a bank transfer fails or is reversed, the amount, our fee and any stamp duty are returned to your wallet.</p>
<p><strong>(f) Taxes.</strong> Where the law requires us to charge Value Added Tax (VAT) on our fees, it will be shown separately before you confirm.</p>
<p><strong>(g) Changes to fees.</strong> We may change these fees. We will tell you in the App before a change takes effect, and the fee that applies to a transfer is always shown before you confirm it. Charges made by our payment partner, Flutterwave, are covered by our fees and are never passed on to you separately.</p>
$SEC$;
BEGIN
  SELECT * INTO src FROM public.legal_documents WHERE type = 'tnc' AND status = 'published' ORDER BY version DESC LIMIT 1;
  IF NOT FOUND THEN RAISE NOTICE 'terms | no published copy, skipped'; RETURN; END IF;
  IF position('From <strong>1 November 2026</strong>, money received into a <strong>Business Owner''s</strong> wallet' IN src.content) > 0 THEN
    RAISE NOTICE 'terms | v% already has the new 4.10, skipped', src.version; RETURN;
  END IF;
  a := position('<h3>4.10 Wallet Fees and Charges</h3>' IN src.content);
  b := position('<h2>5. SUBSCRIPTION PLANS AND BILLING</h2>' IN src.content);
  IF a = 0 OR b = 0 OR b < a THEN RAISE EXCEPTION 'terms: section 4.10 / 5 not found where expected — not publishing'; END IF;
  SELECT max(version) + 1 INTO next_ver FROM public.legal_documents WHERE type = 'tnc';
  body := substr(src.content, 1, a - 1) || btrim(section, E' '||chr(13)||chr(10)) || E'\n' || substr(src.content, b);
  body := regexp_replace(body,
    '<p><strong>Effective Date:</strong>[^<]*<br><strong>Last Updated:</strong>[^<]*<br><strong>Version:</strong>[^<]*</p>',
    '<p><strong>Effective Date:</strong> ' || today || '<br><strong>Last Updated:</strong> ' || today || '<br><strong>Version:</strong> ' || next_ver || '</p>');
  INSERT INTO public.legal_documents (type, content, version, status, published_at, published_by, editor_name, requires_reacceptance, change_summary)
  VALUES ('tnc', body, next_ver, 'published', now(), 'system', 'System', true,
    'Section 4.10 updated. Bank transfers now cost ₦10 (below ₦5,000), ₦25 (₦5,000–₦9,999), ₦35 (₦10,000–₦50,000) or ₦60 (above ₦50,000); free transfers and the ₦50 stamp duty are unchanged. From 1 November 2026, money received into a business wallet carries a deposit fee by plan: Free plan 1% (max ₦200), Standard 0.5% (max ₦100), Premium free. Deposits stay free for Ajo/Esusu clients and personal wallets.');
  RAISE NOTICE 'terms | v% published from v% (4.10 updated, everyone asked to accept)', next_ver, src.version;
END $tnc$;

-- ── self-checks (raise → everything above rolls back) ──────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF public.wallet_bank_transfer_fee_kobo(499999) <> 1000 OR public.wallet_bank_transfer_fee_kobo(500000) <> 2500
     OR public.wallet_bank_transfer_fee_kobo(999999) <> 2500 OR public.wallet_bank_transfer_fee_kobo(1000000) <> 3500
     OR public.wallet_bank_transfer_fee_kobo(5000000) <> 3500 OR public.wallet_bank_transfer_fee_kobo(5000001) <> 6000 THEN
    RAISE EXCEPTION 'bank transfer price bands wrong';
  END IF;
  RAISE NOTICE 'pricing | bands ok: ₦10 < ₦5,000 · ₦25 < ₦10,000 · ₦35 ≤ ₦50,000 · ₦60 above (stamp duty unchanged)';
  RAISE NOTICE 'pricing | business deposit fee starts %; wallets by tier: free=% standard=% premium=% personal=%',
    (SELECT value FROM public.platform_config WHERE key = 'wallet_deposit_fee_start'),
    (SELECT count(*) FROM public.wallets w WHERE public.wallet_fee_tier(w.user_id) = 'free'),
    (SELECT count(*) FROM public.wallets w WHERE public.wallet_fee_tier(w.user_id) = 'standard'),
    (SELECT count(*) FROM public.wallets w WHERE public.wallet_fee_tier(w.user_id) = 'premium'),
    (SELECT count(*) FROM public.wallets w WHERE public.wallet_fee_tier(w.user_id) = 'personal');
END $$;
