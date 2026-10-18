// Run: npm i --no-save @electric-sql/pglite@0.2.17 && node tests/invite/review.pglite.mjs supabase/migrations/20270357000000_invite_rewards_admin_approval.sql
// Real-Postgres (PGlite) test: Invite & Earn rewards wait for an admin's approval (20270357) on top of 20270340.
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";

const MIG = process.argv[2];
const db = new PGlite();
let fails = 0, passes = 0;
const ok = (cond, msg) => { if (cond) { passes++; console.log("  ok  ", msg); } else { fails++; console.log("  FAIL", msg); } };
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
await db.exec(`CREATE TABLE admin_notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), target_admin_id uuid, type text, category text, title text, message text, link text, metadata jsonb, is_read boolean DEFAULT false, created_at timestamptz DEFAULT now());`);
await db.exec(fs.readFileSync("supabase/migrations/20270340000000_invite_and_earn.sql", "utf8"));
await db.exec(fs.readFileSync(MIG, "utf8"));
console.log("migrations applied");

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
await user(10, "Amara Okafor", { wallet: true, bvn: "bvnA", ageDays: 90 });
await as(10);
const code = (await one(`SELECT invite_dashboard() AS d`)).d.code;
const review = async (n, approve, note = null) =>
  (await one(`SELECT invite_admin_review((SELECT id FROM invites WHERE friend_id = $1), $2, 'tester', $3) AS r`, [U(n), approve, note])).r;

console.log("\n1. qualifying no longer pays");
await user(11, "Chinedu Eze"); await claim(11, code); await openWallet(11); await spend(11, 250000);
const before = await bal(SETTLE);
await process_();
let i = await inv(11);
ok(i.status === "qualified" && i.review_status === "pending", `qualified -> pending review (${i.status}/${i.review_status})`);
ok(!i.inviter_paid_at && !i.friend_paid_at && (await bal(SETTLE)) === before, "nothing paid, settlement untouched");
ok(Number((await one(`SELECT count(*) FROM admin_notifications WHERE link = '/referrals'`)).count) === 1, "admins notified once");
ok(!!(await one(`SELECT 1 AS x FROM notifications WHERE user_id = $1 AND type = 'invite_under_review'`, [U(10)])), "inviter told it is being checked");
await process_(); await process_();
ok(!(await inv(11)).inviter_paid_at && Number((await one(`SELECT count(*) FROM admin_notifications`)).count) === 1, "cron re-runs don't pay or re-notify");

console.log("\n2. approve pays at once");
const a = await review(11, true);
i = await inv(11);
ok(a.ok && a.approved && a.inviter_paid && a.friend_paid, `approve -> both paid (${JSON.stringify(a)})`);
ok(i.status === "rewarded" && i.reviewed_by === "tester", "invite rewarded, reviewer recorded");
ok((await bal(U(10))) === 50000 && (await bal(U(11))) === 20000, "inviter N500, friend N200 in their wallets");
ok((await review(11, true)).ok === false, "can't approve twice");

console.log("\n3. reject");
await user(12, "Bola Ade"); await claim(12, code); await openWallet(12); await spend(12, 250000); await process_();
ok((await review(12, false)).error === "Give a reason for rejecting", "reject needs a reason");
const rj = await review(12, false, "same phone as inviter");
i = await inv(12);
ok(rj.ok && i.status === "rejected" && i.reject_reason === "admin_rejected" && i.review_note === "same phone as inviter", "rejected with the admin's note");
await process_();
ok(!(await inv(12)).friend_paid_at && (await bal(U(12))) === 0, "rejected invite is never paid");
ok(!!(await one(`SELECT 1 AS x FROM notifications WHERE user_id = $1 AND type = 'invite_rejected'`, [U(10)])), "inviter told it wasn't approved");

console.log("\n4. approved while settlement is short -> paid later by the cron");
await user(13, "Ngozi Obi"); await claim(13, code); await openWallet(13); await spend(13, 250000); await process_();
await setSettle(0);
const s = await review(13, true);
ok(s.ok && !s.inviter_paid, "approved but not paid yet (settlement empty)");
await setSettle(1000000); await process_();
ok((await inv(13)).status === "rewarded", "paid once settlement is funded");

console.log("\n5. re-running the migration");
await db.exec(fs.readFileSync(MIG, "utf8"));
ok(true, "migration is re-runnable");

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
