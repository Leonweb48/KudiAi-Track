-- Bills account (2026-10-26, owner: "keep bills money in a different account so we can see actual amount spent and profit") —
-- books only, no money moves. Everything a bill takes in and pays out, with:
--   1. finance_sync (copied from 20270224, the current definition — only the bill-cost rules change, see 8 / 8b / 9):
--      an order's estimated provider cost (a share of the sale) is no longer booked when the order has its real per-order cost,
--      and one booked before the real cost arrived is cancelled. Found: a Bigisub electricity order was counted twice.
--      Per-order costs now also come from cable / Smile / Spectranet / exam PINs (ClubKonnect's list price) and every Bigisub
--      service (its reported charge) — written by the clubkonnect function, not here.
--   2. bill_provider_balances: the ClubKonnect / Bigisub wallet balance every 30 minutes (cron → clubkonnect
--      provider-balance-snapshot) and bill_provider_topups: what finance paid into them (entered in the admin portal).
--   3. finance_bills_report(from, to): sales, refunds, provider cost (real vs estimated), card fees, profit — in total, per
--      service, per provider and per day — and each provider wallet checked: opening + top-ups − closing = spent, against the
--      cost our records show for it.
-- Service role only, like the rest of the finance ledger.

-- ── 1. provider wallets ──────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bill_provider_balances (
  id           bigserial PRIMARY KEY,
  provider     text        NOT NULL CHECK (provider IN ('clubkonnect', 'bigisub', 'vtpass')),
  balance_kobo bigint      NOT NULL,
  observed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bill_provider_balances_idx ON public.bill_provider_balances (provider, observed_at DESC);

CREATE TABLE IF NOT EXISTS public.bill_provider_topups (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider    text        NOT NULL CHECK (provider IN ('clubkonnect', 'bigisub', 'vtpass')),
  amount_kobo bigint      NOT NULL CHECK (amount_kobo > 0 AND amount_kobo <= 100000000000),
  paid_at     timestamptz NOT NULL,
  note        text        CHECK (note IS NULL OR length(note) <= 300),
  created_by  text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  voided_at   timestamptz,
  voided_by   text
);
CREATE INDEX IF NOT EXISTS bill_provider_topups_idx ON public.bill_provider_topups (provider, paid_at DESC);

-- a top-up is never edited or deleted — only marked void once (who and when), so the record of every change stays
CREATE OR REPLACE FUNCTION public.bill_provider_topups_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'a top-up is never deleted: void it instead'; END IF;
  IF OLD.voided_at IS NOT NULL THEN RAISE EXCEPTION 'this top-up is already void'; END IF;
  IF NEW.voided_at IS NULL OR NEW.voided_by IS NULL OR (NEW.provider, NEW.amount_kobo, NEW.paid_at, NEW.note, NEW.created_by, NEW.created_at)
       IS DISTINCT FROM (OLD.provider, OLD.amount_kobo, OLD.paid_at, OLD.note, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'a top-up can only be voided (voided_at + voided_by), never changed';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bill_provider_topups_guard ON public.bill_provider_topups;
CREATE TRIGGER bill_provider_topups_guard BEFORE UPDATE OR DELETE ON public.bill_provider_topups FOR EACH ROW EXECUTE FUNCTION public.bill_provider_topups_guard();

ALTER TABLE public.bill_provider_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_provider_topups   ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bill_provider_balances, public.bill_provider_topups FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.bill_provider_balances_id_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.bill_provider_balances TO service_role;
GRANT USAGE ON SEQUENCE public.bill_provider_balances_id_seq TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.bill_provider_topups TO service_role;

-- the line is every bill provider's cost now, not only ClubKonnect's
UPDATE public.finance_lines SET name = 'Bill provider cost',
  description = 'What the bill provider (ClubKonnect, Bigisub, VTpass) charged us for each order: its reported charge, its list price, or a configured share of the sale when neither is known; reversed when the order is refunded. Manual entries adjust it (e.g. a commission received).'
 WHERE code = 'bills.provider_cost';

-- ── 2. the sync ──────────────────────────────────────────────────────────────────────────────────────────────────
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

  -- 8. provider cost for an order with no per-order record (ClubKonnect electricity and betting; anything whose cost wasn't recorded): a configured
  --    share of the sale, default 100 %. Since 2026-10-26 (Bills account): never for an order that HAS a per-order cost (Bigisub electricity was counted
  --    twice), and only once the sale is 30 minutes old — per-order costs are written seconds after the purchase.
  INSERT INTO public.finance_entries (occurred_at, line_code, amount_kobo, source_type, source_id, user_id, reference, category, estimated, note, meta)
  SELECT s.occurred_at, 'bills.provider_cost',
         -round(s.amount_kobo * LEAST(GREATEST(CASE WHEN (v_rates ->> s.category) ~ '^[0-9]+(\.[0-9]+)?$' THEN (v_rates ->> s.category)::numeric ELSE 100 END, 0), 200) / 100)::bigint,
         'bill_cost_rate', s.source_type || ':' || s.source_id, s.user_id, s.reference, s.category, true, 'Provider cost at the configured share of the sale',
         jsonb_build_object('basis', 'rate', 'pct', CASE WHEN (v_rates ->> s.category) ~ '^[0-9]+(\.[0-9]+)?$' THEN (v_rates ->> s.category)::numeric ELSE 100 END)
    FROM public.finance_entries s
   WHERE s.line_code = 'bills.sales' AND s.source_type IN ('wallet_ledger', 'pending_bill') AND s.amount_kobo > 0 AND s.occurred_at >= v_since
     AND s.category NOT IN ('airtime', 'data', 'print-airtime', 'print-data')
     AND s.occurred_at < now() - interval '30 minutes'
     AND NOT EXISTS (SELECT 1 FROM public.finance_entries c WHERE c.line_code = 'bills.provider_cost' AND c.source_type = 'bill_cost'
                       AND regexp_replace(COALESCE(c.reference, ''), '-(MTN|AIR|9MB|GLO)$', '') = s.reference)
     AND round(s.amount_kobo * LEAST(GREATEST(CASE WHEN (v_rates ->> s.category) ~ '^[0-9]+(\.[0-9]+)?$' THEN (v_rates ->> s.category)::numeric ELSE 100 END, 0), 200) / 100) > 0
  ON CONFLICT (line_code, source_type, source_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; v_res := v_res || jsonb_build_object('bill_costs_rate', n);

  -- 8b. an estimated share booked before the order's real cost arrived (a token found later, an older double count) is cancelled by an opposite
  --     entry — unless the order was refunded and step 9 already reversed that estimate. No time window: a real cost can arrive any time.
  INSERT INTO public.finance_entries (occurred_at, line_code, amount_kobo, source_type, source_id, user_id, reference, category, estimated, note, meta)
  SELECT now(), 'bills.provider_cost', -c.amount_kobo, 'bill_cost_rate_void', c.source_id, c.user_id, c.reference, c.category, true,
         'Estimated share cancelled — the order''s real cost was recorded', jsonb_build_object('provider', COALESCE(c.meta ->> 'provider', 'clubkonnect'))
    FROM public.finance_entries c
   WHERE c.line_code = 'bills.provider_cost' AND c.source_type = 'bill_cost_rate' AND c.amount_kobo < 0
     AND EXISTS (SELECT 1 FROM public.finance_entries o WHERE o.line_code = 'bills.provider_cost' AND o.source_type = 'bill_cost'
                   AND regexp_replace(COALESCE(o.reference, ''), '-(MTN|AIR|9MB|GLO)$', '') = c.reference)
     AND NOT EXISTS (SELECT 1 FROM public.finance_entries r WHERE r.line_code = 'bills.provider_cost' AND r.source_type = 'bill_cost_reversal'
                       AND r.source_id = 'bill_cost_rate:' || c.source_id)
  ON CONFLICT (line_code, source_type, source_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; v_res := v_res || jsonb_build_object('rate_costs_cancelled', n);

  -- 9. the cost of an order that was later refunded comes back (ClubKonnect refunds a failed order) — booked when the refund happened
  INSERT INTO public.finance_entries (occurred_at, line_code, amount_kobo, source_type, source_id, user_id, reference, category, estimated, note, meta)
  SELECT r.occurred_at, 'bills.provider_cost', -c.amount_kobo, 'bill_cost_reversal', c.source_type || ':' || c.source_id, c.user_id, c.reference, c.category, c.estimated,
         'Order refunded — provider cost reversed', jsonb_build_object('provider', COALESCE(c.meta ->> 'provider', 'clubkonnect'))
    FROM public.finance_entries r
    JOIN public.finance_entries c ON c.line_code = 'bills.provider_cost' AND c.source_type IN ('bill_cost', 'bill_cost_rate') AND c.amount_kobo < 0
         AND regexp_replace(COALESCE(c.reference, ''), '-(MTN|AIR|9MB|GLO)$', '') = r.reference
   WHERE r.line_code = 'bills.refunds' AND r.reference IS NOT NULL AND r.occurred_at >= v_since
     AND NOT (c.source_type = 'bill_cost_rate' AND EXISTS (SELECT 1 FROM public.finance_entries v WHERE v.line_code = 'bills.provider_cost'
                AND v.source_type = 'bill_cost_rate_void' AND v.source_id = c.source_id))
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

-- ── 3. the Bills account report ──────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finance_bills_report(p_from timestamptz, p_to timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_out jsonb; v_wallets jsonb := '[]'::jsonb; p text;
  v_open record; v_close record; v_latest record; v_top bigint; v_cost bigint;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN RAISE EXCEPTION 'a valid period is required'; END IF;


  -- each provider wallet: opening and closing readings around the period, top-ups and recorded cost between those two readings
  FOREACH p IN ARRAY ARRAY['clubkonnect', 'bigisub'] LOOP
    SELECT balance_kobo, observed_at INTO v_open FROM public.bill_provider_balances
     WHERE provider = p AND observed_at <= p_from ORDER BY observed_at DESC LIMIT 1;
    IF v_open IS NULL OR v_open.observed_at IS NULL THEN
      SELECT balance_kobo, observed_at INTO v_open FROM public.bill_provider_balances
       WHERE provider = p AND observed_at > p_from AND observed_at < p_to ORDER BY observed_at LIMIT 1;
    END IF;
    SELECT balance_kobo, observed_at INTO v_close FROM public.bill_provider_balances
     WHERE provider = p AND observed_at < p_to ORDER BY observed_at DESC LIMIT 1;
    SELECT balance_kobo, observed_at INTO v_latest FROM public.bill_provider_balances WHERE provider = p ORDER BY observed_at DESC LIMIT 1;
    v_top := NULL; v_cost := NULL;
    IF v_open.observed_at IS NOT NULL AND v_close.observed_at IS NOT NULL AND v_close.observed_at > v_open.observed_at THEN
      SELECT COALESCE(sum(amount_kobo), 0) INTO v_top FROM public.bill_provider_topups
       WHERE provider = p AND voided_at IS NULL AND paid_at >= v_open.observed_at AND paid_at < v_close.observed_at;
      SELECT COALESCE(-sum(e.amount_kobo), 0) INTO v_cost
        FROM public.finance_entries e
        LEFT JOIN LATERAL (SELECT x.meta FROM public.finance_entries x
                            WHERE e.source_type IN ('bill_cost_reversal', 'bill_cost_rate_void') AND x.line_code = 'bills.provider_cost'
                              AND x.source_type || ':' || x.source_id = CASE WHEN e.source_type = 'bill_cost_rate_void' THEN 'bill_cost_rate:' || e.source_id ELSE e.source_id END
                            LIMIT 1) o ON true
       WHERE e.line_code = 'bills.provider_cost' AND e.occurred_at >= v_open.observed_at AND e.occurred_at < v_close.observed_at
         AND COALESCE(e.meta ->> 'provider', o.meta ->> 'provider', 'clubkonnect') = p;
    END IF;
    v_wallets := v_wallets || jsonb_build_array(jsonb_build_object(
      'provider', p,
      'opening_kobo', v_open.balance_kobo, 'opening_at', v_open.observed_at,
      'closing_kobo', CASE WHEN v_close.observed_at > v_open.observed_at THEN v_close.balance_kobo END,
      'closing_at',   CASE WHEN v_close.observed_at > v_open.observed_at THEN v_close.observed_at END,
      'topups_kobo', v_top,
      'spent_kobo', CASE WHEN v_top IS NOT NULL THEN v_open.balance_kobo + v_top - v_close.balance_kobo END,
      'recorded_cost_kobo', v_cost,
      'difference_kobo', CASE WHEN v_top IS NOT NULL THEN (v_open.balance_kobo + v_top - v_close.balance_kobo) - v_cost END,
      'latest_kobo', v_latest.balance_kobo, 'latest_at', v_latest.observed_at));
    v_open := NULL; v_close := NULL; v_latest := NULL;
  END LOOP;

  WITH _bills_e (occurred_at, kind, amount_kobo, estimated, cat, provider, reference) AS (
  SELECT e.occurred_at,
         CASE e.line_code WHEN 'bills.sales' THEN 'sale' WHEN 'bills.refunds' THEN 'refund' WHEN 'bills.provider_cost' THEN 'cost' ELSE 'fee' END,
         e.amount_kobo, e.estimated, COALESCE(NULLIF(lower(e.category), ''), 'other'),
         CASE WHEN e.line_code = 'bills.provider_cost' THEN COALESCE(e.meta ->> 'provider', o.meta ->> 'provider', 'clubkonnect') END,
         regexp_replace(COALESCE(e.reference, ''), '-(MTN|AIR|9MB|GLO)$', '')
    FROM public.finance_entries e
    LEFT JOIN LATERAL (SELECT x.meta FROM public.finance_entries x
                        WHERE e.source_type IN ('bill_cost_reversal', 'bill_cost_rate_void') AND x.line_code = 'bills.provider_cost'
                          AND x.source_type || ':' || x.source_id = CASE WHEN e.source_type = 'bill_cost_rate_void' THEN 'bill_cost_rate:' || e.source_id ELSE e.source_id END
                        LIMIT 1) o ON true
   WHERE e.occurred_at >= p_from AND e.occurred_at < p_to
     AND (e.line_code IN ('bills.sales', 'bills.refunds', 'bills.provider_cost') OR (e.line_code = 'payments.processor_fee' AND e.meta ->> 'stream' = 'bills'))
  )
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to,
    'totals', (SELECT jsonb_build_object(
        'sales_kobo',          COALESCE(sum(amount_kobo) FILTER (WHERE kind = 'sale'), 0),
        'refunds_kobo',        COALESCE(sum(amount_kobo) FILTER (WHERE kind = 'refund'), 0),
        'cost_kobo',           COALESCE(sum(amount_kobo) FILTER (WHERE kind = 'cost'), 0),
        'cost_estimated_kobo', COALESCE(sum(amount_kobo) FILTER (WHERE kind = 'cost' AND estimated), 0),
        'card_fees_kobo',      COALESCE(sum(amount_kobo) FILTER (WHERE kind = 'fee'), 0),
        'profit_kobo',         COALESCE(sum(amount_kobo), 0),
        'orders',              count(*) FILTER (WHERE kind = 'sale'),
        'refunded_orders',     count(*) FILTER (WHERE kind = 'refund')) FROM _bills_e),
    -- sales kept (not refunded) that have no cost of any kind: their profit is overstated until a cost is booked
    'uncosted', (SELECT jsonb_build_object('orders', count(*), 'sales_kobo', COALESCE(sum(s.amount_kobo), 0))
                   FROM _bills_e s
                  WHERE s.kind = 'sale' AND s.reference <> ''
                    AND NOT EXISTS (SELECT 1 FROM public.finance_entries c WHERE c.line_code = 'bills.provider_cost'
                                      AND regexp_replace(COALESCE(c.reference, ''), '-(MTN|AIR|9MB|GLO)$', '') = s.reference)
                    AND NOT EXISTS (SELECT 1 FROM public.finance_entries r WHERE r.line_code = 'bills.refunds' AND r.reference = s.reference)),
    'by_service', COALESCE((SELECT jsonb_agg(row_to_json(t) ORDER BY t.sales_kobo DESC) FROM (
        SELECT cat AS service,
               COALESCE(sum(amount_kobo) FILTER (WHERE kind = 'sale'), 0)   AS sales_kobo,
               COALESCE(sum(amount_kobo) FILTER (WHERE kind = 'refund'), 0) AS refunds_kobo,
               COALESCE(sum(amount_kobo) FILTER (WHERE kind = 'cost'), 0)   AS cost_kobo,
               COALESCE(sum(amount_kobo) FILTER (WHERE kind = 'cost' AND estimated), 0) AS cost_estimated_kobo,
               COALESCE(sum(amount_kobo) FILTER (WHERE kind = 'fee'), 0)    AS card_fees_kobo,
               COALESCE(sum(amount_kobo), 0) AS profit_kobo,
               count(*) FILTER (WHERE kind = 'sale') AS orders,
               count(*) FILTER (WHERE kind = 'refund') AS refunded_orders
          FROM _bills_e GROUP BY cat) t), '[]'::jsonb),
    'by_provider', COALESCE((SELECT jsonb_agg(row_to_json(t) ORDER BY t.cost_kobo) FROM (
        SELECT provider, COALESCE(sum(amount_kobo), 0) AS cost_kobo,
               COALESCE(sum(amount_kobo) FILTER (WHERE estimated), 0) AS cost_estimated_kobo,
               count(DISTINCT reference) FILTER (WHERE amount_kobo < 0) AS orders
          FROM _bills_e WHERE kind = 'cost' GROUP BY provider) t), '[]'::jsonb),
    'daily', COALESCE((SELECT jsonb_agg(row_to_json(t) ORDER BY t.day) FROM (
        SELECT (occurred_at AT TIME ZONE 'Africa/Lagos')::date AS day,
               COALESCE(sum(amount_kobo) FILTER (WHERE kind = 'sale'), 0)   AS sales_kobo,
               COALESCE(sum(amount_kobo) FILTER (WHERE kind = 'refund'), 0) AS refunds_kobo,
               COALESCE(sum(amount_kobo) FILTER (WHERE kind = 'cost'), 0)   AS cost_kobo,
               COALESCE(sum(amount_kobo), 0) AS profit_kobo,
               count(*) FILTER (WHERE kind = 'sale') AS orders
          FROM _bills_e GROUP BY 1) t), '[]'::jsonb),
    'wallets', v_wallets,
    'topups', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'provider', provider, 'amount_kobo', amount_kobo, 'paid_at', paid_at, 'note', note,
                                                             'created_by', created_by, 'voided_at', voided_at, 'voided_by', voided_by) ORDER BY paid_at DESC)
                          FROM public.bill_provider_topups WHERE paid_at >= p_from AND paid_at < p_to), '[]'::jsonb),
    'last_sync', (SELECT last_run FROM public.finance_sync_state WHERE key = 'main')
  ) INTO v_out;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.finance_bills_report(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_bills_report(timestamptz, timestamptz) TO service_role;

-- ── 4. snapshots every 30 minutes (same Vault cron_secret pattern as the bill charge sweep, 20270299) ──────────────
DO $$
BEGIN
  PERFORM cron.unschedule('provider-balance-snapshot') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'provider-balance-snapshot');
  PERFORM cron.schedule('provider-balance-snapshot', '7,37 * * * *', $cron$
    DO $inner$
    DECLARE v_secret text;
    BEGIN
      SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret';
      IF v_secret IS NOT NULL THEN
        PERFORM net.http_post(
          url     := 'https://eztohcuzbxxxvnondxfz.supabase.co/functions/v1/clubkonnect',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
          body    := jsonb_build_object('action', 'provider-balance-snapshot'),
          timeout_milliseconds := 60000
        );
      END IF;
    END $inner$;
  $cron$);
  RAISE NOTICE 'bills account | provider wallet snapshot scheduled at :07 and :37';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'bills account | could not schedule the snapshot (pg_cron unavailable?): %', SQLERRM;
END $$;

-- ── 5. book it now: the double count is cancelled, new rules apply (counts only) ─────────────────────────────────
DO $$
DECLARE r jsonb;
BEGIN
  r := public.finance_sync(false);
  RAISE NOTICE 'bills account | sync: estimates cancelled=%, estimates booked=%, cost reversals=%', r ->> 'rate_costs_cancelled', r ->> 'bill_costs_rate', r ->> 'cost_reversals';
END $$;
