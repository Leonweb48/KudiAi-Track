// Bill-payment regression suite (moved from local testing on 2026-10-01). Run: node tests/bills/provider-switch.e2e.mjs  — see tests/bills/README.md
// End-to-end: the REAL clubkonnect edge function (deno) with the ClubKonnect ⇄ VTpass provider switch, against a fake
// ClubKonnect, a fake VTpass (behaving as the sandbox did in vtpass-probe) and a fake Supabase (platform_config, the
// bill_provider_claim RPC + bill_provider_attempts, admin alerts, the finance ledger RPC).
// node e2e-bill-provider.mjs
import { FN, killTree } from "./_harness.mjs";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
const CK = 8793, SB = 8794, VTP = 8795, FNPORT = 8000, SERVICE_KEY = "svc-test-key";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0, checks = 0;
const ok = (c, m, x = "") => { checks++; if (!c) { fails++; console.log(`  FAIL ${m}\n       ${x}`); } else console.log(`  ok   ${m}`); };
const J = (x) => JSON.stringify(x);

// ── fake ClubKonnect ──────────────────────────────────────────────────────────────────────────────────────────────
let real = {}, queries = [], ckLog = [], svcProbe = {};
const ckSrv = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"); const path = u.pathname.slice(1); const p = Object.fromEntries(u.searchParams);
  const send = (code, body) => { res.writeHead(code, { "Content-Type": typeof body === "string" ? "text/html" : "application/json" }); res.end(typeof body === "string" ? body : J(body)); };
  // "ClubKonnect down" = a real outage: its crash page even for the made-up-account probe (the invalid-order
  // svcProbe alone no longer pauses sales — ClubKonnect 503s invalid orders while taking real ones, 2026-09-30)
  if (p.UserID === "CK000000") { ckLog.push(`probe:${path}`); return Object.keys(svcProbe).length >= 2 ? send(500, "<html>500 - Internal server error.</html>") : send(200, { status: "INVALID_CREDENTIALS" }); }
  if (String(p.RequestID || "").startsWith("KUDIAI-HEALTH-")) {
    ckLog.push(`svcprobe:${path}`);
    return svcProbe[path] === "503" ? send(503, "<html><body>The service is unavailable.</body></html>") : send(200, { status: "INVALID_DATAPLAN" });
  }
  ckLog.push(`${path}#${p.RequestID ?? ""}`);
  if (path === "APIQueryV1.asp") { const q = queries.shift() ?? { status: "INVALID_REQUESTID" }; return send(200, q); }
  if (path === "APIWalletBalanceV1.asp") return send(200, { WalletBalance: "500000" });
  if (path === "APIDatabundlePlansV2.asp") return send(200, { MOBILE_NETWORK: { MTN: [{ ID: "01", PRODUCT: [{ PRODUCT_ID: "500", PRODUCT_NAME: "500 MB - 30 days (SME)", PRODUCT_AMOUNT: "140" }] }] } });
  const mode = real[path];
  if (mode === "crash") return send(503, "<html><body>The service is unavailable.</body></html>");
  if (mode === "lowwallet") return send(200, { status: "INSUFFICIENT_BALANCE" });
  if (mode === "badnumber") return send(200, { status: "INVALID_MOBILENUMBER" });
  if (mode === "ok") return send(200, { statuscode: "100", status: "ORDER_RECEIVED", orderid: `CK-${path}`, requestid: p.RequestID });
  return send(200, {});
});

// ── fake VTpass (answers exactly as the sandbox did) ──────────────────────────────────────────────────────────────
let vtMode = "delivered", vtRequeryMode = "normal", vtOrders = new Map(), vtLog = [];
const vtSrv = http.createServer((req, res) => {
  let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    const u = new URL(req.url, "http://x");
    const send = (code, body) => { res.writeHead(code, { "Content-Type": typeof body === "string" ? "text/html" : "application/json" }); res.end(typeof body === "string" ? body : J(body)); };
    const body = b ? JSON.parse(b) : {};
    const authed = req.headers["api-key"] === "vt-api" && req.headers["secret-key"] === "vt-secret";
    const txn = (rid, st, amount) => ({ code: st === "failed" ? "016" : "000", response_description: st === "delivered" ? "TRANSACTION SUCCESSFUL" : st === "pending" ? "TRANSACTION PROCESSING - PENDING" : "TRANSACTION FAILED",
      requestId: rid, amount: String(amount), purchased_code: "", content: { transactions: { status: st, amount, total_amount: Math.round(amount * 96.5) / 100, commission: 3.5, transactionId: `VT-${rid}` } } });
    if (u.pathname === "/api/service-variations") {
      vtLog.push(`variations:${u.searchParams.get("serviceID")}`);
      return send(200, { response_description: "000", content: { serviceID: u.searchParams.get("serviceID"), varations: [
        { variation_code: "mtn-10mb-100", name: "N100 100MB - 24 hrs", variation_amount: "100.00" },
        { variation_code: "mtn-1gb-1000", name: "N1000 1GB - 30 days", variation_amount: "1000.00" }] } });
    }
    if (u.pathname === "/api/requery") {
      vtLog.push(`requery:${body.request_id}`);
      if (vtRequeryMode === "page") return send(502, "<html>502 Bad Gateway</html>");
      if (vtRequeryMode === "badcreds" || !authed) return send(200, { code: "087", response_description: "INVALID CREDENTIALS" });
      const o = vtOrders.get(body.request_id);
      if (!o) return send(200, { code: "015", response_description: "INVALID REQUEST ID", content: { errors: [] } });
      return send(200, txn(body.request_id, o.status, o.amount));
    }
    if (u.pathname === "/api/pay") {
      vtLog.push(`pay:${body.request_id}:${body.serviceID}:${body.variation_code ?? ""}:${body.billersCode ?? ""}:${body.phone}:${body.amount ?? ""}`);
      if (!authed) return send(200, { code: "087", response_description: "INVALID CREDENTIALS" });
      if (vtOrders.has(body.request_id)) return send(200, { code: "014", response_description: "REQUEST ID ALREADY EXIST", content: { errors: [] } });
      const amount = Number(body.amount ?? (body.variation_code === "mtn-1gb-1000" ? 1000 : 100));
      if (vtMode === "syserror") return send(500, { code: "083", content: { errors: [] } });
      if (vtMode === "lowwallet") return send(200, { code: "018", response_description: "LOW WALLET BALANCE" });
      if (vtMode === "page") return send(502, "<html>502 Bad Gateway</html>");
      vtOrders.set(body.request_id, { status: vtMode, amount });
      return send(200, txn(body.request_id, vtMode, amount));
    }
    send(404, { code: "404" });
  });
});

// ── fake Supabase (PostgREST) ─────────────────────────────────────────────────────────────────────────────────────
let config = {}, alerts = [], claims = new Map(), costs = [];
const sbSrv = http.createServer((req, res) => {
  let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    const u = new URL(req.url, "http://x");
    const send = (c, o) => { res.writeHead(c, { "Content-Type": "application/json" }); res.end(o === null ? "" : J(o)); };
    if (u.pathname === "/rest/v1/rpc/bill_provider_claim") {
      const a = JSON.parse(b);   // same semantics as the SQL function (tested separately in PGlite)
      let row = claims.get(a.p_request_id);
      if (!row) { row = { providers: [a.p_provider], vt: a.p_provider === "vtpass" ? a.p_vt_request_id : null }; claims.set(a.p_request_id, row); }
      else if (J(row.providers) === J(a.p_expect ?? []) && !row.providers.includes(a.p_provider)) {
        row.providers = [...row.providers, a.p_provider]; if (a.p_provider === "vtpass" && !row.vt) row.vt = a.p_vt_request_id;
      }
      return send(200, { providers: row.providers, vt_request_id: row.vt });
    }
    if (u.pathname === "/rest/v1/rpc/finance_record_bill_cost") { costs.push(JSON.parse(b)); return send(200, true); }
    const t = /^\/rest\/v1\/(\w+)/.exec(u.pathname)?.[1];
    if (t === "bill_provider_attempts") {
      const rid = (u.searchParams.get("request_id") || "").replace(/^eq\./, "");
      const row = claims.get(rid);
      return send(200, row ? [{ providers: row.providers, vt_request_id: row.vt }] : []);
    }
    if (t === "platform_config" && req.method === "GET") return send(200, Object.entries(config).map(([key, value]) => ({ key, value })));
    if (t === "platform_config") return send(201, null);
    if (t === "admin_notifications" && req.method === "GET") {
      const title = (u.searchParams.get("title") || "").replace(/^eq\./, "");
      return send(200, alerts.filter((a) => a.title === title).map(() => ({ id: 1 })));
    }
    if (t === "admin_notifications" && req.method === "POST") { alerts.push(JSON.parse(b)); return send(201, null); }
    send(200, []);
  });
});
await Promise.all([ckSrv, sbSrv, vtSrv].map((s, i) => new Promise((r) => s.listen([CK, SB, VTP][i], "127.0.0.1", r))));

let fnProc = null, fnLog = "";
const stopFn = () => { if (fnProc) { try { killTree(fnProc); } catch {} fnProc = null; } };
const cleanup = () => { stopFn(); try { ckSrv.close(); sbSrv.close(); vtSrv.close(); } catch {} };
process.on("exit", cleanup);
async function startFn(vtEnv) {
  try { await fetch(`http://127.0.0.1:${FNPORT}/`, { method: "OPTIONS", signal: AbortSignal.timeout(1500) }); console.log(`port ${FNPORT} busy — stop the stale process first`); process.exit(3); } catch {}
  const env = { ...process.env, CK_BASE: `http://127.0.0.1:${CK}/`, SUPABASE_URL: `http://127.0.0.1:${SB}`, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, SUPABASE_ANON_KEY: "anon",
    CK_USER_ID: "ckuser", CK_AIRTIME_KEY: "k-air", CK_DATA_KEY: "k-data", CK_CABLETV_KEY: "k-cable",
    VTPASS_API_KEY: "vt-api", VTPASS_SECRET_KEY: "vt-secret", VTPASS_ENV: vtEnv, VTPASS_BASE: `http://127.0.0.1:${VTP}/api` };
  fnProc = spawn("deno", ["run", "--allow-all", "--no-lock", "--node-modules-dir=none", FN], { env, shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] });
  fnLog = ""; fnProc.stdout.on("data", (d) => (fnLog += d)); fnProc.stderr.on("data", (d) => (fnLog += d));
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${FNPORT}/`, { method: "OPTIONS" }); if (r.status < 500) return; } catch {} await sleep(1000); }
  console.log("function never started\n" + fnLog.slice(-2000)); cleanup(); process.exit(2);
}
const call = async (body) => {
  const r = await fetch(`http://127.0.0.1:${FNPORT}/`, { method: "POST", headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" }, body: J(body) });
  return r.json().catch(() => null);
};
const reset = (o = {}) => {
  real = o.real ?? {}; queries = [...(o.queries ?? [])]; svcProbe = o.svcProbe ?? {}; vtMode = o.vtMode ?? "delivered"; vtRequeryMode = o.vtRequeryMode ?? "normal";
  ckLog = []; vtLog = []; alerts.length = 0; costs.length = 0;
};
const freshHealth = () => call({ action: "provider-status" });   // clears every health cache
let n = 0;
const ref = () => `KDT-BILL-17590000${String(++n).padStart(5, "0")}`;
const airtime = (rid) => call({ action: "airtime", phone: "08011111111", network: "MTN", amount: "100", requestId: rid });
const lagos = (ms) => { const d = new Date(ms + 3600_000); const p = (x) => String(x).padStart(2, "0"); return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`; };
const vtRid = (rid) => lagos(Number(/(\d{13})/.exec(rid)[1])) + rid.replace(/[^A-Za-z0-9]/g, "");
const CLEAN = "The bill payment service is temporarily unavailable. Please try again shortly.";
const BASE_CFG = { ck_v3_fallback_enabled: "false", ck_v3_fallback_services: "", ck_v3_force_services: "", ck_route_healthcheck_enabled: "true",
  data_selling_prices: J({ mtn: { "N1000 1GB - 30 days": 950 } }) };

// ═══ Run A: VTpass keys are SANDBOX — chosen as main, failover on — must never serve a customer ══════════════════════
config = { ...BASE_CFG, bill_provider: "vtpass", bill_provider_failover: "true" };
await startFn("sandbox");
console.log("run A (VTpass sandbox, chosen as main)…");
let r, rid;

reset({ real: { "APIAirtimeV1.asp": "ok" } }); rid = ref();
r = await airtime(rid);
ok(r?.status === "SUCCESS" && !vtLog.length, "sandbox VTpass is never used: the order goes to ClubKonnect", J([r, vtLog]));

reset({ real: { "APIAirtimeV1.asp": "crash" } }); rid = ref();
r = await airtime(rid);
ok(r?.error === CLEAN && !vtLog.length && !ckLog.some((c) => c.startsWith("APIQuery")), "ClubKonnect down + VTpass sandbox → clean error exactly as before (no lookup, no VTpass)", J([r, ckLog, vtLog]));

reset();
r = await call({ action: "data-plans", network: "MTN" });
ok(r?.plans?.length && r.plans.every((p) => !String(p.plan_id).startsWith("vt:")) && !vtLog.length, "data plans come from ClubKonnect", J([r?.plans, vtLog]));

reset(); rid = ref();
r = await call({ action: "data", phone: "08011111111", network: "MTN", planId: "vt:mtn-1gb-1000", requestId: rid });
ok(/no longer available/.test(r?.error || "") && !vtLog.length && !ckLog.some((c) => c.includes("Databundle")), "a VTpass plan while VTpass isn't live → refused, nothing bought anywhere", J([r, vtLog, ckLog]));

reset(); rid = ref(); claims.set(rid, { providers: ["vtpass"], vt: vtRid(rid) });
r = await call({ action: "verify", requestId: rid, service: "airtime" });
ok(r?.status === "UNKNOWN" && !vtLog.length, "verify of a VTpass order while VTpass isn't live → held (UNKNOWN), sandbox never asked", J([r, vtLog]));

reset();
r = await call({ action: "provider-status" });
ok(r?.vtpass?.live === false && r?.vtpass?.env === "sandbox" && J(r?.routing?.airtime) === J(["clubkonnect"]) && r?.config?.primary === "vtpass",
  "provider-status: sandbox, not live, airtime → ClubKonnect despite the switch", J(r));
stopFn(); await sleep(1500);

// ═══ Run B: VTpass LIVE as the backup (ClubKonnect main, failover on) ═════════════════════════════════════════════
config = { ...BASE_CFG, bill_provider: "clubkonnect", bill_provider_failover: "true" };
await startFn("live");
console.log("run B (ClubKonnect main, VTpass live backup)…");

reset({ real: { "APIAirtimeV1.asp": "ok" } }); await freshHealth(); rid = ref();
r = await airtime(rid);
ok(r?.status === "SUCCESS" && !vtLog.some((l) => l.startsWith("pay")) && J(claims.get(rid)?.providers) === J(["clubkonnect"]), "ClubKonnect healthy → ClubKonnect; claimed for it; VTpass not charged", J([r, vtLog, claims.get(rid)]));

reset({ real: { "APIAirtimeV1.asp": "crash" }, queries: [{ status: "INVALID_REQUESTID" }] }); rid = ref();
const b2 = rid;
r = await airtime(rid); await sleep(800);
ok(r?.status === "SUCCESS" && r?.provider === "vtpass", "ClubKonnect error page + lookup 'no such order' → VTpass delivers", J(r));
ok(J(claims.get(rid)?.providers) === J(["clubkonnect", "vtpass"]), "claim row records both, in order", J(claims.get(rid)));
ok(vtLog.includes(`pay:${vtRid(rid)}:mtn::::08011111111:100`) || vtLog.some((l) => l.startsWith(`pay:${vtRid(rid)}:mtn:`)), "VTpass request_id = Lagos date of the ORDER + the reference", J([vtLog, vtRid(rid)]));
ok(alerts.some((a) => a.title === "Bills moved to the backup provider") && alerts.some((a) => /ClubKonnect is failing/.test(a.title)), "admins told (failover + ClubKonnect failing)", J(alerts.map((a) => a.title)));
ok(costs.some((c) => c.p_request_id === rid && c.p_cost_kobo === 9650 && c.p_meta?.provider === "vtpass" && c.p_basis === "provider_reported"), "finance ledger gets VTpass's own charge (₦96.50), tagged vtpass", J(costs));

reset({ real: { "APIAirtimeV1.asp": "ok" } });
r = await airtime(b2);
ok(r?.status === "SUCCESS" && !ckLog.some((c) => c.startsWith("APIAirtimeV1")) && vtLog.filter((l) => l.startsWith("pay")).length === 1 && vtOrders.size >= 1,
  "a RETRY of that order goes back to VTpass (014 → requery → delivered), never to ClubKonnect — no second purchase", J([r, ckLog, vtLog]));

reset();
r = await call({ action: "verify", requestId: b2, service: "airtime" });
ok(r?.status === "SUCCESS" && r?.provider === "vtpass" && vtLog.includes(`requery:${vtRid(b2)}`), "verify asks VTpass (the order's last provider) → SUCCESS", J([r, vtLog]));

reset({ real: { "APIAirtimeV1.asp": "lowwallet" } }); rid = ref();
r = await airtime(rid);
ok(r?.status === "SUCCESS" && r?.provider === "vtpass" && !ckLog.some((c) => c.startsWith("APIQuery")), "ClubKonnect wallet empty → straight to VTpass (no lookup needed)", J([r, ckLog]));

reset({ real: { "APIAirtimeV1.asp": "badnumber" } }); rid = ref();
r = await airtime(rid);
ok(r?.error === "INVALID_MOBILENUMBER" && !vtLog.some((l) => l.startsWith("pay")), "ClubKonnect refuses the NUMBER → customer told, VTpass not tried", J([r, vtLog]));

reset({ svcProbe: { "APIDatabundleV1.asp": "503", "APIAirtimeV1.asp": "503" } }); await freshHealth(); ckLog = []; alerts.length = 0;
r = await call({ action: "bill-preflight", cat: "airtime", network: "MTN", amount: 100 });
ok(r?.ok === true && r?.provider === "vtpass", "preflight: ClubKonnect's purchase service down → NOT blocked, VTpass takes it", J(r));
rid = ref();
r = await airtime(rid);
ok(r?.status === "SUCCESS" && r?.provider === "vtpass" && !ckLog.some((c) => c === `APIAirtimeV1.asp#${rid}`) && J(claims.get(rid)?.providers) === J(["vtpass"]),
  "…and the order goes STRAIGHT to VTpass (ClubKonnect known down, not even tried)", J([r, ckLog, claims.get(rid)]));

reset({ svcProbe: { "APIDatabundleV1.asp": "503", "APIAirtimeV1.asp": "503" }, vtRequeryMode: "badcreds" }); await freshHealth(); alerts.length = 0;
r = await call({ action: "bill-preflight", cat: "airtime", network: "MTN", amount: 100 }); await sleep(600);
ok(r?.ok === false && r?.reason === "provider_down", "preflight: BOTH providers down → blocked before charging", J(r));
ok(alerts.some((a) => /bill sales paused/.test(a.title) && /VTpass: down/.test(a.metadata?.detail || "")), "admins told both are down", J(alerts));

reset({ svcProbe: { "APIDatabundleV1.asp": "503", "APIAirtimeV1.asp": "503" } }); await freshHealth();
r = await call({ action: "data-plans", network: "MTN" });
const gig = r?.plans?.find((p) => p.plan_id === "vt:mtn-1gb-1000");
ok(r?._provider === "vtpass" && gig?.plan_amount === 950 && gig?.priced === true && gig?.cost_amount === 1000, "data plans follow the provider in use (VTpass), selling price applied by plan name", J(r));
r = await call({ action: "data-plans", network: "MTN", print: true });
ok(r?.plans?.length && r.plans.every((p) => !String(p.plan_id).startsWith("vt:")), "Print Data plans always come from ClubKonnect", J(r?.plans));

reset(); rid = ref();
r = await call({ action: "data", phone: "08011111111", network: "MTN", planId: "vt:mtn-1gb-1000", requestId: rid });
ok(r?.status === "SUCCESS" && vtLog.some((l) => l === `pay:${vtRid(rid)}:mtn-data:mtn-1gb-1000:08011111111:08011111111:`) && !ckLog.some((c) => c.includes("Databundle")),
  "a VTpass data plan buys on VTpass (serviceID mtn-data, variation code without the tag)", J([r, vtLog]));

reset({ real: { "APIDatabundleV1.asp": "crash" }, queries: [{ status: "INVALID_REQUESTID" }] }); await freshHealth(); rid = ref();
r = await call({ action: "data", phone: "08011111111", network: "MTN", planId: "500", requestId: rid });
ok(r?.error && !vtLog.some((l) => l.startsWith("pay")), "a ClubKonnect data plan never moves to VTpass (plans aren't interchangeable)", J([r, vtLog]));

reset({ real: { "APICableTVV1.asp": "ok" } }); rid = ref();
r = await call({ action: "cable", provider: "DSTV", packageId: "dstv-padi", smartcard: "1234567890", phone: "08011111111", requestId: rid });
ok(!claims.has(rid) && !vtLog.length, "other bills (cable) untouched: ClubKonnect, no claim, no VTpass", J([r, vtLog]));

reset();
r = await call({ action: "provider-status" });
ok(r?.vtpass?.live === true && r?.vtpass?.health === "up" && J(r?.routing?.airtime) === J(["clubkonnect", "vtpass"]) && J(r?.routing?.data) === J(["clubkonnect", "vtpass"]),
  "provider-status: live, healthy, ClubKonnect first with VTpass as backup", J(r));
const noAuth = await fetch(`http://127.0.0.1:${FNPORT}/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: J({ action: "provider-status" }) });
ok(noAuth.status === 401, "provider-status is service-only", String(noAuth.status));
stopFn(); await sleep(1500);

// ═══ Run C: VTpass LIVE as main, failover OFF ═════════════════════════════════════════════════════════════════════
config = { ...BASE_CFG, bill_provider: "vtpass", bill_provider_failover: "false" };
await startFn("live");
console.log("run C (VTpass main, failover off)…");

reset({ real: { "APIAirtimeV1.asp": "ok" } }); rid = ref();
r = await airtime(rid);
ok(r?.status === "SUCCESS" && r?.provider === "vtpass" && !ckLog.some((c) => c.startsWith("APIAirtime")), "VTpass main → VTpass; ClubKonnect not touched", J([r, ckLog]));

reset({ real: { "APIAirtimeV1.asp": "ok" }, vtMode: "syserror" }); rid = ref();
r = await airtime(rid);
ok(r?.error === "This service is temporarily unavailable. Please try again shortly." && !ckLog.some((c) => c.startsWith("APIAirtime")) && vtLog.includes(`requery:${vtRid(rid)}`),
  "VTpass system error + requery 'no such order' → clean error (refund); failover off → ClubKonnect NOT tried", J([r, ckLog, vtLog]));

reset({ vtMode: "pending" }); rid = ref();
r = await airtime(rid);
ok(/gateway|timeout/i.test(r?.error || ""), "VTpass pending → the app's 'confirming your order' path (held, not refunded)", J(r));
r = await call({ action: "verify", requestId: rid, service: "airtime" });
ok(r?.status === "PENDING", "verify → PENDING", J(r));

reset({ vtMode: "failed" }); rid = ref();
r = await airtime(rid);
ok(r?.error === "Transaction failed", "VTpass failed → customer told, refunded", J(r));
r = await call({ action: "verify", requestId: rid, service: "airtime" });
ok(r?.status === "FAILED", "verify → FAILED", J(r));

reset(); rid = ref();
r = await call({ action: "verify", requestId: rid, service: "airtime" });
ok(r?.status === "NOT_FOUND" && !vtLog.length, "verify of an order with no claim row → ClubKonnect only (legacy)", J([r, vtLog]));

console.log(fails ? `\n${fails} of ${checks} checks FAILED` : `\nall ${checks} checks passed`);
if (fails) console.log("--- function log tail ---\n" + fnLog.slice(-3000));
cleanup();
process.exit(fails ? 1 : 0);
