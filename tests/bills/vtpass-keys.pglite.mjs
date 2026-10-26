// Run (from the repo root, with @electric-sql/pglite@0.2.17 installed):
//   node tests/bills/vtpass-keys.pglite.mjs
// Real-Postgres (PGlite) test of migration 20270430000000 (VTpass set up from the admin portal): keys saved into Vault
// (a stand-in with Supabase Vault's functions), read back only by the service role, replaced, cleared; the Live/Sandbox
// switch; bad keys refused; the migration's own Vault self-test; the Bills account report now checks VTpass's wallet.
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
-- a stand-in for Supabase Vault: the same function names and shapes (the real one encrypts at rest)
CREATE SCHEMA vault;
CREATE TABLE vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, secret text, description text);
CREATE VIEW vault.decrypted_secrets AS SELECT id, name, secret AS decrypted_secret, description FROM vault.secrets;
CREATE FUNCTION vault.create_secret(new_secret text, new_name text DEFAULT NULL, new_description text DEFAULT '') RETURNS uuid LANGUAGE sql AS
  $$ INSERT INTO vault.secrets (secret, name, description) VALUES (new_secret, new_name, new_description) RETURNING id $$;
CREATE FUNCTION vault.update_secret(secret_id uuid, new_secret text DEFAULT NULL) RETURNS void LANGUAGE sql AS
  $$ UPDATE vault.secrets SET secret = COALESCE(new_secret, secret) WHERE id = secret_id $$;
REVOKE ALL ON SCHEMA vault FROM PUBLIC;
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
for (const f of ["20270223000000_finance_ledger.sql", "20270224000000_finance_flw_fee_estimate.sql", "20270428000000_bills_account.sql"]) await db.exec(mig(f));
await db.exec(mig("20270430000000_vtpass_admin_setup.sql"));
ok(Number((await one(`SELECT count(*) AS n FROM vault.secrets`)).n) === 0, "migration: its Vault self-test ran and left nothing behind");
ok((await one(`SELECT env, api_key_last4 FROM vtpass_settings`)).env === "sandbox", "starts on Sandbox with no keys");
ok((await one(`SELECT value FROM platform_config WHERE key = 'vtpass_via_relay'`)).value === "false", "fixed-IP route off by default");

const save = async (env, a, s, p, who = "owner") => (await one(`SELECT public.vtpass_save_keys($1, $2, $3, $4, $5) AS r`, [env, a, s, p, who])).r;
const cfg = async () => (await one(`SELECT public.vtpass_get_config() AS r`)).r;

let r = await save("live", "short", "abcdefghijkl", null);
ok(r.ok === false && /8–200/.test(r.error), "a too-short key is refused", J(r));
r = await save("live", "abc def ghij", "abcdefghijkl", null);
ok(r.ok === false, "a key with spaces is refused");
r = await save("live", "SAMEKEY12345", "SAMEKEY12345", null);
ok(r.ok === false && /same/.test(r.error), "the same key pasted twice is refused", J(r));
r = await save("prod", "LIVEAPIKEY0001", "LIVESECRET0001", null);
ok(r.ok === false, "an unknown environment is refused");
r = await (await one(`SELECT public.vtpass_set_env('live', 'owner') AS r`)).r;
ok(r.ok === false && /keys first/.test(r.error), "Live can't be switched on before keys are saved", J(r));
ok((await cfg()).saved === false, "nothing saved yet");

r = await save("live", " LIVEAPIKEY0001 ", "LIVESECRET0001", "PK_LIVEPUBLIC01");
let c = await cfg();
ok(r.ok && c.saved && c.env === "live" && c.api_key === "LIVEAPIKEY0001" && c.secret_key === "LIVESECRET0001" && c.public_key === "PK_LIVEPUBLIC01",
  "live keys saved (trimmed) and read back by the function", J(c));
let st = await one(`SELECT * FROM vtpass_settings`);
ok(st.api_key_last4 === "0001" && st.secret_key_last4 === "0001" && st.public_key_last4 === "IC01" && st.keys_saved_by === "owner" && st.env === "live",
  "the admin page sees only the last 4 characters, who saved them and when", J(st));
ok(Number((await one(`SELECT count(*) AS n FROM vault.secrets WHERE name LIKE 'vtpass%'`)).n) === 3, "three secrets in Vault");

r = await save("live", "LIVEAPIKEY0002", "LIVESECRET0002", null);
c = await cfg();
ok(c.api_key === "LIVEAPIKEY0002" && c.public_key === null && Number((await one(`SELECT count(*) AS n FROM vault.secrets WHERE name LIKE 'vtpass%'`)).n) === 2,
  "keys replaced; a public key left out is removed (not kept from before)", J(c));

r = (await one(`SELECT public.vtpass_set_env('sandbox', 'finance1') AS r`)).r;
c = await cfg();
ok(r.ok && c.env === "sandbox" && c.api_key === "LIVEAPIKEY0002", "kill switch: Sandbox, keys kept", J(c));
r = (await one(`SELECT public.vtpass_set_env('live', 'owner') AS r`)).r;
ok(r.ok && (await cfg()).env === "live", "…and back to Live");
st = await one(`SELECT env_set_by FROM vtpass_settings`);
ok(st.env_set_by === "owner", "who switched it is recorded");

r = (await one(`SELECT public.vtpass_clear_keys('owner') AS r`)).r;
c = await cfg();
ok(r.ok && c.saved === false && Number((await one(`SELECT count(*) AS n FROM vault.secrets`)).n) === 0 && (await one(`SELECT env FROM vtpass_settings`)).env === "sandbox",
  "clear: keys gone from Vault, back on Sandbox", J(c));

// only the service role
for (const role of ["anon", "authenticated"]) {
  await q(`SET ROLE ${role}`);
  const errs = [];
  for (const sql of [`SELECT public.vtpass_get_config()`, `SELECT public.vtpass_save_keys('live','AAAAAAAAAA','BBBBBBBBBB',NULL,'x')`,
    `SELECT public.vtpass_set_env('sandbox','x')`, `SELECT public.vtpass_clear_keys('x')`, `SELECT * FROM public.vtpass_settings`, `SELECT public._vtpass_vault_put('a','b')`]) {
    try { await q(sql); errs.push(null); } catch (e) { errs.push(e.message); }
  }
  await q(`RESET ROLE`);
  ok(errs.every((e) => /permission denied/.test(e ?? "")), `${role}: no access to any VTpass key function or the settings`, J(errs));
}
await q(`SET ROLE service_role`);
let svcErr = null;
try { await q(`SELECT public._vtpass_vault_put('vtpass_api_key', 'x')`); } catch (e) { svcErr = e.message; }
await q(`RESET ROLE`);
ok(/permission denied/.test(svcErr ?? ""), "even the service role can't write Vault directly (only through the checked functions)", svcErr);

// Bills account: VTpass's wallet checked too
await q(`INSERT INTO bill_provider_balances (provider, balance_kobo, observed_at) VALUES ('vtpass', 1000000, now() - interval '5 hours'), ('vtpass', 700000, now() - interval '10 minutes')`);
const rep = (await one(`SELECT public.finance_bills_report(now() - interval '6 hours', now()) AS r`)).r;
const vt = rep.wallets.find((w) => w.provider === "vtpass");
ok(rep.wallets.length === 3 && vt && Number(vt.spent_kobo) === 300000 && Number(vt.topups_kobo) === 0, "Bills account: VTpass's wallet checked like ClubKonnect's and Bigisub's", J(rep.wallets));

console.log(fails ? `\n${fails} of ${fails + passes} checks FAILED` : `\nall ${passes} checks passed`);
process.exit(fails ? 1 : 0);
