-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- PLATFORM FINANCE LEDGER — how much money KudiAI itself makes (admin / finance_admin only)
--
-- WHAT THIS IS
--   One append-only table, finance_entries, holds every line of the platform's own profit-and-loss: what customers paid us (revenue), what
--   was handed back (refunds / chargebacks), what we paid providers (cost of sales) and what we paid out (commissions, other costs).
--   Signed in the platform's favour: revenue is +, refunds and costs are −, so  PROFIT = SUM(amount_kobo) over the lines that count.
--   The lines that exist (the "chart of accounts") are in finance_lines; each has a section that decides where it lands in the statement.
--
-- WHERE THE NUMBERS COME FROM (records the app already keeps — nothing here can move, hold or block a customer's money)
--   finance_sync()  reads the source tables and inserts any entry that is missing (idempotent — running it twice adds nothing):
--     • wallet fees ............ credits to the platform settlement wallet (transfer_fee / wallet_fee); the pass-through CBN levy is a memo line
--     • transfer cost .......... Flutterwave's real fee on each successful transfer (wallet_withdrawals.fee_kobo)
--     • bill sales / refunds ... wallet: bill_spend / bill_reversal ledger rows;  card (Paystack): fulfilled pending_bills (the amount Paystack charged)
--     • bill provider cost ..... airtime / data / print: written at purchase time by the clubkonnect function (finance_record_bill_cost);
--                                every other category: a configurable share of the sale (platform_config finance_provider_cost_pct, default 100 %)
--     • subscriptions .......... wallet: subscription_spend / subscription_reversal;  older card payments are ESTIMATED from the plan price
--     • card processing fees ... ESTIMATED from Paystack's published rate (platform_config paystack_fee_*)
--     • partner + marketer ..... partner_commission_records (income, once confirmed) and marketer_commissions (cost)
--   Anything a system cannot know (hosting, salaries, SMS, a Flutterwave deposit-fee statement …) is entered by finance as a MANUAL entry.
--   Entries derived from a rule rather than a provider or ledger figure are flagged estimated = true, and every report can include or exclude them.
--
-- WHO CAN SEE IT: nobody but the service role. The admin portal reads it through these functions after checking the admin's role
-- (super_admin or finance_admin). Customers, staff and every other role have no access to any of it.
--
-- CHARGEBACKS: a refund is its own negative entry linked to the sale it reverses, never an edit of the sale (the table cannot be updated or deleted).
-- Entries carry only ids, references and amounts — platform accounting records that are kept after an account is deleted.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

-- ── 1. the chart of accounts ─────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.finance_lines (
  code                 text PRIMARY KEY,
  name                 text    NOT NULL,
  section              text    NOT NULL CHECK (section IN ('revenue', 'contra_revenue', 'cost_of_sales', 'operating', 'memo')),
  stream               text    NOT NULL,                 -- wallet | bills | subscriptions | partners | payments | commissions | other
  counts_toward_profit boolean NOT NULL DEFAULT true,    -- false = shown as a memo, never in profit
  allow_manual         boolean NOT NULL DEFAULT false,   -- may finance enter this line by hand?
  sort_order           int     NOT NULL DEFAULT 100,
  description          text
);

INSERT INTO public.finance_lines (code, name, section, stream, counts_toward_profit, allow_manual, sort_order, description) VALUES
  ('wallet.transfer_fee',       'Transfer fees (to bank)',                 'revenue',        'wallet',        true,  false, 10,  'Flat fee charged on each outgoing bank transfer; credited to the platform settlement wallet.'),
  ('wallet.internal_fee',       'Wallet-to-wallet fees',                   'revenue',        'wallet',        true,  false, 11,  'Flat fee on internal wallet moves (Ajo payouts and contributions).'),
  ('bills.sales',               'Bill payments received',                  'revenue',        'bills',         true,  false, 20,  'What customers paid for airtime, data, electricity, cable, betting, exam pins, etc. (the selling price, after any coupon / cashback / points).'),
  ('subscriptions.sales',       'Subscription payments',                   'revenue',        'subscriptions', true,  false, 30,  'Plan payments: wallet (actual) and older card payments (estimated from the plan price).'),
  ('partners.commission',       'Partner commissions earned',              'revenue',        'partners',      true,  false, 40,  'Commission from partner offers, once confirmed.'),
  ('other.revenue',             'Other income (manual)',                   'revenue',        'other',         true,  true,  90,  'Income entered by finance that no system records.'),
  ('wallet.cbn_levy',           'CBN levy collected (pass-through)',       'memo',           'wallet',        false, false, 95,  'Statutory levy collected for the regulator — not KudiAI income, so kept out of profit.'),
  ('wallet.fee_refunds',        'Transfer fees refunded',                  'contra_revenue', 'wallet',        true,  false, 110, 'Fees handed back to customers.'),
  ('bills.refunds',             'Bill refunds (chargebacks)',              'contra_revenue', 'bills',         true,  false, 120, 'Bill payments returned to the customer (failed or reversed orders).'),
  ('subscriptions.refunds',     'Subscription refunds',                    'contra_revenue', 'subscriptions', true,  false, 130, 'Plan payments returned to the customer.'),
  ('bills.provider_cost',       'Bill provider cost (ClubKonnect)',        'cost_of_sales',  'bills',         true,  true,  210, 'What ClubKonnect charged us for each order, recorded at purchase; reversed when the order is refunded. Manual entries adjust it (e.g. a commission received).'),
  ('wallet.provider_fee',       'Transfer provider fee (Flutterwave)',     'cost_of_sales',  'wallet',        true,  true,  211, 'Flutterwave''s real fee on each successful transfer. Manual entries cover other Flutterwave charges (e.g. deposit fees).'),
  ('payments.processor_fee',    'Card processing fees (Paystack)',         'cost_of_sales',  'payments',      true,  true,  212, 'Estimated from Paystack''s published rate on card payments; manual entries true it up to the Paystack statement.'),
  ('other.direct_cost',         'Other direct costs (manual)',             'cost_of_sales',  'other',         true,  true,  290, 'Direct costs entered by finance.'),
  ('commissions.marketer',      'Marketer commissions',                    'operating',      'commissions',   true,  false, 310, 'Commission owed to marketers on plan sales.'),
  ('messaging.sms',             'SMS costs',                               'operating',      'other',         true,  true,  320, 'SMS spend entered by finance (the SMS provider does not report a cost per message).'),
  ('other.operating',           'Other operating costs (manual)',          'operating',      'other',         true,  true,  390, 'Hosting, salaries, tools and any other overhead entered by finance.')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, section = EXCLUDED.section, stream = EXCLUDED.stream, counts_toward_profit = EXCLUDED.counts_toward_profit,
  allow_manual = EXCLUDED.allow_manual, sort_order = EXCLUDED.sort_order, description = EXCLUDED.description;

-- settings finance can change from the admin portal (a price of a fee, a provider's commission) — all optional, sensible defaults apply
INSERT INTO public.platform_config (key, value, description) VALUES
  ('finance_provider_cost_pct',   '{}',   'Finance: share of the sale (percent) that the bill provider takes, per category, for categories without a per-order cost record — e.g. {"cable":98.5,"electricity":99}. Default 100 = no commission.'),
  ('paystack_fee_pct',            '1.5',  'Finance: Paystack card fee, percent of the charge (used to ESTIMATE processing cost).'),
  ('paystack_fee_flat',           '100',  'Finance: Paystack flat fee in naira, added at or above the threshold below.'),
  ('paystack_fee_flat_threshold', '2500', 'Finance: charges at or above this many naira also carry the flat fee.'),
  ('paystack_fee_cap',            '2000', 'Finance: Paystack fee cap in naira.')
ON CONFLICT (key) DO NOTHING;

-- ── 2. the ledger ────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.finance_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at  timestamptz NOT NULL,
  line_code    text        NOT NULL REFERENCES public.finance_lines (code),
  amount_kobo  bigint      NOT NULL,                     -- signed in the platform's favour (revenue +, refunds and costs −)
  source_type  text        NOT NULL,                     -- wallet_ledger | wallet_withdrawal | pending_bill | bill_cost | bill_cost_rate | bill_cost_reversal | subscription_row | partner_commission | marketer_commission | manual …
  source_id    text        NOT NULL,                     -- the id of the record it came from (idempotency key together with line_code + source_type)
  user_id      uuid,                                     -- the customer / business it relates to, when there is one (no foreign key: records outlive accounts)
  reference    text,                                     -- KDT-BILL-… / provider reference, for looking the order up
  category     text,                                     -- bills: airtime, data, …   subscriptions: plan   wallet: source
  estimated    boolean     NOT NULL DEFAULT false,       -- true = derived by a rule, not a provider or ledger figure
  note         text,
  meta         jsonb       NOT NULL DEFAULT '{}'::jsonb, -- meta.stream re-attributes an entry to another stream (a card fee on a bill belongs to bills)
  created_by   text        NOT NULL DEFAULT 'sync',      -- 'sync', 'clubkonnect', or the admin's username for manual entries
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (line_code, source_type, source_id)
);
CREATE INDEX IF NOT EXISTS finance_entries_occurred_idx  ON public.finance_entries (occurred_at DESC);
CREATE INDEX IF NOT EXISTS finance_entries_line_idx      ON public.finance_entries (line_code, occurred_at DESC);
CREATE INDEX IF NOT EXISTS finance_entries_reference_idx ON public.finance_entries (reference) WHERE reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.finance_sync_state (key text PRIMARY KEY, watermark timestamptz, last_run timestamptz, last_result jsonb);

-- append-only: an entry is never edited or removed — a mistake is corrected with an opposite entry
CREATE OR REPLACE FUNCTION public.finance_entries_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'finance_entries is append-only: post an opposite entry instead of changing or deleting one'; END $$;
DROP TRIGGER IF EXISTS finance_entries_no_change   ON public.finance_entries;
DROP TRIGGER IF EXISTS finance_entries_no_truncate ON public.finance_entries;
CREATE TRIGGER finance_entries_no_change   BEFORE UPDATE OR DELETE ON public.finance_entries FOR EACH ROW       EXECUTE FUNCTION public.finance_entries_immutable();
CREATE TRIGGER finance_entries_no_truncate BEFORE TRUNCATE          ON public.finance_entries FOR EACH STATEMENT EXECUTE FUNCTION public.finance_entries_immutable();

ALTER TABLE public.finance_lines      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_entries    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_sync_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.finance_lines, public.finance_entries, public.finance_sync_state FROM PUBLIC, anon, authenticated;

-- ── 3. provider cost, written by the clubkonnect function at purchase time ─────────────────────────────────────────
-- p_request_id is ClubKonnect's RequestID (KDT-BILL-…[-MTN]); it is the idempotency key, so a retried purchase records its cost once.
-- p_basis says how the cost was arrived at: provider_reported (the provider's own charged amount), wholesale_discount (face less the provider's
-- discount), provider_plan_price (the provider's list price for the plan). Only the first is not an estimate.
CREATE OR REPLACE FUNCTION public.finance_record_bill_cost(
  p_request_id text, p_cat text, p_cost_kobo bigint, p_face_kobo bigint, p_basis text, p_estimated boolean, p_user uuid, p_meta jsonb DEFAULT '{}'::jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n bigint; v_user uuid := p_user;
BEGIN
  IF COALESCE(btrim(p_request_id), '') = '' OR length(p_request_id) > 64 THEN RAISE EXCEPTION 'a request id is required'; END IF;
  IF p_cost_kobo IS NULL OR p_cost_kobo <= 0 OR p_cost_kobo > 100000000000 THEN RAISE EXCEPTION 'a plausible cost is required'; END IF;
  IF v_user IS NULL THEN
    SELECT g.user_id INTO v_user FROM public.bill_gate_claims g WHERE g.request_id = p_request_id;
  END IF;
  INSERT INTO public.finance_entries (occurred_at, line_code, amount_kobo, source_type, source_id, user_id, reference, category, estimated, note, meta, created_by)
  VALUES (now(), 'bills.provider_cost', -p_cost_kobo, 'bill_cost', p_request_id, v_user, p_request_id, lower(left(COALESCE(p_cat, 'other'), 40)), COALESCE(p_estimated, true),
          'Provider cost recorded at purchase', COALESCE(p_meta, '{}'::jsonb) || jsonb_build_object('basis', p_basis, 'face_kobo', p_face_kobo), 'clubkonnect')
  ON CONFLICT (line_code, source_type, source_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END $$;

-- ── 4. sync: turn the app's own records into entries ─────────────────────────────────────────────────────────────
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

  -- 3. what Flutterwave charged us on each successful transfer
  INSERT INTO public.finance_entries (occurred_at, line_code, amount_kobo, source_type, source_id, user_id, reference, category, note)
  SELECT COALESCE(w.updated_at, w.created_at), 'wallet.provider_fee', -w.fee_kobo, 'wallet_withdrawal', w.id::text, w.user_id, w.flw_reference, 'transfer', 'Flutterwave transfer fee'
    FROM public.wallet_withdrawals w
   WHERE w.status = 'successful' AND COALESCE(w.fee_kobo, 0) > 0 AND COALESCE(w.updated_at, w.created_at) >= v_since
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

-- ── 5. reports (a period is [p_from, p_to); day buckets are Lagos days) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finance_pl(p_from timestamptz, p_to timestamptz, p_include_estimates boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  WITH e AS (
    SELECT x.*, COALESCE(x.meta ->> 'stream', fl.stream) AS eff_stream, fl.section, fl.counts_toward_profit AS counts
      FROM public.finance_entries x JOIN public.finance_lines fl ON fl.code = x.line_code
     WHERE x.occurred_at >= p_from AND x.occurred_at < p_to AND (p_include_estimates OR NOT x.estimated)
  ), l AS (
    SELECT fl.code, fl.name, fl.section, fl.stream, fl.counts_toward_profit, fl.allow_manual, fl.sort_order, fl.description,
           COALESCE(sum(e.amount_kobo), 0)::bigint AS amount, COALESCE(sum(e.amount_kobo) FILTER (WHERE e.estimated), 0)::bigint AS est, count(e.id) AS n
      FROM public.finance_lines fl LEFT JOIN e ON e.line_code = fl.code
     GROUP BY fl.code, fl.name, fl.section, fl.stream, fl.counts_toward_profit, fl.allow_manual, fl.sort_order, fl.description
  ), t AS (
    SELECT
      COALESCE(sum(amount) FILTER (WHERE section = 'revenue'        AND counts_toward_profit), 0)::bigint AS gross_revenue,
      COALESCE(sum(amount) FILTER (WHERE section = 'contra_revenue' AND counts_toward_profit), 0)::bigint AS refunds,
      COALESCE(sum(amount) FILTER (WHERE section = 'cost_of_sales'  AND counts_toward_profit), 0)::bigint AS direct_costs,
      COALESCE(sum(amount) FILTER (WHERE section = 'operating'      AND counts_toward_profit), 0)::bigint AS operating_costs,
      COALESCE(sum(est)    FILTER (WHERE counts_toward_profit), 0)::bigint                                AS estimated_in_profit
      FROM l
  ), s AS (
    SELECT eff_stream AS stream,
      COALESCE(sum(amount_kobo) FILTER (WHERE section = 'revenue'),        0)::bigint AS revenue,
      COALESCE(sum(amount_kobo) FILTER (WHERE section = 'contra_revenue'), 0)::bigint AS refunds,
      COALESCE(sum(amount_kobo) FILTER (WHERE section = 'cost_of_sales'),  0)::bigint AS direct_costs,
      COALESCE(sum(amount_kobo) FILTER (WHERE section = 'operating'),      0)::bigint AS operating_costs
      FROM e WHERE counts GROUP BY eff_stream
  )
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to, 'include_estimates', p_include_estimates,
    'lines', (SELECT COALESCE(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'section', section, 'stream', stream, 'counts_toward_profit', counts_toward_profit, 'allow_manual', allow_manual,
                                                          'amount_kobo', amount, 'estimated_kobo', est, 'entries', n, 'description', description) ORDER BY sort_order), '[]'::jsonb) FROM l),
    'totals', (SELECT jsonb_build_object('gross_revenue_kobo', gross_revenue, 'refunds_kobo', refunds, 'net_revenue_kobo', gross_revenue + refunds,
                                         'direct_costs_kobo', direct_costs, 'gross_profit_kobo', gross_revenue + refunds + direct_costs,
                                         'operating_costs_kobo', operating_costs, 'net_profit_kobo', gross_revenue + refunds + direct_costs + operating_costs,
                                         'estimated_in_profit_kobo', estimated_in_profit,
                                         'net_margin_pct', CASE WHEN gross_revenue + refunds > 0 THEN round((gross_revenue + refunds + direct_costs + operating_costs) * 100.0 / (gross_revenue + refunds), 2) END) FROM t),
    'by_stream', (SELECT COALESCE(jsonb_agg(jsonb_build_object('stream', stream, 'revenue_kobo', revenue, 'refunds_kobo', refunds, 'direct_costs_kobo', direct_costs,
                                                               'operating_costs_kobo', operating_costs, 'profit_kobo', revenue + refunds + direct_costs + operating_costs) ORDER BY stream), '[]'::jsonb) FROM s)
  ) INTO v;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.finance_daily(p_from timestamptz, p_to timestamptz, p_include_estimates boolean DEFAULT true)
RETURNS TABLE (day date, revenue_kobo bigint, refunds_kobo bigint, costs_kobo bigint, profit_kobo bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT (e.occurred_at AT TIME ZONE 'Africa/Lagos')::date,
         COALESCE(sum(e.amount_kobo) FILTER (WHERE l.section = 'revenue'), 0)::bigint,
         COALESCE(sum(e.amount_kobo) FILTER (WHERE l.section = 'contra_revenue'), 0)::bigint,
         COALESCE(sum(e.amount_kobo) FILTER (WHERE l.section IN ('cost_of_sales', 'operating')), 0)::bigint,
         COALESCE(sum(e.amount_kobo), 0)::bigint
    FROM public.finance_entries e JOIN public.finance_lines l ON l.code = e.line_code
   WHERE l.counts_toward_profit AND e.occurred_at >= p_from AND e.occurred_at < p_to AND (p_include_estimates OR NOT e.estimated)
   GROUP BY 1 ORDER BY 1;
$$;

-- one stream by category: bills → airtime / data / …, subscriptions → by plan, wallet → by fee type. orders = number of sales; costed = orders with a recorded cost.
CREATE OR REPLACE FUNCTION public.finance_breakdown(p_from timestamptz, p_to timestamptz, p_stream text, p_include_estimates boolean DEFAULT true)
RETURNS TABLE (category text, orders bigint, revenue_kobo bigint, refunds_kobo bigint, costs_kobo bigint, net_kobo bigint, costed_orders bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(NULLIF(e.category, ''), 'other'),
         count(*) FILTER (WHERE l.section = 'revenue'),
         COALESCE(sum(e.amount_kobo) FILTER (WHERE l.section = 'revenue'), 0)::bigint,
         COALESCE(sum(e.amount_kobo) FILTER (WHERE l.section = 'contra_revenue'), 0)::bigint,
         COALESCE(sum(e.amount_kobo) FILTER (WHERE l.section IN ('cost_of_sales', 'operating')), 0)::bigint,
         COALESCE(sum(e.amount_kobo), 0)::bigint,
         count(*) FILTER (WHERE e.line_code = 'bills.provider_cost' AND e.source_type = 'bill_cost')
    FROM public.finance_entries e JOIN public.finance_lines l ON l.code = e.line_code
   WHERE l.counts_toward_profit AND COALESCE(e.meta ->> 'stream', l.stream) = p_stream
     AND e.occurred_at >= p_from AND e.occurred_at < p_to AND (p_include_estimates OR NOT e.estimated)
   GROUP BY 1 ORDER BY 3 DESC, 1;
$$;

-- the ledger itself, newest first, for drill-down and CSV export
CREATE OR REPLACE FUNCTION public.finance_entries_page(
  p_from timestamptz, p_to timestamptz, p_line text DEFAULT NULL, p_search text DEFAULT NULL, p_include_estimates boolean DEFAULT true,
  p_limit int DEFAULT 100, p_offset int DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb; v_total bigint; v_search text := NULLIF(btrim(COALESCE(p_search, '')), '');
BEGIN
  SELECT count(*) INTO v_total FROM public.finance_entries e
   WHERE e.occurred_at >= p_from AND e.occurred_at < p_to AND (p_include_estimates OR NOT e.estimated)
     AND (p_line IS NULL OR e.line_code = p_line)
     AND (v_search IS NULL OR e.reference ILIKE '%' || v_search || '%' OR e.note ILIKE '%' || v_search || '%' OR e.category ILIKE '%' || v_search || '%');
  SELECT COALESCE(jsonb_agg(q.r ORDER BY q.ord DESC, q.rid), '[]'::jsonb) INTO v FROM (
    SELECT e.occurred_at AS ord, e.id AS rid,
           jsonb_build_object('id', e.id, 'occurred_at', e.occurred_at, 'line_code', e.line_code, 'line_name', l.name, 'section', l.section, 'amount_kobo', e.amount_kobo,
                              'source_type', e.source_type, 'reference', e.reference, 'category', e.category, 'estimated', e.estimated, 'note', e.note,
                              'created_by', e.created_by, 'user_id', e.user_id) AS r
      FROM public.finance_entries e JOIN public.finance_lines l ON l.code = e.line_code
     WHERE e.occurred_at >= p_from AND e.occurred_at < p_to AND (p_include_estimates OR NOT e.estimated)
       AND (p_line IS NULL OR e.line_code = p_line)
       AND (v_search IS NULL OR e.reference ILIKE '%' || v_search || '%' OR e.note ILIKE '%' || v_search || '%' OR e.category ILIKE '%' || v_search || '%')
     ORDER BY e.occurred_at DESC, e.id LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 5000) OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  ) q;
  RETURN jsonb_build_object('total', v_total, 'rows', v);
END $$;

-- health: is the picture complete and does it tie back to the wallet?
CREATE OR REPLACE FUNCTION public.finance_health() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  SETTLEMENT constant uuid := '00000000-0000-0000-0000-000000000001';
  v jsonb; v_cap_sales numeric; v_cap_costed numeric; v_first_cost timestamptz;
BEGIN
  -- of the sales in categories that get a per-order cost at purchase (airtime / data / print), how much has one?
  SELECT COALESCE(sum(s.amount_kobo), 0), COALESCE(sum(s.amount_kobo) FILTER (WHERE EXISTS (
           SELECT 1 FROM public.finance_entries c WHERE c.line_code = 'bills.provider_cost' AND c.source_type = 'bill_cost'
              AND regexp_replace(COALESCE(c.reference, ''), '-(MTN|AIR|9MB|GLO)$', '') = s.reference)), 0)
    INTO v_cap_sales, v_cap_costed
    FROM public.finance_entries s
   WHERE s.line_code = 'bills.sales' AND s.category IN ('airtime', 'data', 'print-airtime', 'print-data') AND s.reference IS NOT NULL;
  SELECT min(occurred_at) INTO v_first_cost FROM public.finance_entries WHERE line_code = 'bills.provider_cost' AND source_type = 'bill_cost';
  SELECT jsonb_build_object(
    'last_sync', (SELECT last_run FROM public.finance_sync_state WHERE key = 'main'),
    'last_sync_result', (SELECT last_result FROM public.finance_sync_state WHERE key = 'main'),
    'entries', (SELECT count(*) FROM public.finance_entries),
    'estimated_entries', (SELECT count(*) FROM public.finance_entries WHERE estimated),
    'oldest_entry', (SELECT min(occurred_at) FROM public.finance_entries),
    'costed_categories_sales_kobo', v_cap_sales,
    'costed_categories_with_cost_kobo', v_cap_costed,
    'cost_coverage_pct', CASE WHEN v_cap_sales > 0 THEN round(v_cap_costed * 100 / v_cap_sales, 1) END,
    'provider_cost_recorded_since', v_first_cost,
    'unsettled_bill_debits', (SELECT count(*) FROM public.wallet_ledger WHERE source = 'bill_spend' AND status = 'pending' AND created_at < now() - interval '30 minutes'),
    'unsettled_bill_debits_kobo', (SELECT COALESCE(sum(amount_kobo), 0) FROM public.wallet_ledger WHERE source = 'bill_spend' AND status = 'pending' AND created_at < now() - interval '30 minutes'),
    'settlement_wallet_balance_kobo', (SELECT COALESCE(balance_kobo, 0) FROM public.wallets WHERE user_id = SETTLEMENT),
    'settlement_credits_kobo', (SELECT COALESCE(sum(amount_kobo), 0) FROM public.wallet_ledger WHERE user_id = SETTLEMENT AND direction = 'credit' AND status = 'completed'),
    'settlement_debits_kobo',  (SELECT COALESCE(sum(amount_kobo), 0) FROM public.wallet_ledger WHERE user_id = SETTLEMENT AND direction = 'debit'  AND status = 'completed'),
    'fee_income_recorded_kobo', (SELECT COALESCE(sum(amount_kobo), 0) FROM public.finance_entries WHERE line_code IN ('wallet.transfer_fee', 'wallet.internal_fee', 'wallet.cbn_levy'))
  ) INTO v;
  RETURN v;
END $$;

-- money that is not profit but finance needs beside it: what we owe customers, and discounts given
CREATE OR REPLACE FUNCTION public.finance_memo(p_from timestamptz, p_to timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE SETTLEMENT constant uuid := '00000000-0000-0000-0000-000000000001'; v jsonb;
BEGIN
  SELECT jsonb_build_object(
    'customer_wallet_float_kobo', (SELECT COALESCE(sum(balance_kobo), 0) FROM public.wallets WHERE user_id <> SETTLEMENT),
    'settlement_wallet_kobo',     (SELECT COALESCE(balance_kobo, 0) FROM public.wallets WHERE user_id = SETTLEMENT),
    -- balance corrections an admin applied to customer wallets: not classified as profit or loss here (a credit may repair a missed deposit — no cost —
    -- or be goodwill — a cost), so finance sees them and records a manual cost where one was real
    'adjustment_credits_kobo',    (SELECT COALESCE(sum(amount_kobo), 0) FROM public.wallet_ledger WHERE source = 'adjustment' AND direction = 'credit' AND status = 'completed' AND user_id <> SETTLEMENT AND created_at >= p_from AND created_at < p_to),
    'adjustment_debits_kobo',     (SELECT COALESCE(sum(amount_kobo), 0) FROM public.wallet_ledger WHERE source = 'adjustment' AND direction = 'debit'  AND status = 'completed' AND user_id <> SETTLEMENT AND created_at >= p_from AND created_at < p_to),
    'bill_coupon_discounts_kobo', (SELECT COALESCE(round(sum(discount_amount) * 100), 0)::bigint FROM public.coupon_redemptions WHERE plan_slug = 'bills' AND redeemed_at >= p_from AND redeemed_at < p_to),
    'plan_coupon_discounts_kobo', (SELECT COALESCE(round(sum(discount_amount) * 100), 0)::bigint FROM public.coupon_redemptions WHERE plan_slug <> 'bills' AND redeemed_at >= p_from AND redeemed_at < p_to),
    'coupon_redemptions',         (SELECT count(*) FROM public.coupon_redemptions WHERE redeemed_at >= p_from AND redeemed_at < p_to),
    'cashback_outstanding_kobo',  (SELECT COALESCE(round(sum(CASE WHEN type = 'earned' THEN amount WHEN type = 'redeemed' THEN -amount ELSE 0 END) * 100), 0)::bigint FROM public.cashback_transactions),
    'reward_points_outstanding',  (SELECT COALESCE(sum(points), 0) FROM public.reward_points_log)
  ) INTO v;
  RETURN v;
END $$;

-- ── 6. manual entries (finance) ──────────────────────────────────────────────────────────────────────────────────
-- p_amount_kobo is the EFFECT ON PROFIT: income or a credit is positive, a cost is negative. A mistake is fixed by voiding, never by editing.
CREATE OR REPLACE FUNCTION public.finance_add_manual(p_line text, p_amount_kobo bigint, p_occurred timestamptz, p_note text, p_admin text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE l public.finance_lines; v_id uuid := gen_random_uuid();
BEGIN
  SELECT * INTO l FROM public.finance_lines WHERE code = p_line AND allow_manual;
  IF NOT FOUND THEN RAISE EXCEPTION 'finance line % does not accept manual entries', p_line; END IF;
  IF p_amount_kobo IS NULL OR p_amount_kobo = 0 OR abs(p_amount_kobo) > 100000000000000 THEN RAISE EXCEPTION 'a non-zero, plausible amount is required'; END IF;
  IF COALESCE(btrim(p_note), '') = '' THEN RAISE EXCEPTION 'a note is required for the audit trail'; END IF;
  INSERT INTO public.finance_entries (id, occurred_at, line_code, amount_kobo, source_type, source_id, category, note, created_by)
  VALUES (v_id, LEAST(COALESCE(p_occurred, now()), now() + interval '1 day'), p_line, p_amount_kobo, 'manual', v_id::text, 'manual', left(p_note, 500), left(COALESCE(NULLIF(btrim(p_admin), ''), 'admin'), 80));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.finance_void_manual(p_entry_id uuid, p_admin text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE e public.finance_entries; v_id uuid := gen_random_uuid();
BEGIN
  SELECT * INTO e FROM public.finance_entries WHERE id = p_entry_id AND source_type = 'manual';
  IF NOT FOUND THEN RAISE EXCEPTION 'manual entry not found'; END IF;
  IF EXISTS (SELECT 1 FROM public.finance_entries WHERE source_type = 'manual_void' AND source_id = e.id::text) THEN RAISE EXCEPTION 'already voided'; END IF;
  INSERT INTO public.finance_entries (id, occurred_at, line_code, amount_kobo, source_type, source_id, category, note, created_by)
  VALUES (v_id, now(), e.line_code, -e.amount_kobo, 'manual_void', e.id::text, 'manual', left('Voids ' || e.id::text || ' (' || COALESCE(e.note, '') || ')', 500), left(COALESCE(NULLIF(btrim(p_admin), ''), 'admin'), 80));
  RETURN v_id;
END $$;

-- ── 7. lock everything to the service role ──────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION
  public.finance_sync(boolean), public.finance_record_bill_cost(text, text, bigint, bigint, text, boolean, uuid, jsonb),
  public.finance_pl(timestamptz, timestamptz, boolean), public.finance_daily(timestamptz, timestamptz, boolean),
  public.finance_breakdown(timestamptz, timestamptz, text, boolean), public.finance_entries_page(timestamptz, timestamptz, text, text, boolean, int, int),
  public.finance_health(), public.finance_memo(timestamptz, timestamptz),
  public.finance_add_manual(text, bigint, timestamptz, text, text), public.finance_void_manual(uuid, text), public.finance_entries_immutable()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.finance_sync(boolean), public.finance_record_bill_cost(text, text, bigint, bigint, text, boolean, uuid, jsonb),
  public.finance_pl(timestamptz, timestamptz, boolean), public.finance_daily(timestamptz, timestamptz, boolean),
  public.finance_breakdown(timestamptz, timestamptz, text, boolean), public.finance_entries_page(timestamptz, timestamptz, text, text, boolean, int, int),
  public.finance_health(), public.finance_memo(timestamptz, timestamptz),
  public.finance_add_manual(text, bigint, timestamptz, text, text), public.finance_void_manual(uuid, text)
  TO service_role;

-- ── 8. keep it current: every 10 minutes, and once now to backfill history ──────────────────────────────────────
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'finance-sync';
  PERFORM cron.schedule('finance-sync', '*/10 * * * *', 'SELECT public.finance_sync()');
  RAISE NOTICE 'finance | sync scheduled every 10 minutes';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'finance | could not schedule (pg_cron unavailable?): %', SQLERRM; END $$;

DO $$
BEGIN
  PERFORM public.finance_sync(true);
  RAISE NOTICE 'finance | backfill done';
END $$;

-- ── 9. self-test (rolled back): a rerun adds nothing, manual entries land and void cleanly, totals reconcile, the table cannot be changed ─────
DO $$
DECLARE
  v_before bigint; v_after bigint; v_id uuid; v_pl jsonb; v_sum bigint; v_err text; v_void uuid;
  v_from timestamptz := now() - interval '1 hour'; v_to timestamptz := now() + interval '2 days';
BEGIN
  -- idempotent: the sync that just ran, run again, inserts nothing
  SELECT count(*) INTO v_before FROM public.finance_entries;
  PERFORM public.finance_sync(true);
  SELECT count(*) INTO v_after FROM public.finance_entries;
  IF v_after <> v_before THEN RAISE EXCEPTION 'finance self-test: a second sync added % entries (must add none)', v_after - v_before; END IF;

  -- a manual cost lowers profit by exactly its amount, and the report agrees with the ledger
  SELECT COALESCE(sum(e.amount_kobo), 0) INTO v_sum FROM public.finance_entries e JOIN public.finance_lines l ON l.code = e.line_code
   WHERE l.counts_toward_profit AND e.occurred_at >= v_from AND e.occurred_at < v_to;
  v_id := public.finance_add_manual('other.operating', -123456, now(), 'self-test hosting', 'selftest');
  v_pl := public.finance_pl(v_from, v_to, true);
  IF (v_pl -> 'totals' ->> 'net_profit_kobo')::bigint <> v_sum - 123456 THEN
    RAISE EXCEPTION 'finance self-test: net profit % does not equal ledger sum % less 123456', v_pl -> 'totals' ->> 'net_profit_kobo', v_sum;
  END IF;
  -- voiding it restores profit; voiding twice is refused
  v_void := public.finance_void_manual(v_id, 'selftest');
  v_pl := public.finance_pl(v_from, v_to, true);
  IF (v_pl -> 'totals' ->> 'net_profit_kobo')::bigint <> v_sum THEN RAISE EXCEPTION 'finance self-test: void did not restore profit'; END IF;
  BEGIN PERFORM public.finance_void_manual(v_id, 'selftest'); RAISE EXCEPTION 'finance self-test: a second void was accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'finance self-test%' THEN RAISE; END IF; END;
  -- a line that is not manual is refused
  BEGIN PERFORM public.finance_add_manual('bills.sales', 100, now(), 'x', 'selftest'); RAISE EXCEPTION 'finance self-test: a system line accepted a manual entry';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'finance self-test%' THEN RAISE; END IF; END;
  -- the ledger cannot be edited or emptied
  BEGIN UPDATE public.finance_entries SET amount_kobo = 1 WHERE id = v_id; RAISE EXCEPTION 'finance self-test: an entry was updated';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'finance self-test%' THEN RAISE; END IF; END;
  BEGIN DELETE FROM public.finance_entries WHERE id = v_id; RAISE EXCEPTION 'finance self-test: an entry was deleted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'finance self-test%' THEN RAISE; END IF; END;
  -- a purchase-time cost is recorded once, however often it is sent
  IF NOT public.finance_record_bill_cost('KDT-BILL-SELFTEST01', 'airtime', 9700, 10000, 'wholesale_discount', true, NULL) THEN RAISE EXCEPTION 'finance self-test: first cost not recorded'; END IF;
  IF public.finance_record_bill_cost('KDT-BILL-SELFTEST01', 'airtime', 9700, 10000, 'wholesale_discount', true, NULL) THEN RAISE EXCEPTION 'finance self-test: a repeated cost was recorded twice'; END IF;
  -- undo everything the test did (the table is append-only, so the whole block is rolled back with a sentinel error)
  RAISE EXCEPTION 'finance self-test passed (rolled back)';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
  IF v_err NOT LIKE 'finance self-test passed%' THEN RAISE; END IF;
  RAISE NOTICE 'finance | self-test passed';
END $$;
