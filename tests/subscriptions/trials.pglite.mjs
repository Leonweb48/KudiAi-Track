// Run (from the repo root, with @electric-sql/pglite@0.2.17 installed):
//   node tests/subscriptions/trials.pglite.mjs
// Real-Postgres (PGlite) test of plan trials (migration 20270425000000): an admin gives an owner a free trial of a paid
// plan; it ends by itself (no grace) back on the previous plan; paying during it makes it a paid plan; owners can't
// touch the trial fields; the paid-plan sweep leaves trials alone.
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";

const db = new PGlite();
let fails = 0, passes = 0;
const ok = (cond, msg, x = "") => { if (cond) { passes++; console.log("  ✓", msg); } else { fails++; console.log("  ✗", msg, x); } };
const q = async (sql, p) => (await db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];

await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA cron; CREATE TABLE cron.job (jobid serial, jobname text);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS int LANGUAGE sql AS $$ INSERT INTO cron.job(jobname) VALUES (n) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(n text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname = n RETURNING true $$;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO authenticated;
CREATE TABLE subscription_plans (slug text PRIMARY KEY, name text, price_monthly numeric, price_yearly numeric, sort_order int, is_active boolean DEFAULT true);
INSERT INTO subscription_plans VALUES ('kobo', 'Free', 0, 0, 0), ('naira', 'Standard', 3000, 30000, 1), ('enterprise', 'Premium', 7500, 75000, 2);
CREATE TABLE profiles (id uuid PRIMARY KEY, business_name text);
CREATE TABLE wallets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, balance_kobo bigint NOT NULL DEFAULT 0, status text DEFAULT 'active');
CREATE TABLE wallet_ledger (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), wallet_id uuid, user_id uuid, direction text, amount_kobo bigint,
  balance_after_kobo bigint, source text, status text, narration text, created_at timestamptz DEFAULT now());
CREATE TABLE subscriptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, plan text, status text DEFAULT 'active',
  expires_at timestamptz, cancel_at_period_end boolean DEFAULT false, cancelled_at timestamptz, billing_cycle text DEFAULT 'monthly',
  created_at timestamptz DEFAULT now(), paystack_reference text, wallet_ledger_id uuid);
GRANT SELECT, INSERT, UPDATE ON subscriptions TO authenticated;
CREATE TABLE notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, type text, category text, title text, body text, deep_link jsonb,
  priority text, dedupe_key text, read_at timestamptz, created_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX notifications_dedupe_key_unread ON notifications (dedupe_key) WHERE read_at IS NULL AND dedupe_key IS NOT NULL;
`);
const base = fs.readFileSync("supabase/migrations/20261202000000_subscription_admin_approval.sql", "utf8");
await db.exec(base.slice(base.indexOf("CREATE OR REPLACE FUNCTION public.is_free_plan"), base.indexOf("-- ── 4.")));
const dguard = fs.readFileSync("supabase/migrations/20270112000000_subscription_downgrade_guard.sql", "utf8");
await db.exec(dguard.slice(dguard.indexOf("CREATE OR REPLACE FUNCTION public.assert_downgrade_allowed"), dguard.indexOf("-- ── activate_free_subscription")));
await db.exec(fs.readFileSync("supabase/migrations/20270348000000_subscription_expiry.sql", "utf8"));
await db.exec(fs.readFileSync("supabase/migrations/20270425000000_plan_trials.sql", "utf8"));
await db.exec(fs.readFileSync("supabase/migrations/20270425000000_plan_trials.sql", "utf8"));   // re-runnable
console.log("migrations applied");

const U = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
for (let i = 1; i <= 7; i++) await q(`INSERT INTO auth.users VALUES ($1); INSERT INTO profiles VALUES ($1, 'Shop ' || $2)`.split(";")[0], [U(i)]).then(() => q(`INSERT INTO profiles VALUES ($1, $2)`, [U(i), `Shop ${i}`]));
const sub = (n, plan, days) => q(`INSERT INTO subscriptions (user_id, plan, expires_at) VALUES ($1, $2, CASE WHEN $3::float8 IS NULL THEN NULL ELSE now() + ($3::float8 * interval '1 day') END)`, [U(n), plan, days]);
const row = (n) => one(`SELECT * FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [U(n)]);
const trial = (n) => one(`SELECT * FROM plan_trials WHERE user_id = $1 ORDER BY started_at DESC LIMIT 1`, [U(n)]);
const notes = async (n) => (await q(`SELECT type FROM notifications WHERE user_id = $1 ORDER BY created_at`, [U(n)])).map((r) => r.type);
const grant = async (n, plan, days = 5) => (await one(`SELECT public.admin_grant_plan_trial($1, $2, $3, 'ada.admin', 'test') r`, [U(n), plan, days])).r;
// time passing: move the end date as housekeeping (kudi.trial_write) — any OTHER change to a trial's end date is a payment
const shift = async (n, days) => {
  await db.exec(`SELECT set_config('kudi.trial_write', '1', false)`);
  await q(`UPDATE subscriptions SET expires_at = expires_at - ($2::float8 * interval '1 day') WHERE user_id = $1`, [U(n), days]);
  await db.exec(`SELECT set_config('kudi.trial_write', '', false)`);
};

await sub(1, "kobo", null);          // free owner
await sub(2, "enterprise", 20);      // paying owner
await sub(4, "kobo", null);
await sub(5, "kobo", null);
await sub(6, "kobo", null);
// owner 3 has no subscription row at all

let r = await grant(1, "enterprise");
let s = await row(1);
ok(r.ok && s.plan === "enterprise" && s.is_trial && s.trial_previous_plan === "kobo" && Math.round((new Date(s.expires_at) - Date.now()) / 864e5) === 5,
  "a free owner gets 5 days of Premium, previous plan remembered", JSON.stringify([r, s]));
ok((await notes(1)).includes("plan_trial_started"), "…and is told");
ok(!(await grant(1, "naira")).ok, "one trial at a time");
r = await grant(2, "enterprise");
ok(!r.ok && /paid plan/.test(r.error), "an owner on a running paid plan can't be given a trial", JSON.stringify(r));
r = await grant(3, "naira", 7);
s = await row(3);
ok(r.ok && s && s.plan === "naira" && s.is_trial, "an owner with no plan row gets one (7-day Standard)", JSON.stringify([r, s]));
ok(!(await grant(4, "kobo")).ok && !(await grant(4, "nope")).ok && !(await grant(4, "naira", 0)).ok && !(await grant(4, "naira", 31)).ok,
  "free plan / unknown plan / 0 or 31 days are refused");

// owners can't touch the trial fields
await db.exec(`SET test.uid = '${U(1)}'; SET request.jwt.claims = '{"role":"authenticated"}'; SET ROLE authenticated;`);
await db.exec(`UPDATE subscriptions SET trial_previous_plan = 'enterprise', is_trial = false WHERE user_id = '${U(1)}'`);
await db.exec(`RESET ROLE; RESET request.jwt.claims;`);
s = await row(1);
ok(s.is_trial && s.trial_previous_plan === "kobo", "an owner can't change the trial fields (e.g. 'previous plan' to a paid one)", JSON.stringify(s));

// the paid-plan sweep leaves trials alone (no 3-day grace, no paid-plan reminders)
await shift(1, 4.5);   // ends in half a day
await one(`SELECT public.subscription_expiry_sweep()`);
s = await row(1);
ok(s.grace_until === null && !(await notes(1)).some((t) => t === "plan_ending" || t === "plan_ended"), "the paid-plan sweep doesn't touch a trial", JSON.stringify(s));
await one(`SELECT public.plan_trial_sweep()`);
ok((await notes(1)).filter((t) => t === "plan_ending").length === 1 && (await trial(1)).reminded_1d, "a day before the end: one reminder");
await one(`SELECT public.plan_trial_sweep()`);
ok((await notes(1)).filter((t) => t === "plan_ending").length === 1, "…only once");
await shift(1, 1);   // now past the end
await one(`SELECT public.plan_trial_sweep()`);
s = await row(1);
let t = await trial(1);
ok(s.plan === "kobo" && !s.is_trial && s.expires_at === null && s.grace_until === null && t.end_reason === "expired" && t.ended_by === "system",
  "at the end: straight back to Free, no grace, recorded as expired", JSON.stringify([s, t]));
ok((await notes(1)).includes("plan_trial_ended"), "…and told");

// paying during a trial makes it a paid plan
await grant(5, "naira");
await db.exec(`SELECT set_config('kudi.allow_plan_write', '1', false)`);
await q(`UPDATE subscriptions SET expires_at = expires_at + interval '30 days' WHERE user_id = $1`, [U(5)]);   // what a payment does
await db.exec(`SELECT set_config('kudi.allow_plan_write', '', false)`);
s = await row(5); t = await trial(5);
ok(!s.is_trial && s.plan === "naira" && t.end_reason === "converted_to_paid", "a payment during the trial turns it into a paid plan", JSON.stringify([s, t]));
await shift(5, 40);
await one(`SELECT public.plan_trial_sweep()`);
ok((await row(5)).plan === "naira", "…which the trial sweep then leaves alone (the paid-plan rules apply)");

// the admin ends one early
await grant(6, "enterprise");
r = (await one(`SELECT public.admin_end_plan_trial($1, 'ada.admin') r`, [U(6)])).r;
s = await row(6); t = await trial(6);
ok(r.ok && s.plan === "kobo" && !s.is_trial && t.end_reason === "ended_by_admin" && t.ended_by === "ada.admin", "the admin can end a trial early", JSON.stringify([r, s, t]));
ok(!(await one(`SELECT public.admin_end_plan_trial($1, 'x') r`, [U(6)])).r.ok, "…ending it twice is refused");
r = await grant(6, "naira");
ok(r.ok && r.previous_trials === 1, "a second trial can be given later, and the admin sees how many came before", JSON.stringify(r));

// who may call these
const g = await one(`SELECT has_function_privilege('authenticated', 'admin_grant_plan_trial(uuid,text,integer,text,text)', 'EXECUTE') a,
  has_function_privilege('authenticated', 'admin_end_plan_trial(uuid,text)', 'EXECUTE') b, has_table_privilege('authenticated', 'plan_trials', 'SELECT') c,
  has_function_privilege('service_role', 'admin_grant_plan_trial(uuid,text,integer,text,text)', 'EXECUTE') d`);
ok(!g.a && !g.b && !g.c && g.d, "only the server can grant, end or list trials", JSON.stringify(g));
ok((await one(`SELECT count(*)::int n FROM cron.job WHERE jobname = 'plan-trial-sweep'`)).n === 1, "the hourly trial sweep is scheduled");

console.log(fails ? `${fails} FAILED, ${passes} passed` : `all ${passes} passed`);
process.exit(fails ? 1 : 0);
