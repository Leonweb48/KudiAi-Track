// Run: npm i --no-save @electric-sql/pglite@0.2.17 && node tests/invite/invite.pglite.mjs supabase/migrations/20270340000000_invite_and_earn.sql
// Real-Postgres (PGlite) test of supabase/migrations/20270340000000_invite_and_earn.sql
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";

const MIG = process.argv[2];
const db = new PGlite();
let fails = 0, passes = 0;
const ok = (cond, msg) => { if (cond) { passes++; console.log("  ✓", msg); } else { fails++; console.log("  ✗", msg); } };
const q = async (sql, p) => (await db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];

// ── stub of the Supabase pieces the migration touches ──
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, aud text, role text, created_at timestamptz DEFAULT now(), raw_user_meta_data jsonb DEFAULT '{}');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE SCHEMA cron; CREATE TABLE cron.job (jobid serial, jobname text);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS int LANGUAGE sql AS $$ INSERT INTO cron.job(jobname) VALUES (n) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(id int) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid = id RETURNING true $$;
CREATE TABLE platform_config (key text PRIMARY KEY, value text, description text, updated_at timestamptz DEFAULT now());
CREATE TABLE profiles (id uuid PRIMARY KEY, email text, full_name text, business_name text, bvn_hash text);
CREATE TABLE aso_clients (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_user_id uuid, full_name text, bvn_hash text, bvn_verified_at timestamptz);
CREATE TABLE wallets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, balance_kobo bigint NOT NULL DEFAULT 0 CHECK (balance_kobo >= 0),
  status text NOT NULL DEFAULT 'active', flw_account_number text, flw_virtual_account_id text, updated_at timestamptz DEFAULT now());
CREATE TABLE wallet_ledger (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), wallet_id uuid, user_id uuid, direction text, amount_kobo bigint CHECK (amount_kobo > 0),
  balance_after_kobo bigint, source text, status text DEFAULT 'completed', reference text, flw_reference text, related_txn_id uuid, narration text,
  meta jsonb DEFAULT '{}', created_at timestamptz DEFAULT now(),
  CONSTRAINT wallet_ledger_source_check CHECK (source IN ('adjustment','ajo_collection','ajo_contribution','ajo_payout','ajo_reversal','bill_reversal','bill_spend','cbn_levy','deposit_fee','peer_esusu_collection','peer_esusu_contribution','peer_esusu_payout','peer_esusu_payout_sweep','sale','subscription_reversal','subscription_spend','topup','transfer_fee','wallet_fee','withdrawal','withdrawal_reversal')));
CREATE UNIQUE INDEX wallet_ledger_flw_ref_uniq ON wallet_ledger (source, flw_reference) WHERE flw_reference IS NOT NULL;
CREATE TABLE notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, type text, category text, title text, body text, deep_link jsonb,
  priority text, dedupe_key text, read_at timestamptz, created_at timestamptz DEFAULT now(), CONSTRAINT notifications_dedupe_key_unique UNIQUE (dedupe_key));
`);
await db.exec(fs.readFileSync(MIG, "utf8"));
console.log("migration applied");

const U = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const SETTLE = "00000000-0000-0000-0000-000000000001";
async function user(n, name, { ageDays = 0, wallet = false, bvn = null, client = false } = {}) {
  await q(`INSERT INTO auth.users (id, created_at) VALUES ($1, now() - make_interval(days => $2))`, [U(n), ageDays]);
  if (client) await q(`INSERT INTO aso_clients (client_user_id, full_name, bvn_hash) VALUES ($1, $2, $3)`, [U(n), name, bvn]);
  else await q(`INSERT INTO profiles (id, full_name, bvn_hash) VALUES ($1, $2, $3)`, [U(n), name, bvn]);
  if (wallet) await openWallet(n);
}
const openWallet = (n) => q(`INSERT INTO wallets (user_id, flw_account_number, flw_virtual_account_id) VALUES ($1, '01234', 'va') ON CONFLICT (user_id) DO UPDATE SET flw_account_number='01234', flw_virtual_account_id='va'`, [U(n)]);
const spend = (n, kobo, source = "withdrawal", status = "completed", dir = "debit") =>
  q(`INSERT INTO wallet_ledger (wallet_id, user_id, direction, amount_kobo, balance_after_kobo, source, status) SELECT id, user_id, $3, $2, 0, $4, $5 FROM wallets WHERE user_id = $1`, [U(n), kobo, dir, source, status]);
const bal = async (id) => Number((await one(`SELECT balance_kobo FROM wallets WHERE user_id = $1`, [id]))?.balance_kobo ?? 0);
const as = (n) => db.exec(`SELECT set_config('test.uid', '${n ? U(n) : ""}', false)`);
const claim = async (n, code, portal = "owner") => { await as(n); const r = await one(`SELECT invite_claim($1, $2) AS r`, [code, portal]); return r.r; };
const inv = (n) => one(`SELECT * FROM invites WHERE friend_id = $1`, [U(n)]);
const process_ = () => q(`SELECT invite_process(NULL)`);
const setSettle = (kobo) => q(`UPDATE wallets SET balance_kobo = $1 WHERE user_id = $2`, [kobo, SETTLE]);

// settlement wallet
await q(`INSERT INTO auth.users (id) VALUES ($1)`, [SETTLE]);
await q(`INSERT INTO wallets (user_id, balance_kobo) VALUES ($1, 1000000)`, [SETTLE]);

console.log("\n1. codes & claiming");
await user(10, "Amara Okafor", { wallet: true, bvn: "bvnA", ageDays: 90 });
await as(10);
const dash0 = (await one(`SELECT invite_dashboard() AS d`)).d;
const code = dash0.code;
ok(/^KD[A-Z2-9]{6}$/.test(code), `inviter gets a code (${code})`);
ok((await one(`SELECT invite_code_for($1) AS c`, [U(10)])).c === code, "code is stable");
ok(dash0.slots.length === 0 && dash0.config.tiers.length === 3, "empty dashboard, 3 tiers");
ok((await claim(10, code)).reason === "own_code", "can't use own code");
await user(11, "Chinedu Eze");
ok((await claim(11, "nope")).reason === "invalid_code", "unknown code refused");
const c1 = await claim(11, code.toLowerCase());
ok(c1.ok === true && c1.inviter_name === "Amara O.", "new user claims (case-insensitive), sees inviter short name");
ok((await claim(11, code)).reason === "already_invited", "can't claim twice");
await user(12, "Old Timer", { ageDays: 10 });
ok((await claim(12, code)).reason === "not_new", "accounts older than 3 days can't claim");
ok(Number((await one(`SELECT count(*) FROM notifications WHERE user_id IN ($1,$2)`, [U(10), U(11)])).count) === 2, "inviter + friend notified on join");

console.log("\n2. qualification");
await process_();
ok((await inv(11)).status === "joined", "no wallet yet → still joined");
await openWallet(11);
await spend(11, 150000);
await spend(11, 999999, "topup", "completed", "credit");          // money IN never counts
await spend(11, 80000, "bill_spend", "failed");                    // failed never counts
await process_();
let r11 = await inv(11);
ok(r11.status === "wallet_open" && Number(r11.spent_kobo) === 150000, "wallet open, ₦1,500 counted (credits & failed ignored)");
await spend(11, 50000, "bill_spend");
const settleBefore = await bal(SETTLE);
await process_();
r11 = await inv(11);
ok(r11.status === "rewarded" && r11.tier === 1, "₦2,000 reached → rewarded at tier 1");
ok(await bal(U(10)) === 50000, "inviter credited ₦500");
ok(await bal(U(11)) === 20000, "friend credited ₦200 welcome bonus");
ok(settleBefore - (await bal(SETTLE)) === 70000, "settlement wallet debited ₦700 (double entry)");
await process_(); await process_();
ok(await bal(U(10)) === 50000 && await bal(U(11)) === 20000, "re-running pays nothing twice");
ok(Number((await one(`SELECT count(*) FROM wallet_ledger WHERE source='referral_reward'`)).count) === 4, "4 ledger legs (2 fund debits + 2 credits)");

console.log("\n3. tiers and campaign cap");
for (const [n, name] of [[13, "Bisi Ade"], [14, "Ngozi Obi"], [15, "Musa Bello"]]) {
  await user(n, name); await claim(n, code); await openWallet(n); await spend(n, 200000, "ajo_contribution");
}
await process_();
ok((await inv(13)).tier === 2 && Number((await inv(13)).inviter_reward_kobo) === 70000, "2nd friend → tier 2 ₦700");
ok((await inv(14)).tier === 3 && Number((await inv(14)).inviter_reward_kobo) === 100000, "3rd friend → tier 3 ₦1,000");
const r15 = await inv(15);
ok(r15.tier === null && Number(r15.inviter_reward_kobo) === 0 && r15.status === "rewarded", "4th friend: campaign cap, inviter ₦0");
ok(await bal(U(15)) === 20000, "4th friend still gets ₦200 bonus");
ok(await bal(U(10)) === 50000 + 70000 + 100000, "inviter total ₦2,200");

console.log("\n4. settlement can't cover → waits, then pays");
await setSettle(10000);
await as(10); await q(`UPDATE invite_campaigns SET ends_at = now() - interval '1 second' WHERE user_id = $1`, [U(10)]);   // new campaign
await user(16, "Tunde Ola"); await claim(16, code); await openWallet(16); await spend(16, 200000);
await process_();
let r16 = await inv(16);
ok(r16.status === "qualified" && r16.tier === 1 && r16.friend_paid_at === null, "new campaign → tier 1 again; unpaid while settlement is short");
await setSettle(1000000);
await process_();
r16 = await inv(16);
ok(r16.status === "rewarded" && r16.friend_paid_at && r16.inviter_paid_at, "paid on the next run once funded");

console.log("\n5. fraud & expiry");
await user(17, "Same Bvn", { bvn: "bvnA" }); await claim(17, code); await openWallet(17); await spend(17, 300000);
await process_();
ok((await inv(17)).status === "rejected" && (await inv(17)).reject_reason === "same_bvn_as_inviter", "friend with inviter's BVN rejected");
await user(18, "Dup Bvn", { bvn: "bvnX" }); await claim(18, code); await openWallet(18); await spend(18, 200000);
await process_();
await user(19, "Dup Bvn Two", { bvn: "bvnX", client: true }); await claim(19, code, "client"); await openWallet(19); await spend(19, 200000);
await process_();
ok((await inv(18)).status === "rewarded" && (await inv(19)).status === "rejected", "a BVN earns the welcome bonus once (client portal too)");
await user(20, "Slow Poke"); await claim(20, code);
await q(`UPDATE invites SET expires_at = now() - interval '1 minute' WHERE friend_id = $1`, [U(20)]);
await process_();
ok((await inv(20)).status === "expired", "past the 7-day window → expired");

console.log("\n6. inviter without an open wallet");
await user(30, "No Wallet Yet", { ageDays: 30 });
const code30 = (await one(`SELECT invite_code_for($1) AS c`, [U(30)])).c;
await user(31, "Friend Of Thirty"); await claim(31, code30); await openWallet(31); await spend(31, 200000);
await process_();
let r31 = await inv(31);
ok(r31.friend_paid_at && !r31.inviter_paid_at && r31.status === "qualified", "friend paid; inviter's ₦500 waits for their wallet");
ok(Number((await one(`SELECT count(*) FROM notifications WHERE user_id=$1 AND type='invite_reward_waiting'`, [U(30)])).count) === 1, "inviter told to open wallet");
await openWallet(30); await process_();
ok((await inv(31)).status === "rewarded" && await bal(U(30)) === 50000, "paid once the inviter opens a wallet");

console.log("\n7. dashboard + kill switch");
await as(10);
const d = (await one(`SELECT invite_dashboard() AS d`)).d;
ok(d.enabled && d.totals.invited >= 9 && Number(d.totals.earned_kobo) === 340000, `dashboard totals (invited ${d.totals.invited}, earned ₦${d.totals.earned_kobo / 100})`);
ok(d.slots.length >= 1 && d.slots[0].tier === 1, "current campaign slots");
await as(11);
const dm = (await one(`SELECT invite_dashboard() AS d`)).d;
ok(dm.mine && dm.mine.inviter_name === "Amara O." && dm.mine.paid === true, "friend sees who invited them + bonus paid");
await q(`UPDATE platform_config SET value='false' WHERE key='referral_enabled'`);
ok((await one(`SELECT invite_dashboard() AS d`)).d.enabled === false, "kill switch hides the program");
await user(40, "Late Comer"); ok((await claim(40, code)).reason === "disabled", "kill switch stops new claims");

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
