-- ═════════════════════════════════════════════════════════════════════════════
-- Ajo/Esusu clients and personal wallets (wallet_fee_tier = 'personal') — owner's decision 2026-10-18, effective now:
--   • bank transfers: NO free transfers; the fee is exactly what Flutterwave charges us:
--       up to ₦5,000 → ₦10 · ₦5,000.01–₦50,000 → ₦25 · above ₦50,000 → ₦50   (config wallet_bank_fee_personal_*_kobo)
--   • moves between KudiAI wallets (savings payments, circle contributions, wallet-to-wallet): always free
--     (Flutterwave charges nothing for them) — before: 3 free a day, then ₦10/₦50
--   • deposits: still free · stamp duty (₦50 on ₦10,000+ bank transfers, a tax): unchanged
-- Business Owners: unchanged (bands ₦10/₦25/₦35/₦60, free transfers by plan, wallet moves 3 free a day then ₦10/₦50).
-- Terms v9 publishes the new 4.10(b) and (d).
-- ═════════════════════════════════════════════════════════════════════════════

INSERT INTO public.platform_config (key, value, description) VALUES
  ('wallet_bank_fee_personal_low_kobo',  '1000', 'Clients/personal wallets: bank transfer fee (kobo) up to ₦5,000 — Flutterwave''s own charge.'),
  ('wallet_bank_fee_personal_mid_kobo',  '2500', 'Clients/personal wallets: bank transfer fee (kobo) ₦5,000.01–₦50,000 — Flutterwave''s own charge.'),
  ('wallet_bank_fee_personal_high_kobo', '5000', 'Clients/personal wallets: bank transfer fee (kobo) above ₦50,000 — Flutterwave''s own charge.')
ON CONFLICT (key) DO NOTHING;
UPDATE public.platform_config
   SET value = '0', description = 'Free bank transfers a DAY for Ajo clients and personal wallets (0 since 2026-10-18: they pay Flutterwave''s own fee on every bank transfer; wallet moves are always free).'
 WHERE key = 'wallet_free_transfers_personal_day';

-- ── 1. the bank transfer fee for THIS sender ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.wallet_bank_transfer_fee_for(p_user_id uuid, p_amount_kobo bigint) RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.wallet_fee_tier(p_user_id) = 'personal' THEN
    RETURN CASE WHEN COALESCE(p_amount_kobo, 0) <= 500000  THEN public.wallet_cfg_int('wallet_bank_fee_personal_low_kobo', 1000)
                WHEN p_amount_kobo <= 5000000             THEN public.wallet_cfg_int('wallet_bank_fee_personal_mid_kobo', 2500)
                ELSE public.wallet_cfg_int('wallet_bank_fee_personal_high_kobo', 5000) END;
  END IF;
  RETURN public.wallet_bank_transfer_fee_kobo(p_amount_kobo);
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_bank_transfer_fee_for(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_bank_transfer_fee_for(uuid, bigint) TO service_role;

-- ── 2. quote shown before a bank transfer (20270307 + the sender's own price) ─
CREATE OR REPLACE FUNCTION public.wallet_bank_transfer_quote(p_amount_kobo bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); s jsonb; v_free boolean; v_fee bigint; v_duty bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  s := public.wallet_free_transfer_state(v_uid);
  v_free := (s->>'used')::bigint < (s->>'allowance')::bigint;
  v_fee  := CASE WHEN v_free THEN 0 ELSE public.wallet_bank_transfer_fee_for(v_uid, p_amount_kobo) END;
  v_duty := public.wallet_stamp_duty_kobo(p_amount_kobo);
  RETURN s || jsonb_build_object('free', v_free, 'fee_kobo', v_fee, 'stamp_duty_kobo', v_duty,
    'total_charges_kobo', v_fee + v_duty, 'free_left', GREATEST((s->>'allowance')::bigint - (s->>'used')::bigint, 0));
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_bank_transfer_quote(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wallet_bank_transfer_quote(bigint) TO authenticated;

-- ── 3. charge when Flutterwave accepts the transfer (20270307 + the sender's own price) ─
CREATE OR REPLACE FUNCTION public.wallet_transfer_sent(p_withdrawal_id uuid, p_flw_transfer_id text, p_fee_kobo bigint DEFAULT 0)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_wd public.wallet_withdrawals%ROWTYPE; s jsonb;
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

-- ── 4. wallet moves: every fee block is gated on `wallet_daily_transfer_count(payer) > 3` (savings payments, circle
--       contributions, payouts). Personal wallets now report 0, so a client is never charged for a KudiAI wallet move.
--       Business payers count as before. (Used nowhere else — app and edge functions never call it.)
CREATE OR REPLACE FUNCTION public.wallet_daily_transfer_count(p_user_id UUID)
RETURNS INT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.wallet_fee_tier(p_user_id) = 'personal' THEN RETURN 0; END IF;
  RETURN (SELECT count(*)::int FROM public.wallet_ledger
           WHERE user_id = p_user_id
             AND direction = 'debit'
             AND source IN ('ajo_contribution', 'ajo_payout', 'withdrawal')
             AND status = 'completed'
             AND (created_at AT TIME ZONE 'Africa/Lagos')::date = (now() AT TIME ZONE 'Africa/Lagos')::date);
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_daily_transfer_count(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wallet_daily_transfer_count(UUID) TO authenticated, service_role;

-- ── 5. Terms v9: 4.10(b) and (d) ──────────────────────────────────────────────
DO $tnc$
DECLARE
  src      public.legal_documents%ROWTYPE;
  next_ver integer;
  today    text := trim(to_char(now() AT TIME ZONE 'Africa/Lagos', 'FMDD FMMonth YYYY'));
  old_free text := '<p>Free transfers: Ajo/Esusu Clients and personal wallets get their first <strong>3 transfers each day</strong> free (bank transfers and wallet savings payments count together). Business Owners get free bank transfers each <strong>calendar month</strong> according to their plan: <strong>Free plan — none; Standard plan — 10; Premium plan — 30</strong>. Unused free transfers do not carry over.</p>';
  new_free text := '<p>The table above is for <strong>Business Owners</strong>, who also get free bank transfers each <strong>calendar month</strong> according to their plan: <strong>Free plan — none; Standard plan — 10; Premium plan — 30</strong>. Unused free transfers do not carry over.</p>'
    || '<p><strong>Ajo/Esusu Clients and personal wallets</strong> pay only what our payment partner charges us for each bank transfer (there are no free bank transfers):</p>'
    || '<table><tr><th>Amount sent</th><th>Transfer fee</th></tr><tr><td>Up to ₦5,000</td><td>₦10</td></tr><tr><td>₦5,000.01 to ₦50,000</td><td>₦25</td></tr><tr><td>Above ₦50,000</td><td>₦50</td></tr></table>';
  old_d    text := '<p><strong>(d) Moves between KudiAI wallets</strong> (for example Ajo/Esusu savings payments and payouts) are free for your first 3 each day, then ₦10 for amounts below ₦10,000 and ₦50 for ₦10,000 or more.</p>';
  new_d    text := '<p><strong>(d) Moves between KudiAI wallets</strong> (for example Ajo/Esusu savings payments, savings circle contributions and payouts) are <strong>always free for Ajo/Esusu Clients and personal wallets</strong>. For Business Owners they are free for the first 3 each day, then ₦10 for amounts below ₦10,000 and ₦50 for ₦10,000 or more.</p>';
  body     text;
BEGIN
  SELECT * INTO src FROM public.legal_documents WHERE type = 'tnc' AND status = 'published' ORDER BY version DESC LIMIT 1;
  IF NOT FOUND THEN RAISE NOTICE 'terms | no published copy, skipped'; RETURN; END IF;
  IF position(new_d IN src.content) > 0 THEN RAISE NOTICE 'terms | v% already has the client pricing, skipped', src.version; RETURN; END IF;
  IF position(old_free IN src.content) = 0 OR position(old_d IN src.content) = 0 THEN
    RAISE NOTICE 'terms | 4.10 text not found in v% (edited by hand?) — NOT published, update the Terms in admin', src.version; RETURN;
  END IF;
  SELECT max(version) + 1 INTO next_ver FROM public.legal_documents WHERE type = 'tnc';
  body := replace(replace(src.content, old_free, new_free), old_d, new_d);
  body := regexp_replace(body,
    '<p><strong>Effective Date:</strong>[^<]*<br><strong>Last Updated:</strong>[^<]*<br><strong>Version:</strong>[^<]*</p>',
    '<p><strong>Effective Date:</strong> ' || today || '<br><strong>Last Updated:</strong> ' || today || '<br><strong>Version:</strong> ' || next_ver || '</p>');
  INSERT INTO public.legal_documents (type, content, version, status, published_at, published_by, editor_name, requires_reacceptance, change_summary)
  VALUES ('tnc', body, next_ver, 'published', now(), 'system', 'System', true,
    'Section 4.10 updated for Ajo/Esusu clients and personal wallets: bank transfers now cost only what our payment partner charges us — ₦10 up to ₦5,000, ₦25 from ₦5,000.01 to ₦50,000, ₦50 above ₦50,000 (no free bank transfers) — and moves between KudiAI wallets (savings payments, circle contributions, payouts) are always free. Deposits stay free; the ₦50 stamp duty on bank transfers of ₦10,000 or more is unchanged. Business Owners'' fees are unchanged.');
  RAISE NOTICE 'terms | v% published from v% (client transfer pricing at cost)', next_ver, src.version;
END $tnc$;

-- ── 6. self-check (prints, never fails the deploy) ────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'client pricing | free a day=% | personal bands ₦%/₦%/₦% | business bands unchanged ₦%/₦%/₦%/₦%',
    public.wallet_cfg_int('wallet_free_transfers_personal_day', -1),
    public.wallet_cfg_int('wallet_bank_fee_personal_low_kobo', 0) / 100, public.wallet_cfg_int('wallet_bank_fee_personal_mid_kobo', 0) / 100,
    public.wallet_cfg_int('wallet_bank_fee_personal_high_kobo', 0) / 100,
    public.wallet_bank_transfer_fee_kobo(499999) / 100, public.wallet_bank_transfer_fee_kobo(999999) / 100,
    public.wallet_bank_transfer_fee_kobo(5000000) / 100, public.wallet_bank_transfer_fee_kobo(5000001) / 100;
END $$;
