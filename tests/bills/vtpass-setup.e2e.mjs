// Bill-payment regression suite. Run: node tests/bills/vtpass-setup.e2e.mjs  — see tests/bills/README.md
// End-to-end: VTpass set up from the admin portal (2026-10-26). The REAL clubkonnect function and the REAL relay against a
// fake VTpass and a fake Supabase whose vtpass_get_config answers like the Vault-backed SQL function (migration 20270430):
// keys saved in the admin are used (and win over the function's own secrets), Live/Sandbox is the kill switch, the
// "Test connection" check says what to do, VTpass calls can go out through the fixed-IP relay, the ₦50 live test, and the
// wallet snapshot. Customers can reach none of the admin actions.
import { FN, RELAY_JS, killTree } from "./_harness.mjs";
import http from "node:http";
import { spawn } from "node:child_process";
const CK = 8793, SB = 8794, VTP = 8795, RELAY = 18800, FNPORT = 8000, SERVICE_KEY = "svc-test-key", USER_TOKEN = "user-token";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0, checks = 0;
const ok = (c, m, x = "") => { checks++; if (!c) { fails++; console.log(`  FAIL ${m}\n       ${x}`); } else console.log(`  ok   ${m}`); };
const J = (x) => JSON.stringify(x);

// ── fake ClubKonnect (only what the function touches here) ──
const ckSrv = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"); const p = Object.fromEntries(u.searchParams);
  res.writeHead(200, { "Content-Type": "application/json" });
  if (p.UserID === "CK000000") return res.end(J({ status: "INVALID_CREDENTIALS" }));
  if (u.pathname === "/APIWalletBalanceV1.asp") return res.end(J({ WalletBalance: "500000" }));
  res.end(J({}));
});

// ── fake VTpass: knows two key sets; can refuse our IP (027) when asked ──
const KEYS = { admin: { api: "ADMINAPIKEY01", secret: "ADMINSECRET01", pub: "ADMINPUBLIC01" }, secrets: { api: "SECRETSAPI01", secret: "SECRETSSEC01" } };
let vtRefuseDirect = false;   // true = like a live account with an IP whitelist: only calls through the relay are accepted
const vtLog = [];
const vtSrv = http.createServer((req, res) => {
  let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    const u = new URL(req.url, "http://x");
    const send = (body) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(J(body)); };
    const via = req.headers["x-came-via"] === "relay" ? "relay" : "direct";
    const who = req.headers["api-key"] === KEYS.admin.api && req.headers["secret-key"] === KEYS.admin.secret ? "admin"
      : req.headers["api-key"] === KEYS.secrets.api && req.headers["secret-key"] === KEYS.secrets.secret ? "secrets" : null;
    vtLog.push({ path: u.pathname, method: req.method, who, via, pub: req.headers["public-key"] ?? null, body: b });
    if (vtRefuseDirect && via === "direct") return send({ code: "027", response_description: "IP NOT WHITELISTED" });
    if (!who) return send({ code: "087", response_description: "INVALID CREDENTIALS" });
    if (u.pathname === "/api/balance") return req.headers["public-key"] === KEYS.admin.pub ? send({ code: 1, contents: { balance: 4321.5 } }) : send({ code: "087", response_description: "INVALID CREDENTIALS" });
    if (u.pathname === "/api/requery") return send({ code: "015", response_description: "INVALID REQUEST ID" });
    if (u.pathname === "/api/service-variations") {
      const sid = u.searchParams.get("serviceID");
      const list = sid === "mtn-data" ? [{ variation_code: "mtn-1gb-1000", name: "N1000 1GB - 30 days", variation_amount: "1000.00" }]
        : sid === "dstv" ? [{ variation_code: "dstv-compact", name: "DStv Compact N15,700", variation_amount: "15700.00" }]
        : sid === "smile-direct" ? [{ variation_code: "624", name: "1GB FlexiDaily", variation_amount: "300.00" }] : [];
      return send({ response_description: "000", content: { serviceID: sid, varations: list } });
    }
    if (u.pathname === "/api/pay") {
      const body = JSON.parse(b || "{}");
      return send({ code: "000", response_description: "TRANSACTION SUCCESSFUL", requestId: body.request_id,
        content: { transactions: { status: "delivered", amount: body.amount, total_amount: 48.25, transactionId: "VT-TEST-1" } } });
    }
    send({ code: "404" });
  });
});
// the relay forwards to this port too, but marks itself so the fake VTpass can tell the two routes apart
const tagSrv = http.createServer((req, res) => {
  let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    const r = http.request({ host: "127.0.0.1", port: VTP, path: req.url, method: req.method, headers: { ...req.headers, "x-came-via": "relay" } }, (up) => {
      res.writeHead(up.statusCode, up.headers); up.pipe(res);
    });
    r.end(b);
  });
});

// ── fake Supabase: platform_config, the saved VTpass config (vtpass_get_config), wallet snapshots ──
let config = {}, saved = { saved: false }, balances = [];
const sbSrv = http.createServer((req, res) => {
  let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    const u = new URL(req.url, "http://x");
    const send = (c, o) => { res.writeHead(c, { "Content-Type": "application/json" }); res.end(o === null ? "" : J(o)); };
    const one = /vnd\.pgrst\.object/.test(req.headers.accept ?? "");
    if (u.pathname === "/auth/v1/user") return (req.headers.authorization ?? "") === `Bearer ${USER_TOKEN}` ? send(200, { id: "11111111-1111-4111-8111-111111111111" }) : send(401, { message: "bad" });
    if (u.pathname === "/rest/v1/rpc/vtpass_get_config") return send(200, saved);
    const t = /^\/rest\/v1\/(\w+)/.exec(u.pathname)?.[1];
    if (t === "platform_config" && req.method === "GET") {
      const f = u.searchParams.get("key") ?? "";
      const ks = f.startsWith("eq.") ? [f.slice(3)] : f.startsWith("in.(") ? f.slice(4, -1).split(",").map((k) => k.replace(/^"|"$/g, "")) : Object.keys(config);
      const rows = ks.filter((k) => k in config).map((key) => ({ key, value: config[key] }));
      return one ? (rows.length ? send(200, rows[0]) : send(406, { code: "PGRST116", details: "The result contains 0 rows" })) : send(200, rows);
    }
    if (t === "bill_provider_balances" && req.method === "POST") { balances.push(...[].concat(JSON.parse(b))); return send(201, null); }
    if (one) return send(406, { code: "PGRST116", details: "The result contains 0 rows" });
    send(200, []);
  });
});
await Promise.all([[ckSrv, CK], [vtSrv, VTP], [sbSrv, SB], [tagSrv, VTP + 10]].map(([s, port]) => new Promise((r) => s.listen(port, "127.0.0.1", r))));

const relay = spawn(process.execPath, [RELAY_JS], { env: { ...process.env, RELAY_KEY: "relay-key", PORT: String(RELAY),
  VT_LIVE_BASE: `http://127.0.0.1:${VTP + 10}/api`, VT_SANDBOX_BASE: `http://127.0.0.1:${VTP + 10}/api` }, stdio: "ignore" });
let fnProc = null, fnLog = "";
const cleanup = () => { if (fnProc) try { killTree(fnProc); } catch {} try { relay.kill(); } catch {} for (const s of [ckSrv, vtSrv, sbSrv, tagSrv]) try { s.close(); } catch {} };
process.on("exit", cleanup);
{
  const env = { ...process.env, CK_BASE: `http://127.0.0.1:${CK}/`, SUPABASE_URL: `http://127.0.0.1:${SB}`, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, SUPABASE_ANON_KEY: "anon",
    CK_USER_ID: "ckuser", CK_AIRTIME_KEY: "k-air", FLW_RELAY_URL: `http://127.0.0.1:${RELAY}`, FLW_RELAY_KEY: "relay-key",
    // the function's own secrets (GitHub workflow) — sandbox, so VTpass serves no one until the admin saves live keys
    VTPASS_API_KEY: KEYS.secrets.api, VTPASS_SECRET_KEY: KEYS.secrets.secret, VTPASS_ENV: "sandbox", VTPASS_BASE: `http://127.0.0.1:${VTP}/api` };
  fnProc = spawn("deno", ["run", "--allow-all", "--no-lock", "--node-modules-dir=none", FN], { env, shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] });
  fnProc.stdout.on("data", (d) => (fnLog += d)); fnProc.stderr.on("data", (d) => (fnLog += d));
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { const r = await fetch(`http://127.0.0.1:${FNPORT}/`, { method: "OPTIONS" }); up = r.status < 500; } catch {} if (!up) await sleep(1000); }
  if (!up) { console.log("function never started\n" + fnLog.slice(-2000)); cleanup(); process.exit(2); }
}
const post = async (body, token = SERVICE_KEY) => {
  const r = await fetch(`http://127.0.0.1:${FNPORT}/`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: J(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const check = async () => (await post({ action: "vtpass-check" })).body;
const status = async () => (await post({ action: "provider-status" })).body;

try {
  // ── nothing saved in the admin: the function's own (sandbox) secrets, VTpass serves no one ──
  let c = await check();
  ok(c?.source === "secrets" && c?.env === "sandbox" && c?.live === false && c?.keys?.ok === true, "nothing saved: the function's own sandbox secrets are used, not live", J(c));
  ok(vtLog.at(-1)?.who === "secrets", "…and VTpass sees those keys", J(vtLog.at(-1)));

  // ── the admin saves LIVE keys ──
  saved = { saved: true, env: "live", api_key: KEYS.admin.api, secret_key: KEYS.admin.secret, public_key: KEYS.admin.pub };
  c = await check();
  ok(c?.source === "admin" && c?.env === "live" && c?.live === true, "keys saved in the admin win over the secrets; live", J(c));
  ok(c?.keys?.ok === true && c?.publicKey?.ok === true && c?.balance === 4321.5, "Test connection: keys accepted, public key accepted, wallet balance read", J(c));
  ok(vtLog.slice(-2).every((l) => l.who === "admin") && vtLog.some((l) => l.path === "/api/balance" && l.pub === KEYS.admin.pub), "VTpass sees the admin's keys (api, secret, public)");
  let s = await status();
  ok(s?.vtpass?.configured === true && s?.vtpass?.live === true && s?.vtpass?.env === "live", "Bill Provider status: VTpass live (so it can be made the main provider)", J(s?.vtpass));

  // ── wrong keys ──
  saved = { saved: true, env: "live", api_key: "WRONGAPIKEY1", secret_key: "WRONGSECRET1", public_key: "WRONGPUBLIC1" };
  c = await check();
  ok(c?.keys?.ok === false && /Settings → API Keys/.test(c?.keys?.problem ?? ""), "wrong keys: the check says to copy them again", J(c?.keys));

  // ── VTpass accepts only whitelisted IPs ──
  saved = { saved: true, env: "live", api_key: KEYS.admin.api, secret_key: KEYS.admin.secret, public_key: KEYS.admin.pub };
  vtRefuseDirect = true;
  c = await check();
  ok(c?.keys?.ok === false && /209\.71\.82\.233/.test(c?.keys?.problem ?? "") && c?.viaRelay === false && c?.relayConfigured === true,
    "IP not whitelisted (027): the check says to turn on the fixed IP and whitelist 209.71.82.233", J(c));
  config.vtpass_via_relay = "true";
  c = await check();
  ok(c?.viaRelay === true && c?.keys?.ok === true && c?.balance === 4321.5, "fixed IP on: the same keys now work, through the relay", J(c));
  ok(vtLog.slice(-2).every((l) => l.via === "relay" && l.who === "admin"), "…both checks reached VTpass through the relay with the admin's keys", J(vtLog.slice(-2)));

  // ── ₦50 live test (through the relay) ──
  let r = await post({ action: "vtpass-live-test", phone: "08031234567", network: "Glo" });
  ok(r.body?.ok === false && /MTN number/.test(r.body?.error ?? ""), "live test: wrong network for the number refused, nothing sent", J(r.body));
  r = await post({ action: "vtpass-live-test", phone: "123", network: "MTN" });
  ok(r.body?.ok === false && !vtLog.some((l) => l.path === "/api/pay"), "live test: a bad number refused, nothing sent", J(r.body));
  r = await post({ action: "vtpass-live-test", phone: "08031234567", network: "MTN" });
  const pay = vtLog.find((l) => l.path === "/api/pay");
  ok(r.body?.ok === true && r.body?.status === "delivered" && pay && JSON.parse(pay.body).amount === 50 && JSON.parse(pay.body).serviceID === "mtn" && pay.via === "relay",
    "live test: one ₦50 MTN airtime order on VTpass, delivered", J([r.body, pay]));
  ok(/^\d{12}KDTVTTEST\d+$/.test(r.body?.requestId ?? ""), "…under its own VTpass request id (Lagos date first)", r.body?.requestId);

  // ── wallet snapshot includes VTpass ──
  r = await post({ action: "provider-balance-snapshot" });
  ok(J(r.body?.saved) === J(["clubkonnect", "vtpass"]) && balances.find((b) => b.provider === "vtpass")?.balance_kobo === 432_150, "wallet snapshot: VTpass's balance saved too", J([r.body, balances]));

  // ── Bill Prices: VTpass's own plans, with the admin's prices (2026-10-26) ──
  config.data_selling_prices = JSON.stringify({ MTN: { "N1000 1GB - 30 days": 1050 } });
  config.bill_price_overrides = JSON.stringify({ cable: { "dstv|vt:dstv-compact": 16000 } });
  const cat = (await post({ action: "price-catalogue" })).body;
  const vt = cat?.vtpass;
  ok(vt && vt.env === "live" && vt.live === true && vt.serving?.data === false, "price catalogue: VTpass section (live; customers still see ClubKonnect's plans)", J(vt).slice(0, 300));
  const mtn = vt?.data?.find((d) => d.network === "MTN")?.plans?.[0];
  ok(mtn?.id === "vt:mtn-1gb-1000" && mtn.cost === 1000 && mtn.price === 1050 && mtn.priced, "VTpass data plan with its list price and the admin's price (matched by name)", J(mtn));
  const compact = vt?.cable?.find((c) => c.provider === "dstv")?.items?.[0];
  ok(compact?.id === "vt:dstv-compact" && compact.cost === 15700 && compact.price === 16000 && compact.priced, "VTpass DStv package with the admin's price", J(compact));
  ok(vt?.smile?.items?.[0]?.id === "vt:624" && vt.smile.items[0].price === 300 && !vt.smile.items[0].priced, "VTpass Smile plan at its list price (none set)", J(vt?.smile));
  config.bill_provider = "vtpass";
  const cat2 = (await post({ action: "price-catalogue" })).body;
  ok(cat2?.vtpass?.serving?.data === true && cat2?.vtpass?.serving?.cable === true, "VTpass made main → the catalogue says customers see VTpass's plans now", J(cat2?.vtpass?.serving));
  r = await post({ action: "cable-packages", provider: "dstv" }, USER_TOKEN);
  ok(r.body?._provider === "vtpass" && r.body?.packages?.[0]?.package_id === "vt:dstv-compact" && r.body.packages[0].package_amount === 16000,
    "…and a customer gets VTpass's DStv Compact at the admin's ₦16,000", J(r.body));
  delete config.bill_provider;

  // ── kill switch: the admin sets Sandbox ──
  saved = { ...saved, env: "sandbox" };
  c = await check();
  ok(c?.env === "sandbox" && c?.live === false, "kill switch: Sandbox → VTpass serves no customer", J(c));
  r = await post({ action: "vtpass-live-test", phone: "08031234567", network: "MTN" });
  ok(r.body?.ok === false && /isn't live/.test(r.body?.error ?? ""), "…and the live test refuses", J(r.body));
  s = await status();
  ok(s?.vtpass?.live === false, "Bill Provider status shows it isn't live", J(s?.vtpass));

  // ── customers can't reach any of it ──
  for (const action of ["vtpass-check", "vtpass-live-test", "provider-balance-snapshot"]) {
    r = await post({ action, phone: "08031234567", network: "MTN" }, USER_TOKEN);
    ok(r.status === 401, `a customer's login can't call ${action}`, J(r));
  }
  ok(!/ADMINAPIKEY01|ADMINSECRET01|ADMINPUBLIC01|SECRETSAPI01/.test(fnLog), "the function never logs a VTpass key", fnLog.slice(-400));
} finally { cleanup(); }
console.log(fails ? `\n${fails} of ${checks} checks FAILED` : `\nall ${checks} checks passed`);
process.exit(fails ? 1 : 0);
