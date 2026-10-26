// Run (from the repo root, with @electric-sql/pglite@0.2.17 installed):
//   node tests/finance/bills-account.pglite.mjs
// Real-Postgres (PGlite) test of the Bills account (migration 20270428000000) on top of the real finance ledger migrations:
// an order's estimated provider cost is never booked next to its real cost (and is cancelled when the real cost comes later),
// refunds reverse only the cost that still counts, a rerun books nothing, the report adds up, and each provider wallet is
// checked (opening + top-ups − closing = spent, against the recorded cost). Top-ups can only be voided, never changed.
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";

const db = new PGlite();
let fails = 0, passes = 0;
const ok = (cond, msg, x = "") => { if (cond) { passes++; console.log("  ✓", msg); } else { fails++; console.log("  ✗", msg, x); } };
const q = async (sql, p) => (await db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];
const J = (x) => JSON.stringify(x);

await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA cron; CREATE TABLE cron.job (jobid serial, jobname text);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS int LANGUAGE sql AS $$ INSERT INTO cron.job(jobname) VALUES (n) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(n text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname = n RETURNING true $$;
CREATE FUNCTION cron.unschedule(n int) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid = n RETURNING true $$;
CREATE TABLE platform_config (key text PRIMARY KEY, value text, description text);
CREATE TABLE wallets (user_id uuid, balance_kobo bigint);
CREATE TABLE wallet_ledger (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), wallet_id uuid, user_id uuid, direction text, amount_kobo bigint, balance_after_kobo bigint,
  source text, status text, reference text, related_txn_id uuid, narration text, meta jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), category text);
CREATE TABLE bill_gate_claims (request_id text, base_ref text, user_id uuid, cat text, created_at timestamptz DEFAULT now());
CREATE TABLE pending_bills (reference text, user_id uuid, status text, paid_amount numeric, fulfilled_at timestamptz, created_at timestamptz DEFAULT now(), fulfillment jsonb, cat text);
CREATE TABLE wallet_withdrawals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, status text, amount_kobo bigint, fee_kobo bigint, flw_reference text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz);
CREATE TABLE subscription_plans (slug text PRIMARY KEY, name text, price_monthly numeric, price_yearly numeric);
CREATE TABLE subscriptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, plan text, billing_cycle text, paystack_reference text, wallet_ledger_id uuid, created_at timestamptz DEFAULT now());
CREATE TABLE coupon_redemptions (paystack_reference text, final_amount numeric, discount_amount numeric, plan_slug text, redeemed_at timestamptz DEFAULT now());
CREATE TABLE partner_commission_records (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text, amount_kobo bigint, confirmed_at timestamptz, paid_at timestamptz,
  created_at timestamptz DEFAULT now(), audience_segment text, notes text);
CREATE TABLE marketer_commissions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), amount numeric, status text, created_at timestamptz DEFAULT now(), business_id uuid,
  reference text, event_type text, type text, notes text);
CREATE TABLE cashback_transactions (type text, amount numeric);
CREATE TABLE reward_points_log (points int);
`);
const mig = (f) => fs.readFileSync(`supabase/migrations/${f}`, "utf8");
await db.exec(mig("20270223000000_finance_ledger.sql"));
await db.exec(mig("20270224000000_finance_flw_fee_estimate.sql"));

const U = "11111111-1111-4111-8111-111111111111";
const ago = (min) => `now() - interval '${min} minutes'`;
const sale = async (ref, cat, kobo, min) => {
  const id = (await one(`INSERT INTO wallet_ledger (user_id, direction, amount_kobo, source, status, reference, narration, created_at)
    VALUES ($1, 'debit', $2, 'bill_spend', 'completed', $3, 'bill', ${ago(min)}) RETURNING id`, [U, kobo, ref])).id;
  await q(`INSERT INTO bill_gate_claims (request_id, base_ref, user_id, cat) VALUES ($1, $1, $2, $3)`, [ref, U, cat]);
  return id;
};
const refund = async (ref, saleId, kobo, min) => {
  await q(`UPDATE wallet_ledger SET status = 'reversed' WHERE id = $1`, [saleId]);
  await q(`INSERT INTO wallet_ledger (user_id, direction, amount_kobo, source, status, reference, narration, meta, created_at)
    VALUES ($1, 'credit', $2, 'bill_reversal', 'completed', $3, 'refund', jsonb_build_object('reversed_ledger_id', $4::text), ${ago(min)})`, [U, kobo, ref, saleId]);
};
const cost = (ref, cat, kobo, provider, estimated = true) =>
  one(`SELECT public.finance_record_bill_cost($1, $2, $3, $3, 'provider_plan_price', $4, NULL, $5::jsonb) AS r`, [ref, cat, kobo, estimated, J(provider ? { provider } : {})]);
const costOf = async (ref) => Number((await one(`SELECT COALESCE(sum(amount_kobo), 0) AS s FROM finance_entries WHERE line_code = 'bills.provider_cost'
  AND regexp_replace(COALESCE(reference, ''), '-(MTN|AIR|9MB|GLO)$', '') = $1`, [ref])).s);
const sync = async () => (await one(`SELECT public.finance_sync(false) AS r`)).r;

// ── the situation before the fix: a Bigisub electricity order costed twice by the OLD sync ──
await sale("KDT-BILL-E1000001", "electricity", 1_000_000, 120);
await cost("KDT-BILL-E1000001", "electricity", 1_010_000, "bigisub", false);
await sync();
ok(await costOf("KDT-BILL-E1000001") === -2_010_000, "old sync: the Bigisub electricity order is costed twice (real + 100 % estimate) — the bug", await costOf("KDT-BILL-E1000001"));

// an estimate booked before its order's real cost (old sync too), and a refunded order with only an estimate
await sale("KDT-BILL-E3000001", "electricity", 500_000, 90);
const b2 = await sale("KDT-BILL-B2000001", "betting", 300_000, 200);
await sync();
await refund("KDT-BILL-B2000001", b2, 300_000, 150);
await sync();
ok(await costOf("KDT-BILL-B2000001") === 0, "old sync: refunded betting order — its estimate reversed", await costOf("KDT-BILL-B2000001"));
// a refunded Bigisub order the OLD sync reversed: its reversal doesn't say which provider (the report must look it up)
const e5 = await sale("KDT-BILL-E5000001", "electricity", 300_000, 150);
await cost("KDT-BILL-E5000001", "electricity", 303_000, "bigisub", false);
await refund("KDT-BILL-E5000001", e5, 300_000, 140);
await sync();
ok(await costOf("KDT-BILL-E5000001") === 0 && (await one(`SELECT meta FROM finance_entries WHERE source_type = 'bill_cost_reversal' AND reference = 'KDT-BILL-E5000001'`)).meta?.provider === undefined,
  "old sync: refunded Bigisub order reversed, the reversal not naming its provider");

// ── the migration ──
const notices = [];
db.onNotice?.((n) => notices.push(n.message));
await db.exec(mig("20270428000000_bills_account.sql"));
ok(await costOf("KDT-BILL-E1000001") === -1_010_000, "migration: the double-counted order now costs only its real ₦10,100", await costOf("KDT-BILL-E1000001"));
ok(Number((await one(`SELECT count(*) AS n FROM finance_entries WHERE source_type = 'bill_cost_rate_void'`)).n) === 1, "…by one cancelling entry (nothing edited or deleted)");
ok((await q(`SELECT jobname FROM cron.job WHERE jobname = 'provider-balance-snapshot'`)).length === 1, "provider wallet snapshot scheduled");
ok((await one(`SELECT name FROM finance_lines WHERE code = 'bills.provider_cost'`)).name === "Bill provider cost", "the cost line is every provider's now");

// the real cost of E3 arrives after its estimate → cancelled
await cost("KDT-BILL-E3000001", "electricity", 505_000, "bigisub", false);
await sync();
ok(await costOf("KDT-BILL-E3000001") === -505_000, "an estimate booked before the real cost is cancelled when the real cost arrives", await costOf("KDT-BILL-E3000001"));

// ── new rules ──
await sale("KDT-BILL-C1000001", "cable", 1_600_000, 60);           // admin price ₦16,000
await cost("KDT-BILL-C1000001", "cable", 1_570_000, null, true);   // ClubKonnect list price ₦15,700
await sale("KDT-BILL-B1000001", "betting", 500_000, 60);           // no per-order cost
await sale("KDT-BILL-E2000001", "electricity", 200_000, 5);        // 5 minutes old, cost not in yet
await sale("KDT-BILL-A1000001", "airtime", 100_000, 60);           // airtime with no cost recorded (uncosted)
await sync();
ok(await costOf("KDT-BILL-C1000001") === -1_570_000, "cable with its list price: no estimate on top (profit ₦300 is visible)", await costOf("KDT-BILL-C1000001"));
ok(Number((await one(`SELECT count(*) AS n FROM finance_entries WHERE source_type IN ('bill_cost_rate', 'bill_cost_rate_void') AND reference = 'KDT-BILL-C1000001'`)).n) === 0,
  "…not even one booked and then cancelled: an order with its real cost never gets an estimate");
ok(await costOf("KDT-BILL-B1000001") === -500_000, "betting with no per-order cost: the configured share (100 %) is booked", await costOf("KDT-BILL-B1000001"));
ok(await costOf("KDT-BILL-E2000001") === 0, "a sale under 30 minutes old gets no estimate yet (its real cost is seconds away)", await costOf("KDT-BILL-E2000001"));
await cost("KDT-BILL-E2000001", "electricity", 210_000, "bigisub", false);
// age the sale past 30 minutes (test only: the ledger is append-only, so its guard is lifted for this one change)
await db.exec(`ALTER TABLE finance_entries DISABLE TRIGGER finance_entries_no_change;
  UPDATE finance_entries SET occurred_at = now() - interval '45 minutes' WHERE line_code = 'bills.sales' AND reference = 'KDT-BILL-E2000001';
  ALTER TABLE finance_entries ENABLE TRIGGER finance_entries_no_change;`);
await sync();
ok(await costOf("KDT-BILL-E2000001") === -210_000, "…and once its real cost is in, it never gets one", await costOf("KDT-BILL-E2000001"));

// refunds: only the cost that still counts is reversed
const r1 = (await one(`SELECT id FROM wallet_ledger WHERE reference = 'KDT-BILL-C1000001' AND source = 'bill_spend'`)).id;
await refund("KDT-BILL-C1000001", r1, 1_600_000, 1);
const e3 = (await one(`SELECT id FROM wallet_ledger WHERE reference = 'KDT-BILL-E3000001' AND source = 'bill_spend'`)).id;
await refund("KDT-BILL-E3000001", e3, 500_000, 1);                 // its estimate was cancelled; only the real cost is reversed
await sync();
ok(await costOf("KDT-BILL-C1000001") === 0, "refunded cable order: its list-price cost comes back", await costOf("KDT-BILL-C1000001"));
ok(await costOf("KDT-BILL-E3000001") === 0, "refunded order whose estimate was cancelled: net cost 0 (the estimate isn't reversed a second time)", await costOf("KDT-BILL-E3000001"));

// estimate reversed by a refund FIRST, the real cost arriving afterwards: still 0, not a phantom credit
const e4 = await sale("KDT-BILL-E4000001", "electricity", 400_000, 100);
await sync();
await refund("KDT-BILL-E4000001", e4, 400_000, 50);
await sync();
await cost("KDT-BILL-E4000001", "electricity", 404_000, "bigisub", false);
await sync();
ok(await costOf("KDT-BILL-E4000001") === 0, "refund reversed the estimate, then a late real cost: it is reversed too, net 0 (never cancelled twice)", await costOf("KDT-BILL-E4000001"));

const before = Number((await one(`SELECT count(*) AS n FROM finance_entries`)).n);
await sync(); await sync();
ok(Number((await one(`SELECT count(*) AS n FROM finance_entries`)).n) === before, "running the sync again books nothing");
const full = (await one(`SELECT public.finance_sync(true) AS r`)).r;
ok(Number((await one(`SELECT count(*) AS n FROM finance_entries`)).n) === before, "a full re-sync books nothing either", J(full));

// ── provider wallets + top-ups ──
await q(`INSERT INTO bill_provider_balances (provider, balance_kobo, observed_at) VALUES
  ('clubkonnect', 10000000, ${ago(400)}), ('clubkonnect', 9000000, ${ago(240)}), ('clubkonnect', 12930000, ${ago(10)}),
  ('bigisub', 5000000, ${ago(400)}), ('bigisub', 2000000, ${ago(10)})`);
await q(`INSERT INTO bill_provider_topups (provider, amount_kobo, paid_at, note, created_by) VALUES
  ('clubkonnect', 5000000, ${ago(200)}, 'bank transfer', 'finance1'), ('clubkonnect', 999, ${ago(100)}, 'typo', 'finance1')`);
const typo = (await one(`SELECT id FROM bill_provider_topups WHERE amount_kobo = 999`)).id;
let err = null;
try { await q(`UPDATE bill_provider_topups SET amount_kobo = 1000 WHERE id = $1`, [typo]); } catch (e) { err = e.message; }
ok(/only be voided/.test(err ?? ""), "a top-up can't be changed", err);
err = null; try { await q(`DELETE FROM bill_provider_topups WHERE id = $1`, [typo]); } catch (e) { err = e.message; }
ok(/never deleted/.test(err ?? ""), "a top-up can't be deleted", err);
await q(`UPDATE bill_provider_topups SET voided_at = now(), voided_by = 'finance1' WHERE id = $1`, [typo]);
err = null; try { await q(`UPDATE bill_provider_topups SET voided_at = now(), voided_by = 'x' WHERE id = $1`, [typo]); } catch (e) { err = e.message; }
ok(/already void/.test(err ?? ""), "…only voided, once", err);

// ── the report ──
const rep = (await one(`SELECT public.finance_bills_report(now() - interval '7 hours', now()) AS r`)).r;
const t = rep.totals;
const sum = Number((await one(`SELECT COALESCE(sum(amount_kobo), 0) AS s FROM finance_entries WHERE occurred_at >= now() - interval '7 hours'
  AND (line_code IN ('bills.sales', 'bills.refunds', 'bills.provider_cost') OR (line_code = 'payments.processor_fee' AND meta ->> 'stream' = 'bills'))`)).s);
ok(Number(t.profit_kobo) === sum && Number(t.profit_kobo) === Number(t.sales_kobo) + Number(t.refunds_kobo) + Number(t.cost_kobo) + Number(t.card_fees_kobo),
  "report: profit = sales − refunds − provider cost − card fees, and equals the ledger", J(t));
const svc = Object.fromEntries(rep.by_service.map((s) => [s.service, s]));
ok(Number(svc.cable.sales_kobo) === 1_600_000 && Number(svc.cable.refunds_kobo) === -1_600_000 && Number(svc.cable.cost_kobo) === 0, "report by service: cable sold, refunded, cost back to 0", J(svc.cable));
ok(Number(svc.betting.cost_estimated_kobo) === Number(svc.betting.cost_kobo) && Number(svc.betting.cost_kobo) < 0, "report: betting's cost is shown as estimated", J(svc.betting));
const prov = Object.fromEntries(rep.by_provider.map((p) => [p.provider, p]));
ok(prov.bigisub && Number(prov.bigisub.cost_kobo) === -(1_010_000 + 210_000) && prov.clubkonnect,
  "report by provider: Bigisub = its two kept orders only — refunds (old ones too) count against the provider of their order", J(rep.by_provider));
ok(rep.uncosted.orders === 1 && Number(rep.uncosted.sales_kobo) === 100_000, "report: the airtime sale with no cost is flagged (its profit is overstated)", J(rep.uncosted));
ok(rep.daily.length >= 1 && rep.daily.reduce((a, d) => a + Number(d.profit_kobo), 0) === Number(t.profit_kobo), "report: days add up to the total", J(rep.daily));

const ck = rep.wallets.find((w) => w.provider === "clubkonnect"), bg = rep.wallets.find((w) => w.provider === "bigisub");
const ckCost = Number((await one(`SELECT COALESCE(-sum(e.amount_kobo), 0) AS s FROM finance_entries e WHERE e.line_code = 'bills.provider_cost'
  AND e.occurred_at >= now() - interval '400 minutes' AND e.occurred_at < now() - interval '10 minutes'
  AND COALESCE(e.meta ->> 'provider', (SELECT x.meta ->> 'provider' FROM finance_entries x WHERE x.line_code = 'bills.provider_cost'
       AND x.source_type || ':' || x.source_id = CASE WHEN e.source_type = 'bill_cost_rate_void' THEN 'bill_cost_rate:' || e.source_id ELSE e.source_id END LIMIT 1), 'clubkonnect') = 'clubkonnect'`)).s);
ok(Number(ck.opening_kobo) === 10_000_000 && Number(ck.closing_kobo) === 12_930_000 && Number(ck.topups_kobo) === 5_000_000,
  "ClubKonnect wallet: opening, closing and top-ups (the voided ₦9.99 left out)", J(ck));
ok(Number(ck.spent_kobo) === 2_070_000 && Number(ck.recorded_cost_kobo) === ckCost && Number(ck.difference_kobo) === 2_070_000 - ckCost,
  "ClubKonnect wallet: spent = opening + top-ups − closing, checked against the cost our records show", J({ ck, ckCost }));
ok(Number(bg.spent_kobo) === 3_000_000 && bg.latest_kobo !== undefined, "Bigisub wallet checked the same way", J(bg));
ok(rep.topups.length === 2 && rep.topups.some((x) => x.voided_by === "finance1"), "the period's top-ups are listed, the void shown", J(rep.topups));
const empty = (await one(`SELECT public.finance_bills_report(now() - interval '400 days', now() - interval '399 days') AS r`)).r;
ok(Number(empty.totals.sales_kobo) === 0 && empty.wallets[0].spent_kobo === null, "a period with nothing in it: zeros, wallets not guessed", J(empty.wallets[0]));
err = null; try { await q(`SELECT public.finance_bills_report(now(), now() - interval '1 day')`); } catch (e) { err = e.message; }
ok(/valid period/.test(err ?? ""), "a backwards period is refused", err);

// ── who may read it ──
for (const role of ["anon", "authenticated"]) {
  await q(`SET ROLE ${role}`);
  let e1 = null, e2 = null, e3 = null;
  try { await q(`SELECT public.finance_bills_report(now() - interval '1 day', now())`); } catch (e) { e1 = e.message; }
  try { await q(`SELECT * FROM public.bill_provider_balances`); } catch (e) { e2 = e.message; }
  try { await q(`INSERT INTO public.bill_provider_topups (provider, amount_kobo, paid_at, created_by) VALUES ('bigisub', 100, now(), 'x')`); } catch (e) { e3 = e.message; }
  await q(`RESET ROLE`);
  ok(/permission denied/.test(e1 ?? "") && /permission denied/.test(e2 ?? "") && /permission denied/.test(e3 ?? ""), `${role}: no report, no balances, no top-ups`, J([e1, e2, e3]));
}

console.log(fails ? `\n${fails} of ${fails + passes} checks FAILED` : `\nall ${passes} checks passed`);
process.exit(fails ? 1 : 0);
