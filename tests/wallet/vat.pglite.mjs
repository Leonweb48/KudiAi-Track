// Run (from the repo root, with @electric-sql/pglite@0.2.17 installed):
//   node tests/wallet/vat.pglite.mjs supabase/migrations/20270390000000_wallet_vat_and_transfer_fee_fix.sql
// Real-Postgres (PGlite) test: 7.5% VAT on every wallet fee as its own ledger line, the bank transfer fee charged for a
// transfer created 'processing' (as production does — the old guard only charged 'pending' ones), once only, the quote,
// finance booking and Terms v13. Production helper functions are lifted verbatim from their migrations.
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";

const MIG = process.argv[2];
const db = new PGlite();
let fails = 0, passes = 0;
const ok = (cond, msg, x = "") => { if (cond) { passes++; console.log("  ✓", msg); } else { fails++; console.log("  ✗", msg, x); } };
const q = async (sql, p) => (await db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];
function fn(file, name) {
  const s = fs.readFileSync(file, "utf8");
  const a = s.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (a < 0) throw new Error(`${name} not in ${file}`);
  const m = s.slice(a).match(/AS\s+(\$[a-z_]*\$)/i);
  const tag = m[1], open = a + m.index + m[0].length;
  return s.slice(a, s.indexOf(tag, open) + tag.length) + ";";
}
const SETTLEMENT = "00000000-0000-0000-0000-000000000001";
const SOURCES = ["topup", "sale", "bill_spend", "bill_reversal", "withdrawal", "withdrawal_reversal", "adjustment", "ajo_contribution", "ajo_collection",
  "ajo_payout", "transfer_fee", "cbn_levy", "wallet_fee", "subscription_spend", "subscription_reversal", "deposit_fee", "referral_reward"];

await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE TABLE platform_config (key text PRIMARY KEY, value text, description text, updated_at timestamptz);
INSERT INTO platform_config (key, value) VALUES ('wallet_bank_fee_low_kobo','1000'), ('wallet_bank_fee_lowmid_kobo','2500'), ('wallet_bank_fee_mid_kobo','3500'),
  ('wallet_bank_fee_high_kobo','6000'), ('wallet_bank_fee_personal_low_kobo','1000'), ('wallet_bank_fee_personal_mid_kobo','2500'),
  ('wallet_bank_fee_personal_high_kobo','5000'), ('wallet_free_transfers_personal_day','0'), ('wallet_free_transfers_free_month','0'),
  ('wallet_free_transfers_standard_month','0'), ('wallet_free_transfers_premium_month','0'), ('wallet_stamp_duty_enabled','true');
CREATE TABLE profiles (id uuid PRIMARY KEY, business_name text);
CREATE TABLE subscriptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, plan text, status text DEFAULT 'active');
CREATE TABLE wallets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, balance_kobo bigint NOT NULL DEFAULT 0, status text DEFAULT 'active');
CREATE TABLE wallet_ledger (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), wallet_id uuid, user_id uuid, direction text, amount_kobo bigint,
  balance_after_kobo bigint, source text, status text, reference text, narration text, related_txn_id uuid, meta jsonb DEFAULT '{}', created_at timestamptz DEFAULT now(),
  CONSTRAINT wallet_ledger_source_check CHECK (source IN (${SOURCES.map((s) => `'${s}'`).join(",")})));
CREATE TABLE wallet_withdrawals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, wallet_id uuid, amount_kobo bigint, status text DEFAULT 'processing',
  flw_transfer_id text, fee_kobo bigint, updated_at timestamptz);
CREATE TABLE legal_documents (id serial, type text, content text, version int, status text, published_at timestamptz, published_by text, editor_name text,
  requires_reacceptance boolean, change_summary text);
CREATE TABLE finance_lines (code text PRIMARY KEY, name text, section text, stream text, counts_toward_profit boolean, allow_manual boolean, sort_order int, description text);
CREATE TABLE finance_entries (id serial, occurred_at timestamptz, line_code text, amount_kobo bigint, source_type text, source_id text, user_id uuid, reference text,
  category text, estimated boolean, note text, UNIQUE (line_code, source_type, source_id));
CREATE FUNCTION public.peer_circle_pot_held_kobo(u uuid) RETURNS bigint LANGUAGE sql AS $$ SELECT 0::bigint $$;
-- the settlement credit, as production does it (balance + a 'credit' ledger line)
CREATE FUNCTION public.wallet_credit_settlement(p_amount_kobo bigint, p_source text, p_narration text, p_related_txn_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE w wallets%ROWTYPE; nb bigint;
BEGIN
  SELECT * INTO w FROM wallets WHERE user_id = '${SETTLEMENT}' FOR UPDATE;
  nb := w.balance_kobo + p_amount_kobo;
  UPDATE wallets SET balance_kobo = nb WHERE id = w.id;
  INSERT INTO wallet_ledger (wallet_id, user_id, direction, amount_kobo, balance_after_kobo, source, status, narration, related_txn_id)
  VALUES (w.id, '${SETTLEMENT}', 'credit', p_amount_kobo, nb, p_source, 'completed', p_narration, p_related_txn_id);
END $$;
`);
for (const [file, name] of [
  ["supabase/migrations/20270304000000_wallet_bank_transfer_pricing.sql", "wallet_cfg_int"],
  ["supabase/migrations/20270304000000_wallet_bank_transfer_pricing.sql", "wallet_fee_tier"],
  ["supabase/migrations/20270304000000_wallet_bank_transfer_pricing.sql", "wallet_free_transfer_state"],
  ["supabase/migrations/20270327000000_transfer_bands_v2_business_deposit_fee.sql", "wallet_bank_transfer_fee_kobo"],
  ["supabase/migrations/20270355000000_client_transfer_fee_at_cost.sql", "wallet_bank_transfer_fee_for"],
  ["supabase/migrations/20270307000000_stamp_duty_refunds_terms_v6.sql", "wallet_stamp_duty_kobo"],
  ["supabase/migrations/20270320000000_protect_circle_pots.sql", "wallet_take_transfer_charge"],
]) await db.exec(fn(file, name));

const OLD_F = '<p><strong>(f) Taxes.</strong> Where the law requires us to charge Value Added Tax (VAT) on our fees, it will be shown separately before you confirm.</p>';
await q(`INSERT INTO legal_documents (type, content, version, status) VALUES ('tnc', $1, 12, 'published')`,
  ["<p><strong>Effective Date:</strong> x<br><strong>Last Updated:</strong> x<br><strong>Version:</strong> 12</p><h3>4.10</h3>" + OLD_F]);

await db.exec(fs.readFileSync(MIG, "utf8"));
console.log("migration applied");

const U = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const CLIENT = U(11), BIZ = U(12), POOR = U(13);
await q(`INSERT INTO profiles VALUES ($1, 'Amara Foods'), ($2, 'Poor Shop')`, [BIZ, POOR]);
await q(`INSERT INTO subscriptions (user_id, plan) VALUES ($1, 'naira'), ($2, 'kobo')`, [BIZ, POOR]);
await q(`INSERT INTO wallets (user_id, balance_kobo) VALUES ($1, 0)`, [SETTLEMENT]);
for (const u of [CLIENT, BIZ]) await q(`INSERT INTO wallets (user_id, balance_kobo) VALUES ($1, 100000000)`, [u]);
await q(`INSERT INTO wallets (user_id, balance_kobo) VALUES ($1, 1050)`, [POOR]);   // ₦10.50: covers a ₦10 fee, not its VAT
const bal = async (u) => Number((await one(`SELECT balance_kobo FROM wallets WHERE user_id = $1`, [u])).balance_kobo);
const lines = async (rel, src) => (await q(`SELECT * FROM wallet_ledger WHERE related_txn_id = $1 AND source = $2 AND direction = 'debit'`, [rel, src]));

async function send(u, naira, status = "processing") {
  const w = await one(`SELECT * FROM wallets WHERE user_id = $1`, [u]);
  await q(`UPDATE wallets SET balance_kobo = balance_kobo - $1 WHERE id = $2`, [naira * 100, w.id]);
  const wd = await one(`INSERT INTO wallet_withdrawals (user_id, wallet_id, amount_kobo, status) VALUES ($1, $2, $3, $4) RETURNING id`, [u, w.id, naira * 100, status]);
  await q(`INSERT INTO wallet_ledger (wallet_id, user_id, direction, amount_kobo, source, status, related_txn_id) VALUES ($1, $2, 'debit', $3, 'withdrawal', 'pending', $4)`,
    [w.id, u, naira * 100, wd.id]);
  return wd.id;
}
const sent = (id) => q(`SELECT public.wallet_transfer_sent($1, 'flw-1', 0)`, [id]);

console.log("bank transfer fee is charged again (transfers are created 'processing')…");
let b0 = await bal(CLIENT);
let wd = await send(CLIENT, 3000);
await sent(wd);
let fee = await lines(wd, "transfer_fee"), vat = await lines(wd, "vat");
ok(fee.length === 1 && Number(fee[0].amount_kobo) === 1000, "client ₦3,000 transfer created 'processing' → ₦10 transfer fee taken", JSON.stringify(fee));
ok(vat.length === 1 && Number(vat[0].amount_kobo) === 75 && vat[0].narration === "VAT 7.5% on transfer fee", "…and its own VAT line: ₦0.75, 'VAT 7.5% on transfer fee'", JSON.stringify(vat));
ok(b0 - (await bal(CLIENT)) === 300000 + 1000 + 75, "client paid amount + ₦10 + ₦0.75, nothing more");
await sent(wd);
ok((await lines(wd, "transfer_fee")).length === 1 && (await lines(wd, "vat")).length === 1, "a repeated 'sent' never charges twice");

wd = await send(BIZ, 60000);
await sent(wd);
fee = await lines(wd, "transfer_fee"); vat = await lines(wd, "vat");
const duty = await lines(wd, "cbn_levy");
ok(Number(fee[0]?.amount_kobo) === 6000 && Number(vat[0]?.amount_kobo) === 450 && Number(duty[0]?.amount_kobo) === 5000,
  "business ₦60,000: ₦60 fee + ₦4.50 VAT + ₦50 stamp duty (no VAT on stamp duty)", JSON.stringify([fee, vat, duty].map((x) => x.map((y) => y.amount_kobo))));

wd = await send(BIZ, 2000, "failed");
await sent(wd);
ok((await lines(wd, "transfer_fee")).length === 0 && (await lines(wd, "vat")).length === 0, "a transfer that already failed is not charged");

console.log("the ₦10 wallet charge fee and the deposit fee…");
for (const [src, what] of [["wallet_fee", "charge fee"], ["deposit_fee", "deposit fee"]]) {
  const w = await one(`SELECT * FROM wallets WHERE user_id = $1`, [BIZ]);
  const rel = (await one(`SELECT gen_random_uuid() AS id`)).id;
  const amt = src === "wallet_fee" ? 1000 : 4000;
  await q(`UPDATE wallets SET balance_kobo = balance_kobo - $1 WHERE id = $2`, [amt, w.id]);
  await q(`INSERT INTO wallet_ledger (wallet_id, user_id, direction, amount_kobo, source, status, reference, related_txn_id) VALUES ($1, $2, 'debit', $3, $4, 'completed', 'ref-1', $5)`,
    [w.id, BIZ, amt, src, rel]);
  const v = await lines(rel, "vat");
  ok(v.length === 1 && Number(v[0].amount_kobo) === Math.round(amt * 0.075) && v[0].narration === `VAT 7.5% on ${what}`,
    `${src} ₦${amt / 100} → VAT ₦${(Math.round(amt * 0.075) / 100).toFixed(2)} as its own line ("VAT 7.5% on ${what}")`, JSON.stringify(v));
}

console.log("never blocks the payment…");
{
  const w = await one(`SELECT * FROM wallets WHERE user_id = $1`, [POOR]);
  const rel = (await one(`SELECT gen_random_uuid() AS id`)).id;
  await q(`UPDATE wallets SET balance_kobo = balance_kobo - 1000 WHERE id = $1`, [w.id]);
  let threw = false;
  try { await q(`INSERT INTO wallet_ledger (wallet_id, user_id, direction, amount_kobo, source, status, related_txn_id) VALUES ($1, $2, 'debit', 1000, 'wallet_fee', 'completed', $3)`, [w.id, POOR, rel]); }
  catch { threw = true; }
  ok(!threw && (await lines(rel, "wallet_fee")).length === 1 && (await lines(rel, "vat")).length === 0 && (await bal(POOR)) === 50,
    "balance can't cover the VAT → the fee still goes through, no VAT, balance never negative");
}

console.log("settlement, switch, quote, finance, Terms…");
const settle = await one(`SELECT coalesce(sum(amount_kobo), 0) AS k FROM wallet_ledger WHERE user_id = $1 AND source = 'vat' AND direction = 'credit'`, [SETTLEMENT]);
ok(Number(settle.k) === 75 + 450 + 75 + 300, "every VAT taken is credited to the settlement wallet (₦9.00 so far)", settle.k);
await q(`UPDATE platform_config SET value = 'false' WHERE key = 'wallet_vat_enabled'`);
wd = await send(CLIENT, 1000); await sent(wd);
ok((await lines(wd, "transfer_fee")).length === 1 && (await lines(wd, "vat")).length === 0, "switched off → fee as before, no VAT");
await q(`UPDATE platform_config SET value = 'true' WHERE key = 'wallet_vat_enabled'`);

await db.exec(`SELECT set_config('test.uid', '${BIZ}', false)`);
const qt = (await one(`SELECT public.wallet_bank_transfer_quote(2000000) AS r`)).r;
ok(qt.fee_kobo === 3500 && qt.vat_kobo === 263 && qt.stamp_duty_kobo === 5000 && qt.total_charges_kobo === 3500 + 263 + 5000 && qt.vat_rate_bp === 750,
  "quote for ₦20,000: fee ₦35, VAT ₦2.63, stamp duty ₦50, total ₦87.63", JSON.stringify(qt));

const fin = (await one(`SELECT public.finance_sync_vat(true) AS r`)).r;
const booked = await one(`SELECT count(*) AS n, sum(amount_kobo) AS k FROM finance_entries WHERE line_code = 'wallet.vat_payable'`);
ok(fin.vat_payable === Number(booked.n) && Number(booked.k) === Number(settle.k), "VAT booked as 'to remit' (memo, outside profit)", JSON.stringify([fin, booked]));
ok((await one(`SELECT counts_toward_profit AS p FROM finance_lines WHERE code = 'wallet.vat_payable'`)).p === false, "…not counted as income");

const t = await one(`SELECT version, requires_reacceptance, content FROM legal_documents ORDER BY version DESC LIMIT 1`);
ok(t.version === 13 && t.requires_reacceptance === false && t.content.includes("(VAT) at 7.5% is charged on our fees") && !t.content.includes(OLD_F),
  "Terms v13 says VAT is charged — published WITHOUT a re-acceptance prompt", JSON.stringify({ v: t.version, r: t.requires_reacceptance }));

await db.exec(fs.readFileSync(MIG, "utf8"));
ok((await one(`SELECT max(version) AS v FROM legal_documents`)).v === 13, "running the migration again changes nothing (idempotent)");

console.log(fails ? `\n${fails} of ${passes + fails} checks FAILED` : `\nall ${passes} checks passed`);
process.exit(fails ? 1 : 0);
