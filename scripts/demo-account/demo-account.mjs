// Creates, refreshes or locks the fictional accounts used for the Google Play launch. Two accounts, both fictional, both scoped by email:
//
//   REVIEWER  demo.reviewer@kudiai.app — what Play's reviewers sign in with ("App access"); Premium plan, verified, full sample data
//     ACTION=create            make it if missing, set its password, (re)fill it with fictional data
//     ACTION=disable           lock it: random password + banned (use after the review)
//
//   TESTER    test.upgrade@kudiai.app — a FREE-plan account for trying "register in the Android app, upgrade elsewhere, the app unlocks"
//     ACTION=tester-create     make it / reset it to the free plan
//     ACTION=tester-upgrade    switch its subscription to the top paid plan (what a web upgrade does to the row)
//     ACTION=tester-downgrade  put it back on the free plan
//     ACTION=tester-stock-ping rename one of its products (a server-side stock change, to check that an open app updates live)
//     ACTION=tester-disable    lock it
//
// Run by .github/workflows/demo-account.yml with secrets in the environment. Nothing secret is ever printed, and every write is scoped to the ONE user
// whose email is the account's own, so it cannot touch a real customer's rows.
import { randomBytes } from "node:crypto";
import {
  DEMO_EMAIL, DEMO_BUSINESS, TESTER_EMAIL, TESTER_BUSINESS, DEMO_APP_PIN, DEMO_TXN_PIN,
  buildProfile, buildTesterProfile, buildProducts, buildCustomers, buildCredits, buildTransactions,
} from "./seed.mjs";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON, DEMO_PASSWORD, TESTER_PASSWORD, ACTION = "create" } = process.env;

const ACCOUNTS = {
  reviewer: { email: DEMO_EMAIL, password: DEMO_PASSWORD, secret: "DEMO_REVIEWER_PASSWORD", business: DEMO_BUSINESS, profile: buildProfile, plan: "top", days: 30, name: "Adaeze Okonkwo" },
  tester: { email: TESTER_EMAIL, password: TESTER_PASSWORD, secret: "DEMO_TESTER_PASSWORD", business: TESTER_BUSINESS, profile: buildTesterProfile, plan: "free", days: 5, name: "Test Owner" },
};
const KIND = ACTION.startsWith("tester-") ? "tester" : "reviewer";
const ACCT = ACCOUNTS[KIND];
const VERB = ACTION.replace(/^tester-/, "");

function fail(msg) { console.error("ERROR:", msg); process.exit(1); }
const say = (...a) => console.log(...a);
if (!SUPABASE_URL || !SERVICE || !ANON) fail("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY are required");
if (["create"].includes(VERB) && (!ACCT.password || ACCT.password.length < 10)) fail(`the ${ACCT.secret} secret is missing or too short`);

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

// ── the account's user (found by email — no other user is ever touched) ────────────────────────────────────
async function findUserId() {
  for (let page = 1; page <= 50; page++) {
    const r = must(await api("GET", `/auth/v1/admin/users?page=${page}&per_page=200`), "list users");
    const users = r.json?.users || [];
    const hit = users.find((u) => (u.email || "").toLowerCase() === ACCT.email);
    if (hit) return hit.id;
    if (users.length < 200) return null;
  }
  return null;
}

async function ensureUser(password) {
  let id = await findUserId();
  const meta = { full_name: ACCT.name, demo: true };
  if (!id) {
    const r = await api("POST", "/auth/v1/admin/users", { email: ACCT.email, password, email_confirm: true, user_metadata: meta });
    if (r.ok) { id = r.json.id; say("created the login"); }
    else if (r.status === 422) { id = await findUserId(); }            // it exists after all (email_exists)
    if (!id) must(r, "create user");
  }
  must(await api("PUT", `/auth/v1/admin/users/${id}`, { password, email_confirm: true, ban_duration: "none", user_metadata: meta }), "set password");
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

// ── plans ──────────────────────────────────────────────────────────────────────────────────────────────────
async function planSlug(which) {
  const q = which === "free"
    ? "/rest/v1/subscription_plans?select=slug,name,price_monthly&is_active=eq.true&price_monthly=eq.0&order=sort_order.asc&limit=1"
    : "/rest/v1/subscription_plans?select=slug,name,price_monthly&is_active=eq.true&order=price_monthly.desc&limit=1";
  const plan = must(await api("GET", q), "read plans").json?.[0];
  if (!plan) fail(`no active ${which} subscription plan found`);
  return plan;
}

/** Point the account's ONE subscription row at a plan — the same UPDATE a paid or free change makes (so realtime fires in an open app). */
async function setPlan(id, which) {
  const plan = await planSlug(which);
  const row = must(await api("GET", `/rest/v1/subscriptions?user_id=eq.${id}&select=id&order=created_at.desc&limit=1`), "read subscription").json?.[0];
  const paid = which !== "free";
  const patch = paid
    ? { plan: plan.slug, status: "active", billing_cycle: "monthly", cancel_at_period_end: false, cancelled_at: null, expires_at: new Date(Date.now() + 30 * 864e5).toISOString() }
    : { plan: plan.slug, status: "active", billing_cycle: "monthly", cancel_at_period_end: false, cancelled_at: null, expires_at: null };
  if (row) must(await api("PATCH", `/rest/v1/subscriptions?id=eq.${row.id}`, patch, { Prefer: "return=minimal" }), "update subscription");
  else must(await api("POST", "/rest/v1/subscriptions", { user_id: id, ...patch }, { Prefer: "return=minimal" }), "insert subscription");
  return plan;
}

// ── actions ────────────────────────────────────────────────────────────────────────────────────────────────
async function disable() {
  const id = await findUserId();
  if (!id) { say("no such login exists — nothing to disable"); return; }
  must(await api("PUT", `/auth/v1/admin/users/${id}`, { password: randomBytes(24).toString("base64url"), ban_duration: "876000h" }), "lock user");
  say("login locked (random password, banned)");
}

async function create() {
  await loadSchema();
  const id = await ensureUser(ACCT.password);
  say("user id:", id);

  // profile (upsert). email stays empty so no transaction/welcome emails are ever queued for the fictional shop.
  must(await api("POST", "/rest/v1/profiles?on_conflict=id", fit("profiles", [ACCT.profile(id)]), { Prefer: "resolution=merge-duplicates,return=minimal" }), "upsert profile");
  await clearRows("welcome_email_queue", "user_id", id);     // the profile-insert trigger queues one, with an empty address
  await clearRows("email_automation_queue", "user_id", id);

  // subscription: the reviewer gets the top plan for a year; the tester starts on the free plan
  if (ACCT.plan === "top") {
    const plan = await planSlug("top");
    await clearRows("subscriptions", "user_id", id);
    await insertRows("subscriptions", [{ user_id: id, plan: plan.slug, status: "active", billing_cycle: "yearly", cancel_at_period_end: false, expires_at: new Date(Date.now() + 400 * 864e5).toISOString() }]);
    say("plan:", plan.slug, `(${plan.name})`);
  } else {
    await clearRows("subscriptions", "user_id", id);
    const plan = await setPlan(id, "free");
    say("plan:", plan.slug, `(${plan.name}) — free`);
  }

  // the app stops a first-time user on a "accept the Terms and Privacy Policy" screen; the account starts already past it, at the current versions
  const docs = must(await api("GET", "/rest/v1/legal_documents?select=type,version&status=eq.published&order=version.desc"), "read legal documents").json || [];
  const latest = (type) => docs.find((d) => d.type === type)?.version;
  if (latest("tnc") && latest("privacy")) {
    await clearRows("user_consents", "user_id", id);
    await insertRows("user_consents", [{ user_id: id, tnc_version: latest("tnc"), privacy_version: latest("privacy"), consented_at: new Date().toISOString() }]);
    say(`consent recorded at Terms v${latest("tnc")} / Privacy v${latest("privacy")}`);
  }

  // fictional data — cleared first so a re-run does not double it
  for (const [table, col] of [["transactions", "user_id"], ["debt_payments", "owner_id"], ["credits", "user_id"], ["customers", "user_id"], ["products", "user_id"]]) await clearRows(table, col, id);
  const n = {};
  n.products = await insertRows("products", buildProducts(id));
  n.customers = await insertRows("customers", buildCustomers(id));
  const { credits, payments } = buildCredits(id);
  n.credits = await insertRows("credits", credits);
  n.debt_payments = await insertRows("debt_payments", payments);
  n.transactions = await insertRows("transactions", buildTransactions(id, new Date(), ACCT.days));
  say("seeded:", JSON.stringify(n));
  for (const [t, s] of Object.entries(dropped)) say(`  (${t}: columns not in the table, skipped: ${[...s].join(", ")})`);

  // known PINs, set through the app's own pin-manager so the hashing is exactly what the app expects
  const login = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: ACCT.email, password: ACCT.password }) });
  const session = await login.json().catch(() => ({}));
  if (!login.ok || !session.access_token) fail(`the login could not sign in with the stored password (HTTP ${login.status}) — check the ${ACCT.secret} secret and the project's password rules`);
  for (const [action, pin] of [["setup_app_pin", DEMO_APP_PIN], ["setup_txn_pin", DEMO_TXN_PIN]]) {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/pin-manager`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action, pin }) });
    const j = await r.json().catch(() => ({}));
    if (!j.success) fail(`${action} failed: ${j.error || "HTTP " + r.status}`);
  }
  say("PINs set");

  // read it back the way the app will (a sanity check that the account really is complete)
  const prof = must(await api("GET", `/rest/v1/profiles?id=eq.${id}&select=business_name,verification_status,app_pin_hash,txn_pin_hash`), "read profile back").json?.[0];
  const sub = must(await api("GET", `/rest/v1/subscriptions?user_id=eq.${id}&status=eq.active&select=plan`), "read subscription back").json?.[0];
  if (prof?.business_name !== ACCT.business || prof?.verification_status !== "tier2_verified" || !prof?.app_pin_hash || !prof?.txn_pin_hash || !sub) fail("read-back check failed: the account is not complete");
  say(`ready: ${ACCT.email} · ${ACCT.business} · verified · plan ${sub.plan}`);
}

async function testerPlan(which) {
  const id = await findUserId();
  if (!id) fail("the tester account does not exist yet — run tester-create first");
  const plan = await setPlan(id, which);
  const sub = must(await api("GET", `/rest/v1/subscriptions?user_id=eq.${id}&select=plan,status,expires_at&order=created_at.desc&limit=1`), "read subscription back").json?.[0];
  say(`tester is now on: ${sub?.plan} (${plan.name}) status=${sub?.status} expires=${sub?.expires_at || "never"}`);
}

async function stockPing() {
  const id = await findUserId();
  if (!id) fail("the tester account does not exist yet — run tester-create first");
  const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");
  const name = `Hypo Toothpaste LIVE${stamp}`;
  must(await api("PATCH", `/rest/v1/products?user_id=eq.${id}&sku=eq.AFM-1019`, { product_name: name }, { Prefer: "return=minimal" }), "rename product");
  say("renamed a product to:", name);
}

if (ACTION === "create") await create();
else if (ACTION === "disable" || ACTION === "tester-disable") await disable();
else if (ACTION === "tester-create") await create();
else if (ACTION === "tester-upgrade") await testerPlan("top");
else if (ACTION === "tester-downgrade") await testerPlan("free");
else if (ACTION === "tester-stock-ping") await stockPing();
else fail(`unknown ACTION "${ACTION}"`);
