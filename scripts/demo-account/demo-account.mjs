// Creates, refreshes or locks the fictional demo business that Google Play's reviewers sign in with ("App access" in the Play Console).
//
//   ACTION=create   make the account if it does not exist, set its password, and (re)fill it with fictional data
//   ACTION=disable  lock it: random password + banned (use this after the review)
//
// Run by .github/workflows/demo-account.yml with secrets in the environment. Nothing secret is ever printed, and every write is scoped to the ONE
// user whose email is DEMO_EMAIL, so it cannot touch a real customer's rows.
import { randomBytes } from "node:crypto";
import { DEMO_EMAIL, DEMO_BUSINESS, DEMO_APP_PIN, DEMO_TXN_PIN, buildProfile, buildProducts, buildCustomers, buildCredits, buildTransactions } from "./seed.mjs";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON, DEMO_PASSWORD, ACTION = "create" } = process.env;
if (!SUPABASE_URL || !SERVICE || !ANON) fail("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY are required");
if (ACTION === "create" && (!DEMO_PASSWORD || DEMO_PASSWORD.length < 10)) fail("DEMO_PASSWORD (the DEMO_REVIEWER_PASSWORD secret) is missing or too short");

function fail(msg) { console.error("ERROR:", msg); process.exit(1); }
const say = (...a) => console.log(...a);

async function api(method, path, body, headers = {}) {
  const res = await fetch(SUPABASE_URL + path, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...headers },
  });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: res.status, ok: res.ok, json, text: text.slice(0, 300) };
}
const must = (r, what) => { if (!r.ok) fail(`${what} failed (HTTP ${r.status}): ${r.json?.message || r.json?.msg || r.json?.error_description || r.text}`); return r; };

// ── the demo user (found by email — no other user is ever touched) ─────────────────────────────────────────
async function findUserId() {
  for (let page = 1; page <= 50; page++) {
    const r = must(await api("GET", `/auth/v1/admin/users?page=${page}&per_page=200`), "list users");
    const users = r.json?.users || [];
    const hit = users.find((u) => (u.email || "").toLowerCase() === DEMO_EMAIL);
    if (hit) return hit.id;
    if (users.length < 200) return null;
  }
  return null;
}

async function ensureUser(password) {
  let id = await findUserId();
  if (!id) {
    const r = await api("POST", "/auth/v1/admin/users", { email: DEMO_EMAIL, password, email_confirm: true, user_metadata: { full_name: "Adaeze Okonkwo", demo: true } });
    if (r.ok) { id = r.json.id; say("created the demo login"); }
    else if (r.status === 422) { id = await findUserId(); }            // it exists after all (email_exists)
    if (!id) must(r, "create user");
  }
  must(await api("PUT", `/auth/v1/admin/users/${id}`, { password, email_confirm: true, ban_duration: "none", user_metadata: { full_name: "Adaeze Okonkwo", demo: true } }), "set password");
  return id;
}

// ── schema introspection: only send columns the table really has (PostgREST publishes them) ────────────────
let SCHEMA = null;
async function loadSchema() {
  const r = await fetch(SUPABASE_URL + "/rest/v1/", { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, Accept: "application/openapi+json" } });
  if (!r.ok) { say("(schema introspection unavailable — sending rows as-is)"); return; }
  const j = await r.json().catch(() => null);
  SCHEMA = j?.definitions || j?.components?.schemas || null;
}
const columnsOf = (table) => (SCHEMA?.[table]?.properties ? new Set(Object.keys(SCHEMA[table].properties)) : null);
const dropped = {};
function fit(table, rows) {
  const cols = columnsOf(table);
  if (!cols) return rows;
  return rows.map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) { if (cols.has(k)) out[k] = v; else (dropped[table] ||= new Set()).add(k); }
    return out;
  });
}
const tableKnown = (table) => !SCHEMA || !!SCHEMA[table];

async function insertRows(table, rows, batch = 150) {
  if (!rows.length) return 0;
  if (!tableKnown(table)) { say(`skipped ${table} (no such table)`); return 0; }
  let fitted = fit(table, rows);
  for (let i = 0; i < fitted.length; i += batch) {
    let r = await api("POST", `/rest/v1/${table}`, fitted.slice(i, i + batch), { Prefer: "return=minimal" });
    // a column the table computes itself (generated) cannot be written: drop it and try again
    for (let tries = 0; !r.ok && tries < 3; tries++) {
      const col = /column "([a-z_0-9]+)"/.exec(r.json?.message || "")?.[1];
      if (!col || !/generated|non-DEFAULT/i.test(r.json?.message || "")) break;
      (dropped[table] ||= new Set()).add(col);
      fitted = fitted.map((row) => { const { [col]: _omit, ...rest } = row; return rest; });
      r = await api("POST", `/rest/v1/${table}`, fitted.slice(i, i + batch), { Prefer: "return=minimal" });
    }
    must(r, `insert into ${table}`);
  }
  return fitted.length;
}
async function clearRows(table, col, id) {
  if (!tableKnown(table)) return;
  const cols = columnsOf(table);
  if (cols && !cols.has(col)) return;
  must(await api("DELETE", `/rest/v1/${table}?${col}=eq.${id}`, undefined, { Prefer: "return=minimal" }), `clear ${table}`);
}

// ── actions ────────────────────────────────────────────────────────────────────────────────────────────────
async function disable() {
  const id = await findUserId();
  if (!id) { say("no demo login exists — nothing to disable"); return; }
  must(await api("PUT", `/auth/v1/admin/users/${id}`, { password: randomBytes(24).toString("base64url"), ban_duration: "876000h" }), "lock user");
  say("demo login locked (random password, banned)");
}

async function create() {
  await loadSchema();
  const id = await ensureUser(DEMO_PASSWORD);
  say("demo user id:", id);

  // profile (upsert). email stays empty so no transaction/welcome emails are ever queued for the demo shop.
  must(await api("POST", "/rest/v1/profiles?on_conflict=id", fit("profiles", [buildProfile(id)]), { Prefer: "resolution=merge-duplicates,return=minimal" }), "upsert profile");
  await clearRows("welcome_email_queue", "user_id", id);     // the profile-insert trigger queues one, with an empty address
  await clearRows("email_automation_queue", "user_id", id);

  // top plan, active for over a year, so every feature is visible to the reviewer
  const plans = must(await api("GET", "/rest/v1/subscription_plans?select=slug,name,price_monthly&is_active=eq.true&order=price_monthly.desc&limit=1"), "read plans");
  const plan = plans.json?.[0];
  if (!plan) fail("no active subscription plan found");
  await clearRows("subscriptions", "user_id", id);
  await insertRows("subscriptions", [{ user_id: id, plan: plan.slug, status: "active", billing_cycle: "yearly", cancel_at_period_end: false, expires_at: new Date(Date.now() + 400 * 864e5).toISOString() }]);
  say("plan:", plan.slug, `(${plan.name})`);

  // fictional data — cleared first so a re-run does not double it
  for (const [table, col] of [["transactions", "user_id"], ["debt_payments", "owner_id"], ["credits", "user_id"], ["customers", "user_id"], ["products", "user_id"]]) await clearRows(table, col, id);
  const n = {};
  n.products = await insertRows("products", buildProducts(id));
  n.customers = await insertRows("customers", buildCustomers(id));
  const { credits, payments } = buildCredits(id);
  n.credits = await insertRows("credits", credits);
  n.debt_payments = await insertRows("debt_payments", payments);
  n.transactions = await insertRows("transactions", buildTransactions(id));
  say("seeded:", JSON.stringify(n));
  for (const [t, s] of Object.entries(dropped)) say(`  (${t}: columns not in the table, skipped: ${[...s].join(", ")})`);

  // known PINs, set through the app's own pin-manager so the hashing is exactly what the app expects
  const login = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }) });
  const session = await login.json().catch(() => ({}));
  if (!login.ok || !session.access_token) fail(`the demo login could not sign in with the stored password (HTTP ${login.status}) — check the DEMO_REVIEWER_PASSWORD secret and the project's password rules`);
  for (const [action, pin] of [["setup_app_pin", DEMO_APP_PIN], ["setup_txn_pin", DEMO_TXN_PIN]]) {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/pin-manager`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action, pin }) });
    const j = await r.json().catch(() => ({}));
    if (!j.success) fail(`${action} failed: ${j.error || "HTTP " + r.status}`);
  }
  say("PINs set");

  // read it back the way the app will (a sanity check that the account really is complete)
  const prof = must(await api("GET", `/rest/v1/profiles?id=eq.${id}&select=business_name,verification_status,app_pin_hash,txn_pin_hash`), "read profile back").json?.[0];
  const sub = must(await api("GET", `/rest/v1/subscriptions?user_id=eq.${id}&status=eq.active&select=plan`), "read subscription back").json?.[0];
  if (prof?.business_name !== DEMO_BUSINESS || prof?.verification_status !== "tier2_verified" || !prof?.app_pin_hash || !prof?.txn_pin_hash || !sub) fail("read-back check failed: the demo account is not complete");
  say(`ready: ${DEMO_EMAIL} · ${DEMO_BUSINESS} · verified · plan ${sub.plan}`);
}

if (ACTION === "create") await create();
else if (ACTION === "disable") await disable();
else fail(`unknown ACTION "${ACTION}"`);
