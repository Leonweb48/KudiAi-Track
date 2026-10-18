// Run: npm i --no-save @electric-sql/pglite@0.2.17 && node tests/wallet/client-transfer-fee.pglite.mjs supabase/migrations/20270355000000_client_transfer_fee_at_cost.sql
// Real-Postgres (PGlite) test: clients/personal wallets pay Flutterwave's own fee on every bank transfer (no free ones),
// wallet moves are free for them; businesses keep their bands, monthly free transfers and the 3-a-day wallet-move rule.
// The production helper functions are lifted verbatim from their migrations.
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";

const MIG = process.argv[2];
const db = new PGlite();
let fails = 0, passes = 0;
const ok = (cond, msg) => { if (cond) { passes++; console.log("  ✓", msg); } else { fails++; console.log("  ✗", msg); } };
const q = async (sql, p) => (await db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];

// latest "CREATE OR REPLACE FUNCTION public.<name>(" in a file, through its closing dollar-quote
function fn(file, name) {
  const s = fs.readFileSync(file, "utf8");
  const a = s.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (a < 0) throw new Error(`${name} not in ${file}`);
  const m = s.slice(a).match(/AS\s+(\$[a-z_]*\$)/i);
  const tag = m[1], open = a + m.index + m[0].length;
  const close = s.indexOf(tag, open) + tag.length;
  return s.slice(a, close) + ";";
}

await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE TABLE platform_config (key text PRIMARY KEY, value text, description text);
INSERT INTO platform_config (key, value) VALUES ('wallet_bank_fee_low_kobo','1000'), ('wallet_bank_fee_lowmid_kobo','2500'), ('wallet_bank_fee_mid_kobo','3500'),
  ('wallet_bank_fee_high_kobo','6000'), ('wallet_free_transfers_personal_day','3'), ('wallet_free_transfers_free_month','0'),
  ('wallet_free_transfers_standard_month','10'), ('wallet_free_transfers_premium_month','30'), ('wallet_stamp_duty_enabled','true');
CREATE TABLE profiles (id uuid PRIMARY KEY, business_name text);
CREATE TABLE subscriptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, plan text, status text DEFAULT 'active');
CREATE TABLE wallets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, balance_kobo bigint NOT NULL DEFAULT 0, status text DEFAULT 'active');
CREATE TABLE wallet_ledger (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), wallet_id uuid, user_id uuid, direction text, amount_kobo bigint,
  balance_after_kobo bigint, source text, status text, reference text, narration text, related_txn_id uuid, meta jsonb DEFAULT '{}', created_at timestamptz DEFAULT now());
CREATE TABLE wallet_withdrawals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, wallet_id uuid, amount_kobo bigint, status text DEFAULT 'pending',
  flw_transfer_id text, fee_kobo bigint, updated_at timestamptz);
CREATE TABLE legal_documents (id serial, type text, content text, version int, status text, published_at timestamptz, published_by text, editor_name text,
  requires_reacceptance boolean, change_summary text);
CREATE FUNCTION public.peer_circle_pot_held_kobo(u uuid) RETURNS bigint LANGUAGE sql AS $$ SELECT 0::bigint $$;
CREATE FUNCTION public.wallet_credit_settlement(a bigint, s text, n text, r uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
`);
for (const [file, name] of [
  ["supabase/migrations/20270304000000_wallet_bank_transfer_pricing.sql", "wallet_cfg_int"],
  ["supabase/migrations/20270304000000_wallet_bank_transfer_pricing.sql", "wallet_fee_tier"],
  ["supabase/migrations/20270304000000_wallet_bank_transfer_pricing.sql", "wallet_free_transfer_state"],
  ["supabase/migrations/20270327000000_transfer_bands_v2_business_deposit_fee.sql", "wallet_bank_transfer_fee_kobo"],
  ["supabase/migrations/20270307000000_stamp_duty_refunds_terms_v6.sql", "wallet_stamp_duty_kobo"],
  ["supabase/migrations/20270320000000_protect_circle_pots.sql", "wallet_take_transfer_charge"],
]) await db.exec(fn(file, name));

// a Terms copy containing the v8 4.10 text the migration replaces
const v7 = fs.readFileSync("supabase/migrations/20270327000000_transfer_bands_v2_business_deposit_fee.sql", "utf8");
const sec = v7.slice(v7.indexOf("<p><strong>(b) Transfers from your wallet"), v7.indexOf("<p><strong>(f) Taxes."));
await q(`INSERT INTO legal_documents (type, content, version, status) VALUES ('tnc', $1, 8, 'published')`,
  ["<p><strong>Effective Date:</strong> x<br><strong>Last Updated:</strong> x<br><strong>Version:</strong> 8</p>" + sec]);

await db.exec(fs.readFileSync(MIG, "utf8"));
console.log("migration applied");

const U = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const CLIENT = U(1), BIZ_FREE = U(2), BIZ_STD = U(3);
await q(`INSERT INTO profiles VALUES ($1, 'Amara Foods'), ($2, 'Bello Stores')`, [BIZ_FREE, BIZ_STD]);
await q(`INSERT INTO subscriptions (user_id, plan) VALUES ($1, 'kobo'), ($2, 'naira')`, [BIZ_FREE, BIZ_STD]);
for (const u of [CLIENT, BIZ_FREE, BIZ_STD]) await q(`INSERT INTO wallets (user_id, balance_kobo) VALUES ($1, 100000000)`, [u]);

const quote = async (u, naira) => { await db.exec(`SELECT set_config('test.uid', '${u}', false)`); return (await one(`SELECT public.wallet_bank_transfer_quote($1) AS r`, [naira * 100])).r; };
// a bank transfer: hold (pending debit) + withdrawal row, then Flutterwave accepts it
async function send(u, naira) {
  const w = await one(`SELECT * FROM wallets WHERE user_id = $1`, [u]);
  const wd = await one(`INSERT INTO wallet_withdrawals (user_id, wallet_id, amount_kobo) VALUES ($1, $2, $3) RETURNING id`, [u, w.id, naira * 100]);
  await q(`INSERT INTO wallet_ledger (wallet_id, user_id, direction, amount_kobo, source, status, related_txn_id) VALUES ($1, $2, 'debit', $3, 'withdrawal', 'pending', $4)`,
    [w.id, u, naira * 100, wd.id]);
  await q(`SELECT public.wallet_transfer_sent($1, 'flw-1', 0)`, [wd.id]);
  const fee = await one(`SELECT coalesce(sum(amount_kobo), 0) AS k FROM wallet_ledger WHERE related_txn_id = $1 AND source = 'transfer_fee'`, [wd.id]);
  const duty = await one(`SELECT coalesce(sum(amount_kobo), 0) AS k FROM wallet_ledger WHERE related_txn_id = $1 AND source = 'cbn_levy'`, [wd.id]);
  return { fee: Number(fee.k) / 100, duty: Number(duty.k) / 100 };
}

console.log("\n1. clients: Flutterwave's own fee, no free transfers");
for (const [amt, want] of [[100, 10], [5000, 10], [5000.01, 25], [9999, 25], [50000, 25], [50000.01, 50], [200000, 50]]) {
  const qq = await quote(CLIENT, amt);
  ok(qq.free === false && Number(qq.fee_kobo) === want * 100, `quote ₦${amt} → fee ₦${want} (got ₦${Number(qq.fee_kobo) / 100}, free=${qq.free})`);
}
const first = await send(CLIENT, 3000);
ok(first.fee === 10, `the very first transfer of the day is charged (₦${first.fee})`);
const big = await send(CLIENT, 20000);
ok(big.fee === 25 && big.duty === 50, `₦20,000 → ₦25 fee + ₦50 stamp duty (got ₦${big.fee} + ₦${big.duty})`);
const huge = await send(CLIENT, 80000);
ok(huge.fee === 50, `₦80,000 → ₦50 (got ₦${huge.fee})`);

console.log("\n2. clients: KudiAI wallet moves are free");
ok((await one(`SELECT public.wallet_daily_transfer_count($1) AS n`, [CLIENT])).n === 0, "wallet-move counter reports 0 for a client → the '> 3' fee gate never fires");

console.log("\n3. businesses unchanged");
const qf = await quote(BIZ_FREE, 20000);
ok(qf.free === false && Number(qf.fee_kobo) === 3500, `Free-plan business ₦20,000 → ₦35 (got ₦${Number(qf.fee_kobo) / 100})`);
const qb = await quote(BIZ_FREE, 60000);
ok(Number(qb.fee_kobo) === 6000, `Free-plan business ₦60,000 → ₦60`);
const qs = await quote(BIZ_STD, 20000);
ok(qs.free === true && Number(qs.allowance) === 10, "Standard business: still 10 free a month");
const bs = await send(BIZ_STD, 20000);
ok(bs.fee === 0 && bs.duty === 50, `Standard business free transfer: no fee, stamp duty still ₦50`);
for (let i = 0; i < 4; i++) await q(`INSERT INTO wallet_ledger (user_id, direction, amount_kobo, source, status) VALUES ($1, 'debit', 100, 'ajo_payout', 'completed')`, [BIZ_FREE]);
ok((await one(`SELECT public.wallet_daily_transfer_count($1) AS n`, [BIZ_FREE])).n === 4, "business wallet-move counter still counts (4 moves → 4th+ charged as before)");

console.log("\n4. Terms v9");
const t9 = await one(`SELECT * FROM legal_documents WHERE version = 9`);
ok(!!t9 && t9.requires_reacceptance, "v9 published, re-acceptance required");
ok(t9 && t9.content.includes("always free for Ajo/Esusu Clients") && t9.content.includes("<td>Above ₦50,000</td><td>₦50</td>") && !t9.content.includes("first <strong>3 transfers each day</strong>"),
  "4.10(b)/(d) carry the new client prices; the old 3-free-a-day line is gone");
await db.exec(fs.readFileSync(MIG, "utf8"));
ok(Number((await one(`SELECT count(*) AS n FROM legal_documents`)).n) === 2, "running the migration again doesn't publish another copy");

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
