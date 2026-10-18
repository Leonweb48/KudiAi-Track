// Run: npm i --no-save @electric-sql/pglite@0.2.17 && node tests/subscriptions/expiry.pglite.mjs supabase/migrations/20270348000000_subscription_expiry.sql
// Real-Postgres (PGlite) test of the owner plan expiry sweep: reminders, grace, downgrade, cancelled plans, the
// overdue-at-ship backfill, renewal reset, and the guard that stops owners editing their own end date.
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";

const MIG = process.argv[2];
const db = new PGlite();
let fails = 0, passes = 0;
const ok = (cond, msg) => { if (cond) { passes++; console.log("  ✓", msg); } else { fails++; console.log("  ✗", msg); } };
const q = async (sql, p) => (await db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];

await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA cron; CREATE TABLE cron.job (jobid serial, jobname text);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS int LANGUAGE sql AS $$ INSERT INTO cron.job(jobname) VALUES (n) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(n text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname = n RETURNING true $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE TABLE subscription_plans (slug text PRIMARY KEY, name text, price_monthly numeric, price_yearly numeric, sort_order int, is_active boolean DEFAULT true);
INSERT INTO subscription_plans VALUES ('kobo', 'Free', 0, 0, 0), ('naira', 'Standard', 3000, 30000, 1), ('enterprise', 'Premium', 7500, 75000, 2);
CREATE TABLE wallets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, balance_kobo bigint NOT NULL DEFAULT 0, status text DEFAULT 'active');
CREATE TABLE wallet_ledger (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), wallet_id uuid, user_id uuid, direction text, amount_kobo bigint,
  balance_after_kobo bigint, source text, status text, narration text, created_at timestamptz DEFAULT now());
CREATE TABLE subscriptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, plan text, status text DEFAULT 'active',
  expires_at timestamptz, cancel_at_period_end boolean DEFAULT false, cancelled_at timestamptz, billing_cycle text DEFAULT 'monthly',
  created_at timestamptz DEFAULT now(), paystack_reference text, wallet_ledger_id uuid);
CREATE TABLE notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, type text, category text, title text, body text, deep_link jsonb,
  priority text, dedupe_key text, read_at timestamptz, created_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX notifications_dedupe_key_unread ON notifications (dedupe_key) WHERE read_at IS NULL AND dedupe_key IS NOT NULL;
`);
// is_free_plan + the original guard trigger, exactly as in production
const base = fs.readFileSync("supabase/migrations/20261202000000_subscription_admin_approval.sql", "utf8");
await db.exec(base.slice(base.indexOf("CREATE OR REPLACE FUNCTION public.is_free_plan"), base.indexOf("-- ── 4.")));
const dguard = fs.readFileSync("supabase/migrations/20270112000000_subscription_downgrade_guard.sql", "utf8");
await db.exec(dguard.slice(dguard.indexOf("CREATE OR REPLACE FUNCTION public.assert_downgrade_allowed"), dguard.indexOf("-- ── activate_free_subscription")));

const U = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const sub = (n, plan, days, extra = {}) => q(`INSERT INTO subscriptions (user_id, plan, expires_at, cancel_at_period_end) VALUES ($1, $2, now() + ($3::float8 * interval '1 day'), $4)`,
  [U(n), plan, days, !!extra.cancelled]);
const row = (n) => one(`SELECT * FROM subscriptions WHERE user_id = $1`, [U(n)]);
const notes = async (n) => (await q(`SELECT type FROM notifications WHERE user_id = $1 ORDER BY created_at`, [U(n)])).map((r) => r.type);
const shift = (n, days) => q(`UPDATE subscriptions SET expires_at = expires_at - ($2::float8 * interval '1 day'), grace_until = grace_until - ($2::float8 * interval '1 day') WHERE user_id = $1`, [U(n), days]);
const sweep = async () => (await one(`SELECT public.subscription_expiry_sweep() AS r`)).r;

// state BEFORE the migration ships
await sub(1, "enterprise", 20);           // running normally
await sub(2, "enterprise", -4);           // already 4 days past its end (like production)
await sub(3, "naira", 2.5);               // ends in 2.5 days
await sub(4, "kobo", null);               // free, no end date
await sub(5, "enterprise", -1, { cancelled: true });   // cancelled and over
await db.exec(fs.readFileSync(MIG, "utf8"));
console.log("migration applied (first sweep ran inside it)");

console.log("\n1. overdue at ship time: 3 days from today, not instantly downgraded");
let r2 = await row(2);
ok(r2.plan === "enterprise", "still Premium right after the release");
ok(r2.grace_until && Math.abs(new Date(r2.grace_until) - (Date.now() + 3 * 864e5)) < 60e3, "grace ends 3 days from now");
ok((await notes(2)).includes("plan_ended"), "told the plan has ended");

console.log("\n2. reminders");
ok(JSON.stringify(await notes(3)) === JSON.stringify(["plan_ending"]), "3-day reminder sent to the plan ending in 2.5 days");
ok((await notes(1)).length === 0, "nothing for a plan ending in 20 days");
await sweep(); await sweep();
ok((await notes(3)).length === 1, "reminder not repeated on later sweeps");
await q(`UPDATE notifications SET read_at = now() WHERE user_id = $1`, [U(3)]); await sweep();
ok((await notes(3)).length === 1, "not repeated after the owner READ it either (marks on the row, not the unread index)");
await shift(3, 2); await sweep();
ok((await notes(3)).filter((t) => t === "plan_ending").length === 2, "1-day reminder sent when < 24 h left");
await sweep();
ok((await notes(3)).filter((t) => t === "plan_ending").length === 2, "1-day reminder once");

console.log("\n3. end date → grace → Free");
await shift(3, 1); await sweep();
let r3 = await row(3);
ok(r3.plan === "naira" && r3.grace_until, "after the end date: still Standard, in grace");
ok((await notes(3)).includes("plan_ended"), "plan-ended notice");
await shift(3, 3.1); await sweep();
r3 = await row(3);
ok(r3.plan === "kobo" && r3.expires_at === null && r3.grace_until === null, "after 3 days of grace: moved to Free, dates cleared");
ok((await notes(3)).includes("plan_downgraded"), "moved-to-Free notice");

console.log("\n4. cancelled plans go to Free at the end date, no grace");
const r5 = await row(5);
ok(r5.plan === "kobo", "cancelled + over → Free on the first sweep");
ok((await notes(5)).includes("plan_downgraded"), "told");

console.log("\n5. renewing during grace starts a clean period");
await q(`UPDATE subscriptions SET expires_at = now() + interval '30 days' WHERE user_id = $1`, [U(2)]);
r2 = await row(2);
ok(r2.grace_until === null && r2.plan === "enterprise", "new end date clears the grace");
await sweep();
ok((await row(2)).plan === "enterprise", "renewed owner stays on Premium");

console.log("\n6. free plans and running plans untouched");
ok((await row(4)).plan === "kobo" && (await notes(4)).length === 0, "free plan: nothing");
ok((await row(1)).plan === "enterprise" && (await row(1)).grace_until === null, "running plan untouched");

console.log("\n6b. renewing the same plan early keeps the days left");
await sub(6, "naira", 5);
await q(`INSERT INTO wallets (user_id, balance_kobo) VALUES ($1, 1000000)`, [U(6)]);
await db.exec(`SELECT set_config('test.uid', '${U(6)}', false)`);
await q(`SELECT public.wallet_pay_subscription('naira', 'monthly', NULL)`);
const days6 = (new Date((await row(6)).expires_at) - Date.now()) / 864e5;
ok(days6 > 34.9 && days6 < 35.1, `renewed 5 days early → ends in 35 days (got ${days6.toFixed(2)})`);
ok(Number((await one(`SELECT balance_kobo FROM wallets WHERE user_id = $1`, [U(6)])).balance_kobo) === 700000, "charged once, ₦3,000");
await sub(7, "naira", 5);
await q(`INSERT INTO wallets (user_id, balance_kobo) VALUES ($1, 1000000)`, [U(7)]);
await db.exec(`SELECT set_config('test.uid', '${U(7)}', false)`);
await q(`SELECT public.wallet_pay_subscription('enterprise', 'monthly', NULL)`);
const days7 = (new Date((await row(7)).expires_at) - Date.now()) / 864e5;
ok(days7 > 29.9 && days7 < 30.1 && (await row(7)).plan === "enterprise", `upgrading to another plan starts today (got ${days7.toFixed(2)})`);
await db.exec(`SELECT set_config('test.uid', '', false)`);

console.log("\n7. guard: an owner's own login can't move their end date");
await db.exec(`GRANT USAGE ON SCHEMA public TO authenticated; GRANT SELECT, UPDATE ON subscriptions TO authenticated; GRANT SELECT ON subscription_plans TO authenticated;`);
await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', false);`);
let blocked = false;
try { await db.exec(`UPDATE subscriptions SET expires_at = '2099-01-01' WHERE user_id = '${U(1)}'`); } catch (e) { blocked = /Plan dates/.test(e.message); if (!blocked) console.log('    err:', e.message); }
ok(blocked, "UPDATE expires_at on a paid plan → refused");
blocked = false;
try { await db.exec(`UPDATE subscriptions SET grace_until = '2099-01-01' WHERE user_id = '${U(2)}'`); } catch (e) { blocked = /Plan dates/.test(e.message); if (!blocked) console.log('    err:', e.message); }
ok(blocked, "UPDATE grace_until → refused");
let allowed = true;
try { await db.exec(`UPDATE subscriptions SET cancel_at_period_end = true, cancelled_at = now() WHERE user_id = '${U(1)}'`); } catch (e) { allowed = false; console.log('    err:', e.message); }
ok(allowed, "cancelling (toggle) still allowed");
allowed = true;
try { await db.exec(`UPDATE subscriptions SET plan = 'kobo', expires_at = NULL WHERE user_id = '${U(1)}'`); } catch (e) { allowed = false; console.log('    err:', e.message); }
ok(allowed, "moving yourself to Free still allowed");
await db.exec(`RESET ROLE`);

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
