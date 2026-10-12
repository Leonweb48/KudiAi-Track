-- Wallet transfer pricing + honest wallet reporting (owner's decisions, 2026-10-12).
--
-- BANK TRANSFERS OUT (wallet → bank account; what Flutterwave charges us ₦10 / ₦25 / ₦50 for):
--   price ₦20 (up to ₦5,000) · ₦35 (₦5,001–₦50,000) · ₦60 (above ₦50,000), added on top of the amount (the recipient
--   gets the full amount), charged once Flutterwave accepts the transfer;
--   free allowance — Ajo clients and personal wallets: the first 3 transfers a DAY (unchanged rule);
--                    businesses by plan: Free 0 · Standard 10 · Premium 30 a MONTH.
--   Everything is in platform_config, so prices and allowances change without a release.
--   Internal wallet moves (Ajo contributions/payouts, circles) keep their own fee (wallet_transfer_fee_kobo) — unchanged.
--   Deposits stay free (owner: "Not yet").
-- The old free check counted only COMPLETED moves while the transfer being sent is still 'pending', so it gave a 4th free
-- transfer; the new count includes pending ones.
--
-- REPORTS: the profit ledger had no line for what deposits cost us (Flutterwave keeps 2% + 7.5% VAT = 2.15% of every
-- deposit, measured 2026-10-12). New cost line wallet.deposit_fee: Flutterwave's real fee when the webhook recorded it
-- (meta.flw_fee_kobo), otherwise an ESTIMATE at flw_collection_fee_pct (2.15) — flagged estimated. The transfer-fee
-- estimates move to what Flutterwave actually charges (₦10 / ₦25 / ₦50, no VAT on transfer fees).

INSERT INTO public.platform_config (key, value, description) VALUES
  ('wallet_bank_fee_low_kobo',          '2000', 'Bank transfer fee (kobo) for transfers up to ₦5,000.'),
  ('wallet_bank_fee_mid_kobo',          '3500', 'Bank transfer fee (kobo) for ₦5,001–₦50,000.'),
  ('wallet_bank_fee_high_kobo',         '6000', 'Bank transfer fee (kobo) above ₦50,000.'),
  ('wallet_free_transfers_personal_day','3',    'Free transfers a DAY for Ajo clients and personal wallets (bank transfers and Ajo wallet moves together).'),
  ('wallet_free_transfers_free_month',  '0',    'Free bank transfers a MONTH for businesses on the Free plan.'),
  ('wallet_free_transfers_standard_month','10', 'Free bank transfers a MONTH for businesses on the Standard plan.'),
  ('wallet_free_transfers_premium_month','30',  'Free bank transfers a MONTH for businesses on the Premium plan.'),
  ('flw_collection_fee_pct',            '2.15', 'Finance: what Flutterwave keeps of each deposit, in % (2% + 7.5% VAT), used to ESTIMATE deposit cost when the real fee was not recorded.')
ON CONFLICT (key) DO NOTHING;

-- measured 2026-10-12 (flw-fee-report): transfer fees are ₦10 / ₦25 / ₦50 with no VAT on them
UPDATE public.platform_config SET value = '10' WHERE key = 'flw_fee_low'  AND value = '10.75';
UPDATE public.platform_config SET value = '25' WHERE key = 'flw_fee_mid'  AND value = '26.88';
UPDATE public.platform_config SET value = '50' WHERE key = 'flw_fee_high' AND value = '53.75';

CREATE OR REPLACE FUNCTION public.wallet_cfg_int(p_key text, p_default bigint) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT CASE WHEN value ~ '^\s*\d+\s*$' THEN trim(value)::bigint END FROM public.platform_config WHERE key = p_key), p_default)
$$;
REVOKE ALL ON FUNCTION public.wallet_cfg_int(text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_cfg_int(text, bigint) TO service_role;

-- The bank-transfer price for an amount.
CREATE OR REPLACE FUNCTION public.wallet_bank_transfer_fee_kobo(p_amount_kobo bigint) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN COALESCE(p_amount_kobo, 0) <= 500000  THEN public.wallet_cfg_int('wallet_bank_fee_low_kobo', 2000)
              WHEN p_amount_kobo <= 5000000               THEN public.wallet_cfg_int('wallet_bank_fee_mid_kobo', 3500)
              ELSE public.wallet_cfg_int('wallet_bank_fee_high_kobo', 6000) END
$$;
REVOKE ALL ON FUNCTION public.wallet_bank_transfer_fee_kobo(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_bank_transfer_fee_kobo(bigint) TO service_role;

-- Whose rule applies: a business (by its active plan) or a personal wallet (Ajo client / wallet-only).
CREATE OR REPLACE FUNCTION public.wallet_fee_tier(p_user_id uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_plan text; v_business boolean;
BEGIN
  SELECT lower(trim(plan)) INTO v_plan FROM public.subscriptions
   WHERE user_id = p_user_id AND status = 'active' LIMIT 1;   -- one active subscription per user (the app reads it the same way)
  v_business := v_plan IS NOT NULL
             OR EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND COALESCE(trim(business_name), '') <> '');
  IF NOT v_business THEN RETURN 'personal'; END IF;
  RETURN CASE
    WHEN v_plan IN ('oga', 'enterprise', 'enterprise plan', 'top', 'premium plan') THEN 'premium'
    WHEN v_plan IN ('naira', 'basic', 'business', 'professional', 'premium', 'business plan', 'standard') THEN 'standard'
    ELSE 'free' END;
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_fee_tier(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_fee_tier(uuid) TO service_role;

-- Free-allowance state: tier, period, allowance, used (counts the transfer being sent once its hold exists).
CREATE OR REPLACE FUNCTION public.wallet_free_transfer_state(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tier text := public.wallet_fee_tier(p_user_id); v_allow bigint; v_used bigint; v_today date := (now() AT TIME ZONE 'Africa/Lagos')::date;
BEGIN
  IF v_tier = 'personal' THEN
    v_allow := public.wallet_cfg_int('wallet_free_transfers_personal_day', 3);
    SELECT count(*) INTO v_used FROM public.wallet_ledger
     WHERE user_id = p_user_id AND direction = 'debit' AND source IN ('ajo_contribution', 'ajo_payout', 'withdrawal')
       AND status IN ('pending', 'completed') AND (created_at AT TIME ZONE 'Africa/Lagos')::date = v_today;
    RETURN jsonb_build_object('tier', v_tier, 'period', 'day', 'allowance', v_allow, 'used', v_used);
  END IF;
  v_allow := public.wallet_cfg_int('wallet_free_transfers_' || v_tier || '_month', CASE v_tier WHEN 'premium' THEN 30 WHEN 'standard' THEN 10 ELSE 0 END);
  SELECT count(*) INTO v_used FROM public.wallet_ledger
   WHERE user_id = p_user_id AND direction = 'debit' AND source = 'withdrawal' AND status IN ('pending', 'completed')
     AND date_trunc('month', created_at AT TIME ZONE 'Africa/Lagos') = date_trunc('month', now() AT TIME ZONE 'Africa/Lagos');
  RETURN jsonb_build_object('tier', v_tier, 'period', 'month', 'allowance', v_allow, 'used', v_used);
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_free_transfer_state(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_free_transfer_state(uuid) TO service_role;

-- What the app shows BEFORE a bank transfer: the fee for this amount, or that it's free and how many free ones are left.
CREATE OR REPLACE FUNCTION public.wallet_bank_transfer_quote(p_amount_kobo bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); s jsonb; v_free boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  s := public.wallet_free_transfer_state(v_uid);
  v_free := (s->>'used')::bigint < (s->>'allowance')::bigint;
  RETURN s || jsonb_build_object(
    'free', v_free,
    'fee_kobo', CASE WHEN v_free THEN 0 ELSE public.wallet_bank_transfer_fee_kobo(p_amount_kobo) END,
    'free_left', GREATEST((s->>'allowance')::bigint - (s->>'used')::bigint, 0));
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_bank_transfer_quote(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wallet_bank_transfer_quote(bigint) TO authenticated;

-- Bank transfer accepted by Flutterwave: charge the bank-transfer price unless it's within the free allowance.
-- (Same shape as 20261223; only the price and the allowance changed.)
CREATE OR REPLACE FUNCTION public.wallet_transfer_sent(p_withdrawal_id uuid, p_flw_transfer_id text, p_fee_kobo bigint DEFAULT 0)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_wd     public.wallet_withdrawals%ROWTYPE;
  v_wallet public.wallets;
  v_new    BIGINT;
  v_fee    BIGINT;
  s        jsonb;
BEGIN
  PERFORM set_config('kudi.allow_wallet_write', '1', true);
  UPDATE public.wallet_withdrawals SET
    status = 'processing',
    flw_transfer_id = COALESCE(p_flw_transfer_id, flw_transfer_id),
    fee_kobo = COALESCE(NULLIF(p_fee_kobo, 0), fee_kobo),
    updated_at = now()
  WHERE id = p_withdrawal_id AND status = 'pending'          -- once only: a repeated call must never charge twice
  RETURNING * INTO v_wd;
  IF NOT FOUND THEN RETURN; END IF;

  -- the transfer's own hold (pending) already exists, so `used` includes it: free while used <= allowance
  s := public.wallet_free_transfer_state(v_wd.user_id);
  IF (s->>'used')::bigint <= (s->>'allowance')::bigint THEN RETURN; END IF;

  v_fee := public.wallet_bank_transfer_fee_kobo(v_wd.amount_kobo);
  IF v_fee <= 0 THEN RETURN; END IF;
  SELECT * INTO v_wallet FROM public.wallets WHERE id = v_wd.wallet_id FOR UPDATE;
  IF FOUND AND v_wallet.balance_kobo >= v_fee THEN
    v_new := v_wallet.balance_kobo - v_fee;
    UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_wallet.id;
    INSERT INTO public.wallet_ledger (wallet_id, user_id, direction, amount_kobo, balance_after_kobo, source, status, reference, narration, related_txn_id, meta)
    VALUES (v_wallet.id, v_wd.user_id, 'debit', v_fee, v_new, 'transfer_fee', 'completed', p_withdrawal_id::text, 'Transfer fee', p_withdrawal_id,
            jsonb_build_object('tier', s->>'tier', 'period', s->>'period', 'allowance', (s->>'allowance')::bigint, 'used', (s->>'used')::bigint));
    PERFORM public.wallet_credit_settlement(v_fee, 'transfer_fee', 'Transfer fee — withdrawal ' || p_withdrawal_id::text, p_withdrawal_id);
  END IF;
END;
$function$;

-- ── Reports: what deposits cost us ───────────────────────────────────────────────────────────────────────────────
INSERT INTO public.finance_lines (code, name, section, stream, counts_toward_profit, allow_manual, sort_order, description)
SELECT 'wallet.deposit_fee', 'Deposit fees (Flutterwave)', 'cost_of_sales', 'wallet', true, true, 212,
       'What Flutterwave keeps of each wallet deposit (2% + 7.5% VAT). Real fee when recorded, otherwise estimated at flw_collection_fee_pct.'
WHERE NOT EXISTS (SELECT 1 FROM public.finance_lines WHERE code = 'wallet.deposit_fee');

CREATE OR REPLACE FUNCTION public.finance_sync_deposit_fees(p_full boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  SETTLEMENT constant uuid := '00000000-0000-0000-0000-000000000001';
  v_pct numeric; n bigint;
BEGIN
  BEGIN v_pct := COALESCE(NULLIF((SELECT value FROM public.platform_config WHERE key = 'flw_collection_fee_pct'), '')::numeric, 2.15);
  EXCEPTION WHEN OTHERS THEN v_pct := 2.15; END;
  INSERT INTO public.finance_entries (occurred_at, line_code, amount_kobo, source_type, source_id, user_id, reference, category, estimated, note)
  SELECT l.created_at, 'wallet.deposit_fee',
         -COALESCE(NULLIF((l.meta ->> 'flw_fee_kobo')::bigint, 0), round(l.amount_kobo * v_pct / 100)::bigint),
         'wallet_ledger', l.id::text, l.user_id, l.flw_reference, 'deposit',
         (COALESCE((l.meta ->> 'flw_fee_kobo')::bigint, 0) = 0),
         CASE WHEN COALESCE((l.meta ->> 'flw_fee_kobo')::bigint, 0) > 0 THEN 'Flutterwave deposit fee'
              ELSE 'Estimated Flutterwave deposit fee (' || v_pct || '%)' END
    FROM public.wallet_ledger l
   WHERE l.source = 'topup' AND l.direction = 'credit' AND l.status = 'completed' AND l.amount_kobo > 0
     AND l.user_id <> SETTLEMENT
     AND (p_full OR l.created_at > now() - interval '4 days')
  ON CONFLICT (line_code, source_type, source_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('deposit_fees', n);
END;
$$;
REVOKE ALL ON FUNCTION public.finance_sync_deposit_fees(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_sync_deposit_fees(boolean) TO service_role;

-- backfill every deposit so far, then keep it current every 10 minutes (like finance_sync)
DO $$
DECLARE r jsonb;
BEGIN
  r := public.finance_sync_deposit_fees(true);
  RAISE NOTICE 'deposit fees | backfilled: %', r;
  PERFORM cron.unschedule('finance-sync-deposit-fees') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'finance-sync-deposit-fees');
  PERFORM cron.schedule('finance-sync-deposit-fees', '*/10 * * * *', $c$SELECT public.finance_sync_deposit_fees(false)$c$);
  RAISE NOTICE 'deposit fees | scheduled every 10 minutes';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'deposit fees | setup problem: %', SQLERRM;
END $$;

-- Self-check (raises → the whole migration rolls back)
DO $$
BEGIN
  IF public.wallet_bank_transfer_fee_kobo(500000) <> 2000 OR public.wallet_bank_transfer_fee_kobo(500100) <> 3500
     OR public.wallet_bank_transfer_fee_kobo(5000000) <> 3500 OR public.wallet_bank_transfer_fee_kobo(5000100) <> 6000 THEN
    RAISE EXCEPTION 'bank transfer price bands wrong';
  END IF;
  RAISE NOTICE 'pricing | bands ok: ₦20 ≤ ₦5,000 · ₦35 ≤ ₦50,000 · ₦60 above';
  RAISE NOTICE 'pricing | tiers now: personal=% free=% standard=% premium=%',
    (SELECT count(*) FROM public.wallets w WHERE public.wallet_fee_tier(w.user_id) = 'personal'),
    (SELECT count(*) FROM public.wallets w WHERE public.wallet_fee_tier(w.user_id) = 'free'),
    (SELECT count(*) FROM public.wallets w WHERE public.wallet_fee_tier(w.user_id) = 'standard'),
    (SELECT count(*) FROM public.wallets w WHERE public.wallet_fee_tier(w.user_id) = 'premium');
END $$;
