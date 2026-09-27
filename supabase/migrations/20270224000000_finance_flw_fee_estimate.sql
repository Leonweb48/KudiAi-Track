-- Platform finance ledger, part 2: estimate Flutterwave's fee on bank transfers when the real fee was not recorded.
--
-- WHY: the transfer response is read at creation (status NEW), before Flutterwave has priced the transfer, so wallet_withdrawals.fee_kobo stays 0 and
-- every transfer looked like pure profit. Each transfer costs a real fee, and the first 3 transfers a day are free to the customer. The sync now books,
-- per successful transfer, the real fee when one was recorded, otherwise an ESTIMATE (flagged estimated) from the fee schedule below (Flutterwave NGN
-- transfer pricing, VAT included). Finance can change the schedule in the admin portal and true it up with a manual entry from the Flutterwave statement.
-- One entry per transfer whichever it is, so a fee recorded later never doubles it. Everything else in finance_sync is unchanged.

INSERT INTO public.platform_config (key, value, description) VALUES
  ('flw_fee_low',      '10.75', 'Finance: Flutterwave transfer fee in naira for a transfer up to the low limit (used to ESTIMATE cost when the real fee was not recorded).'),
  ('flw_fee_mid',      '26.88', 'Finance: Flutterwave transfer fee in naira for a transfer above the low limit and up to the mid limit.'),
  ('flw_fee_high',     '53.75', 'Finance: Flutterwave transfer fee in naira for a transfer above the mid limit.'),
  ('flw_fee_low_upto', '5000',  'Finance: transfers up to this many naira pay the low fee.'),
  ('flw_fee_mid_upto', '50000', 'Finance: transfers up to this many naira pay the mid fee.')
ON CONFLICT (key) DO NOTHING;

-- the fee schedule as a function: transfers up to the low limit pay the low fee, up to the mid limit the mid fee, above that the high fee (limits inclusive)
CREATE OR REPLACE FUNCTION public.finance_flw_fee_kobo(p_amount_kobo bigint) RETURNS bigint
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE v_low numeric; v_mid numeric; v_high numeric; v_low_upto numeric; v_mid_upto numeric;
BEGIN
  BEGIN
    SELECT COALESCE(NULLIF((SELECT value FROM public.platform_config WHERE key = 'flw_fee_low'), '')::numeric, 10.75),
           COALESCE(NULLIF((SELECT value FROM public.platform_config WHERE key = 'flw_fee_mid'), '')::numeric, 26.88),
           COALESCE(NULLIF((SELECT value FROM public.platform_config WHERE key = 'flw_fee_high'), '')::numeric, 53.75),
           COALESCE(NULLIF((SELECT value FROM public.platform_config WHERE key = 'flw_fee_low_upto'), '')::numeric, 5000),
           COALESCE(NULLIF((SELECT value FROM public.platform_config WHERE key = 'flw_fee_mid_upto'), '')::numeric, 50000)
      INTO v_low, v_mid, v_high, v_low_upto, v_mid_upto;
  EXCEPTION WHEN OTHERS THEN v_low := 10.75; v_mid := 26.88; v_high := 53.75; v_low_upto := 5000; v_mid_upto := 50000; END;
  RETURN round(CASE WHEN p_amount_kobo <= v_low_upto * 100 THEN v_low WHEN p_amount_kobo <= v_mid_upto * 100 THEN v_mid ELSE v_high END * 100)::bigint;
END $$;
REVOKE ALL ON FUNCTION public.finance_flw_fee_kobo(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_flw_fee_kobo(bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.finance_sync(p_full boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  SETTLEMENT constant uuid := '00000000-0000-0000-0000-000000000001';
  v_since    timestamptz;
  v_started  timestamptz := clock_timestamp();
  v_res      jsonb := '{}'::jsonb;
  n          bigint;
  v_rates    jsonb := '{}'::jsonb;
  -- Paystack's published card rate (Nigeria): 1.5% + ₦100 (the flat part only from ₦2,500), capped at ₦2,000 — overridable in platform_config
  v_ps_pct   numeric; v_ps_flat numeric; v_ps_thr numeric; v_ps_cap numeric;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('finance_sync')) THEN RETURN jsonb_build_object('skipped', 'another sync is running'); END IF;

  SELECT CASE WHEN p_full THEN '-infinity'::timestamptz ELSE COALESCE((SELECT watermark FROM public.finance_sync_state WHERE key = 'main') - interval '3 days', '-infinity'::timestamptz) END INTO v_since;

  BEGIN
    v_rates := COALESCE(NULLIF((SELECT value FROM public.platform_config WHERE key = 'finance_provider_cost_pct'), '')::jsonb, '{}'::jsonb);
    IF jsonb_typeof(v_rates) <> 'object' THEN v_rates := '{}'::jsonb; END IF;
  EXCEPTION WHEN OTHERS THEN v_rates := '{}'::jsonb; END;

  BEGIN
    SELECT COALESCE(NULLIF((SELECT value FROM public.platform_config WHERE key = 'paystack_fee_pct'), '')::numeric, 1.5),
           COALESCE(NULLIF((SELECT value FROM public.platform_config WHERE key = 'paystack_fee_flat'), '')::numeric, 100),
           COALESCE(NULLIF((SELECT value FROM public.platform_config WHERE key = 'paystack_fee_flat_threshold'), '')::numeric, 2500),
           COALESCE(NULLIF((SELECT value FROM public.platform_config WHERE key = 'paystack_fee_cap'), '')::numeric, 2000)
      INTO v_ps_pct, v_ps_flat, v_ps_thr, v_ps_cap;
  EXCEPTION WHEN OTHERS THEN v_ps_pct := 1.5; v_ps_flat := 100; v_ps_thr := 2500; v_ps_cap := 2000; END;

  -- 1. fees kept by the platform: credits to the settlement wallet (the customer-side debit rows are the same money, so they are not counted twice)
  INSERT INTO public.finance_entries (occurred_at, line_code, amount_kobo, source_type, source_id, reference, category, note)
  SELECT l.created_at,
         CASE l.source WHEN 'transfer_fee' THEN 'wallet.transfer_fee' WHEN 'wallet_fee' THEN 'wallet.internal_fee' ELSE 'wallet.cbn_levy' END,
         l.amount_kobo, 'wallet_ledger', l.id::text, COALESCE(l.reference, l.related_txn_id::text), l.source, l.narration
    FROM public.wallet_ledger l
   WHERE l.user_id = SETTLEMENT AND l.direction = 'credit' AND l.source IN ('transfer_fee', 'wallet_fee', 'cbn_levy')
     AND l.status = 'completed' AND l.amount_kobo > 0 AND l.created_at >= v_since
  ON CONFLICT (line_code, source_type, source_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; v_res := v_res || jsonb_build_object('wallet_fees', n);

  -- 2. a fee handed back to a customer (a fee-source credit on a customer's own wallet)
  INSERT INTO public.finance_entries (occurred_at, line_code, amount_kobo, source_type, source_id, user_id, reference, category, note)
  SELECT l.created_at, 'wallet.fee_refunds', -l.amount_kobo, 'wallet_ledger', l.id::text, l.user_id, l.reference, l.source, l.narration
    FROM public.wallet_ledger l
   WHERE l.user_id <> SETTLEMENT AND l.direction = 'credit' AND l.source IN ('transfer_fee', 'wallet_fee') AND l.status = 'completed' AND l.amount_kobo > 0 AND l.created_at >= v_since
  ON CONFLICT (line_code, source_type, source_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; v_res := v_res || jsonb_build_object('fee_refunds', n);

  -- 3. what Flutterwave charged us on each successful transfer: its real fee when the app recorded one, otherwise an ESTIMATE from the fee schedule
  --    (the transfer response is read before Flutterwave has priced the transfer, so the real fee is usually not recorded). One entry per transfer either way.
  INSERT INTO public.finance_entries (occurred_at, line_code, amount_kobo, source_type, source_id, user_id, reference, category, estimated, note)
  SELECT COALESCE(w.updated_at, w.created_at), 'wallet.provider_fee',
         -COALESCE(NULLIF(w.fee_kobo, 0), public.finance_flw_fee_kobo(w.amount_kobo)),
         'wallet_withdrawal', w.id::text, w.user_id, w.flw_reference, 'transfer', (COALESCE(w.fee_kobo, 0) = 0),
         CASE WHEN COALESCE(w.fee_kobo, 0) > 0 THEN 'Flutterwave transfer fee' ELSE 'Estimated Flutterwave transfer fee (the real fee was not recorded)' END
    FROM public.wallet_withdrawals w
   WHERE w.status = 'successful' AND COALESCE(w.updated_at, w.created_at) >= v_since
  ON CONFLICT (line_code, source_type, source_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; v_res := v_res || jsonb_build_object('transfer_costs', n);

  -- 4. bill sales paid from the wallet. Only a debit that has been settled (completed) or refunded (reversed) is counted — a pending one is still in flight.
  --    Category: the server-side gate's record of the order, else the business's own transaction the debit was linked to, else "other".
  INSERT INTO public.finance_entries (occurred_at, line_code, amount_kobo, source_type, source_id, user_id, reference, category, note)
  SELECT l.created_at, 'bills.sales', l.amount_kobo, 'wallet_ledger', l.id::text, l.user_id, l.reference,
         COALESCE(lower(g.cat), NULLIF(lower(t.category), ''), 'other'), l.narration
    FROM public.wallet_ledger l
    LEFT JOIN public.transactions t ON t.id = l.related_txn_id
    LEFT JOIN LATERAL (SELECT c.cat FROM public.bill_gate_claims c WHERE c.base_ref = l.reference ORDER BY c.created_at LIMIT 1) g ON true
   WHERE l.source = 'bill_spend' AND l.direction = 'debit' AND l.status IN ('completed', 'reversed') AND l.amount_kobo > 0 AND l.created_at >= v_since
  ON CONFLICT (line_code, source_type, source_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; v_res := v_res || jsonb_build_object('bill_sales_wallet', n);

  -- 5. bill refunds paid back to the wallet — the CHARGEBACKS. Reference and category follow the sale that was reversed.
  INSERT INTO public.finance_entries (occurred_at, line_code, amount_kobo, source_type, source_id, user_id, reference, category, note)
  SELECT l.created_at, 'bills.refunds', -l.amount_kobo, 'wallet_ledger', l.id::text, l.user_id, COALESCE(l.reference, o.reference),
         COALESCE(lower(g.cat), NULLIF(lower(t.category), ''), 'other'), l.narration
    FROM public.wallet_ledger l
    LEFT JOIN public.wallet_ledger o ON o.id::text = l.meta ->> 'reversed_ledger_id'
    LEFT JOIN public.transactions t  ON t.id = o.related_txn_id
    LEFT JOIN LATERAL (SELECT c.cat FROM public.bill_gate_claims c WHERE c.base_ref = COALESCE(l.reference, o.reference) ORDER BY c.created_at LIMIT 1) g ON true
   WHERE l.source = 'bill_reversal' AND l.direction = 'credit' AND l.status IN ('completed', 'reversed') AND l.amount_kobo > 0 AND l.created_at >= v_since
  ON CONFLICT (line_code, source_type, source_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; v_res := v_res || jsonb_build_object('bill_refunds', n);

  -- 6. bill sales paid by card: an order counts when it was FULFILLED. The amount is what Paystack actually charged (the webhook stores it in
  --    fulfillment.amount); the app-written paid_amount is the fallback. (A card payment whose delivery failed is refunded outside the app.)
  INSERT INTO public.finance_entries (occurred_at, line_code, amount_kobo, source_type, source_id, user_id, reference, category, note)
  SELECT COALESCE(b.fulfilled_at, b.created_at), 'bills.sales',
         round(COALESCE(CASE WHEN (b.fulfillment ->> 'amount') ~ '^[0-9]+(\.[0-9]+)?$' THEN (b.fulfillment ->> 'amount')::numeric END, b.paid_amount) * 100)::bigint,
         'pending_bill', b.reference, b.user_id, b.reference, COALESCE(NULLIF(lower(b.cat), ''), 'other'), 'Card payment'
    FROM public.pending_bills b
   WHERE b.status = 'fulfilled' AND COALESCE(b.paid_amount, 0) > 0 AND COALESCE(b.fulfilled_at, b.created_at) >= v_since
  ON CONFLICT (line_code, source_type, source_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; v_res := v_res || jsonb_build_object('bill_sales_card', n);

  -- 7. estimated card-processing fee on those card bills (attributed to the bills stream)
  INSERT INTO public.finance_entries (occurred_at, line_code, amount_kobo, source_type, source_id, user_id, reference, category, estimated, note, meta)
  SELECT s.occurred_at, 'payments.processor_fee',
         -round(LEAST(v_ps_cap, (s.amount_kobo / 100.0) * v_ps_pct / 100 + CASE WHEN s.amount_kobo / 100.0 >= v_ps_thr THEN v_ps_flat ELSE 0 END) * 100)::bigint,
         'pending_bill', s.source_id, s.user_id, s.reference, s.category, true, 'Estimated Paystack fee', jsonb_build_object('stream', 'bills')
    FROM public.finance_entries s
   WHERE s.line_code = 'bills.sales' AND s.source_type = 'pending_bill' AND s.amount_kobo > 0 AND s.occurred_at >= v_since
  ON CONFLICT (line_code, source_type, source_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; v_res := v_res || jsonb_build_object('card_fees_bills', n);

  -- 8. provider cost for categories with no per-order record (cable, electricity, betting, exam pins, …): a configured share of the sale, default 100 %
  INSERT INTO public.finance_entries (occurred_at, line_code, amount_kobo, source_type, source_id, user_id, reference, category, estimated, note, meta)
  SELECT s.occurred_at, 'bills.provider_cost',
         -round(s.amount_kobo * LEAST(GREATEST(CASE WHEN (v_rates ->> s.category) ~ '^[0-9]+(\.[0-9]+)?$' THEN (v_rates ->> s.category)::numeric ELSE 100 END, 0), 200) / 100)::bigint,
         'bill_cost_rate', s.source_type || ':' || s.source_id, s.user_id, s.reference, s.category, true, 'Provider cost at the configured share of the sale',
         jsonb_build_object('basis', 'rate', 'pct', CASE WHEN (v_rates ->> s.category) ~ '^[0-9]+(\.[0-9]+)?$' THEN (v_rates ->> s.category)::numeric ELSE 100 END)
    FROM public.finance_entries s
   WHERE s.line_code = 'bills.sales' AND s.source_type IN ('wallet_ledger', 'pending_bill') AND s.amount_kobo > 0 AND s.occurred_at >= v_since
     AND s.category NOT IN ('airtime', 'data', 'print-airtime', 'print-data')
     AND round(s.amount_kobo * LEAST(GREATEST(CASE WHEN (v_rates ->> s.category) ~ '^[0-9]+(\.[0-9]+)?$' THEN (v_rates ->> s.category)::numeric ELSE 100 END, 0), 200) / 100) > 0
  ON CONFLICT (line_code, source_type, source_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; v_res := v_res || jsonb_build_object('bill_costs_rate', n);

  -- 9. the cost of an order that was later refunded comes back (ClubKonnect refunds a failed order) — booked when the refund happened
  INSERT INTO public.finance_entries (occurred_at, line_code, amount_kobo, source_type, source_id, user_id, reference, category, estimated, note)
  SELECT r.occurred_at, 'bills.provider_cost', -c.amount_kobo, 'bill_cost_reversal', c.source_type || ':' || c.source_id, c.user_id, c.reference, c.category, c.estimated,
         'Order refunded — provider cost reversed'
    FROM public.finance_entries r
    JOIN public.finance_entries c ON c.line_code = 'bills.provider_cost' AND c.source_type IN ('bill_cost', 'bill_cost_rate') AND c.amount_kobo < 0
         AND regexp_replace(COALESCE(c.reference, ''), '-(MTN|AIR|9MB|GLO)$', '') = r.reference
   WHERE r.line_code = 'bills.refunds' AND r.reference IS NOT NULL AND r.occurred_at >= v_since
  ON CONFLICT (line_code, source_type, source_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; v_res := v_res || jsonb_build_object('cost_reversals', n);

  -- 10. subscriptions paid from the wallet (actual); the plan comes from the subscription row, else from the ledger's own narration
  INSERT INTO public.finance_entries (occurred_at, line_code, amount_kobo, source_type, source_id, user_id, reference, category, note)
  SELECT l.created_at, 'subscriptions.sales', l.amount_kobo, 'wallet_ledger', l.id::text, l.user_id, l.reference,
         COALESCE(s.plan, (SELECT sp.slug FROM public.subscription_plans sp WHERE sp.name = substring(l.narration from 'Plan upgrade — (.*) \(') LIMIT 1),
                  lower(NULLIF(substring(l.narration from 'Plan upgrade — (.*) \('), '')), 'unknown'), l.narration
    FROM public.wallet_ledger l
    LEFT JOIN public.subscriptions s ON s.wallet_ledger_id = l.id
   WHERE l.source = 'subscription_spend' AND l.direction = 'debit' AND l.status IN ('completed', 'reversed') AND l.amount_kobo > 0 AND l.created_at >= v_since
  ON CONFLICT (line_code, source_type, source_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; v_res := v_res || jsonb_build_object('subscription_sales_wallet', n);

  INSERT INTO public.finance_entries (occurred_at, line_code, amount_kobo, source_type, source_id, user_id, reference, category, note)
  SELECT l.created_at, 'subscriptions.refunds', -l.amount_kobo, 'wallet_ledger', l.id::text, l.user_id, l.reference, 'refund', l.narration
    FROM public.wallet_ledger l
   WHERE l.source = 'subscription_reversal' AND l.direction = 'credit' AND l.status IN ('completed', 'reversed') AND l.amount_kobo > 0 AND l.created_at >= v_since
  ON CONFLICT (line_code, source_type, source_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; v_res := v_res || jsonb_build_object('subscription_refunds', n);

  -- 11. OLDER card subscription payments: no per-payment record exists (one row per business, updated in place), so each is ESTIMATED from the plan
  --     price — or taken as actual from the coupon redemption when a coupon was used. Only a business's latest card payment can be seen.
  INSERT INTO public.finance_entries (occurred_at, line_code, amount_kobo, source_type, source_id, user_id, reference, category, estimated, note)
  SELECT s.created_at, 'subscriptions.sales',
         COALESCE(round(cr.final_amount * 100)::bigint,
                  round((CASE WHEN s.billing_cycle = 'yearly' THEN COALESCE(NULLIF(p.price_yearly, 0), p.price_monthly * 12) ELSE p.price_monthly END) * 100)::bigint),
         'subscription_row', s.id::text, s.user_id, s.paystack_reference, s.plan, (cr.final_amount IS NULL),
         CASE WHEN cr.final_amount IS NULL THEN 'Estimated from the plan price (latest card payment only)' ELSE 'Card payment, coupon applied' END
    FROM public.subscriptions s
    LEFT JOIN public.subscription_plans p ON p.slug = s.plan
    LEFT JOIN LATERAL (SELECT c.final_amount FROM public.coupon_redemptions c WHERE c.paystack_reference = s.paystack_reference ORDER BY c.redeemed_at DESC LIMIT 1) cr ON true
   WHERE s.paystack_reference IS NOT NULL AND s.wallet_ledger_id IS NULL AND s.created_at >= v_since
     AND COALESCE(round(cr.final_amount * 100)::bigint,
                  round((CASE WHEN s.billing_cycle = 'yearly' THEN COALESCE(NULLIF(p.price_yearly, 0), p.price_monthly * 12) ELSE p.price_monthly END) * 100)::bigint, 0) > 0
  ON CONFLICT (line_code, source_type, source_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; v_res := v_res || jsonb_build_object('subscription_sales_card', n);

  INSERT INTO public.finance_entries (occurred_at, line_code, amount_kobo, source_type, source_id, user_id, reference, category, estimated, note, meta)
  SELECT s.occurred_at, 'payments.processor_fee',
         -round(LEAST(v_ps_cap, (s.amount_kobo / 100.0) * v_ps_pct / 100 + CASE WHEN s.amount_kobo / 100.0 >= v_ps_thr THEN v_ps_flat ELSE 0 END) * 100)::bigint,
         'subscription_row', s.source_id, s.user_id, s.reference, s.category, true, 'Estimated Paystack fee', jsonb_build_object('stream', 'subscriptions')
    FROM public.finance_entries s
   WHERE s.line_code = 'subscriptions.sales' AND s.source_type = 'subscription_row' AND s.amount_kobo > 0 AND s.occurred_at >= v_since
  ON CONFLICT (line_code, source_type, source_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; v_res := v_res || jsonb_build_object('card_fees_subscriptions', n);

  -- 12. partner income (only once confirmed / paid — a pending or disputed claim is not income yet)
  INSERT INTO public.finance_entries (occurred_at, line_code, amount_kobo, source_type, source_id, category, note)
  SELECT COALESCE(p.confirmed_at, p.paid_at, p.created_at), 'partners.commission', p.amount_kobo, 'partner_commission', p.id::text, p.audience_segment, p.notes
    FROM public.partner_commission_records p
   WHERE p.status IN ('confirmed', 'paid') AND COALESCE(p.amount_kobo, 0) > 0
  ON CONFLICT (line_code, source_type, source_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; v_res := v_res || jsonb_build_object('partner_income', n);

  -- 13. marketer commissions owed (accrued when earned) …
  INSERT INTO public.finance_entries (occurred_at, line_code, amount_kobo, source_type, source_id, user_id, reference, category, note)
  SELECT m.created_at, 'commissions.marketer', -round(m.amount * 100)::bigint, 'marketer_commission', m.id::text, m.business_id, m.reference, COALESCE(m.event_type, m.type), m.notes
    FROM public.marketer_commissions m
   WHERE COALESCE(m.amount, 0) > 0 AND m.status IN ('pending', 'approved', 'paid')
  ON CONFLICT (line_code, source_type, source_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; v_res := v_res || jsonb_build_object('marketer_commissions', n);

  --     … and reversed if the commission is later rejected
  INSERT INTO public.finance_entries (occurred_at, line_code, amount_kobo, source_type, source_id, user_id, reference, category, note)
  SELECT now(), 'commissions.marketer', -e.amount_kobo, 'marketer_commission_reversal', e.source_id, e.user_id, e.reference, e.category, 'Commission rejected'
    FROM public.finance_entries e
    JOIN public.marketer_commissions m ON m.id::text = e.source_id
   WHERE e.source_type = 'marketer_commission' AND m.status = 'rejected'
  ON CONFLICT (line_code, source_type, source_id) DO NOTHING;

  INSERT INTO public.finance_sync_state (key, watermark, last_run, last_result) VALUES ('main', v_started, now(), v_res)
  ON CONFLICT (key) DO UPDATE SET watermark = EXCLUDED.watermark, last_run = EXCLUDED.last_run, last_result = EXCLUDED.last_result;
  RETURN v_res;
END $$;

REVOKE ALL ON FUNCTION public.finance_sync(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_sync(boolean) TO service_role;

-- book the estimate for the transfers already made
DO $$
BEGIN
  PERFORM public.finance_sync(true);
  RAISE NOTICE 'finance | transfer fee estimates backfilled';
END $$;

-- self-test (rolled back): the tiers and their edges, a changed schedule, garbage settings falling back to the defaults, and a rerun of the sync adding nothing
DO $$
DECLARE v_before bigint; v_err text;
BEGIN
  IF public.finance_flw_fee_kobo(300000) <> 1075 OR public.finance_flw_fee_kobo(500000) <> 1075 THEN RAISE EXCEPTION 'finance self-test: low tier wrong (3,000 naira and the 5,000 edge)'; END IF;
  IF public.finance_flw_fee_kobo(500001) <> 2688 OR public.finance_flw_fee_kobo(5000000) <> 2688 THEN RAISE EXCEPTION 'finance self-test: mid tier wrong (just above 5,000 and the 50,000 edge)'; END IF;
  IF public.finance_flw_fee_kobo(5000001) <> 5375 OR public.finance_flw_fee_kobo(80000000) <> 5375 THEN RAISE EXCEPTION 'finance self-test: high tier wrong'; END IF;
  UPDATE public.platform_config SET value = '20' WHERE key = 'flw_fee_low';
  IF public.finance_flw_fee_kobo(300000) <> 2000 THEN RAISE EXCEPTION 'finance self-test: a changed schedule was ignored'; END IF;
  UPDATE public.platform_config SET value = 'abc' WHERE key = 'flw_fee_low';
  IF public.finance_flw_fee_kobo(300000) <> 1075 THEN RAISE EXCEPTION 'finance self-test: a garbage setting must fall back to the default'; END IF;
  SELECT count(*) INTO v_before FROM public.finance_entries;
  PERFORM public.finance_sync(true);
  IF (SELECT count(*) FROM public.finance_entries) <> v_before THEN RAISE EXCEPTION 'finance self-test: a second sync added entries'; END IF;
  RAISE EXCEPTION 'finance self-test passed (rolled back)';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
  IF v_err NOT LIKE 'finance self-test passed%' THEN RAISE; END IF;
  RAISE NOTICE 'finance | transfer fee self-test passed';
END $$;
