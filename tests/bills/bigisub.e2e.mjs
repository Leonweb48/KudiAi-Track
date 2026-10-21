// Bill-payment regression suite — Bigisub as the airtime / data BACKUP (2026-10-21). Run: node tests/bills/bigisub.e2e.mjs
// End-to-end: the REAL clubkonnect edge function (deno) against a fake ClubKonnect, a fake Supabase (platform_config, the
// bill_provider_claim RPC + bill_provider_attempts incl. the Bigisub columns, alerts, finance) and a fake Bigisub that
// answers in the shapes of its API spec v2.2.0 (no client reference, transaction ids, history, status/requery).
import { FN, killTree } from "./_harness.mjs";
import http from "node:http";
import { spawn } from "node:child_process";
const CK = 8793, SB = 8794, BGP = 8796, FNPORT = 8000, SERVICE_KEY = "svc-test-key";
const TOKEN = "bgtoken0123456789abcdef0123456789abcd", PIN = "2468";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0, checks = 0;
const ok = (c, m, x = "") => { checks++; if (!c) { fails++; console.log(`  FAIL ${m}\n       ${x}`); } else console.log(`  ok   ${m}`); };
const J = (x) => JSON.stringify(x);

// ── fake ClubKonnect ──────────────────────────────────────────────────────────────────────────────────────────────
let real = {}, ckLog = [], ckBalance = "500000";
const ckSrv = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"); const path = u.pathname.slice(1); const p = Object.fromEntries(u.searchParams);
  const send = (code, body) => { res.writeHead(code, { "Content-Type": typeof body === "string" ? "text/html" : "application/json" }); res.end(typeof body === "string" ? body : J(body)); };
  if (p.UserID === "CK000000") return send(200, { status: "INVALID_CREDENTIALS" });            // health probe: up
  if (String(p.RequestID || "").startsWith("KUDIAI-HEALTH-")) return send(200, { status: "INVALID_DATAPLAN" });
  ckLog.push(`${path}#${p.RequestID ?? ""}`);
  if (path === "APIQueryV1.asp") return send(200, { status: "INVALID_REQUESTID" });
  if (path === "APIWalletBalanceV1.asp") return send(200, { WalletBalance: ckBalance });
  if (path === "APIDatabundlePlansV2.asp") return send(200, { MOBILE_NETWORK: { MTN: [{ ID: "01", PRODUCT: [{ PRODUCT_ID: "500", PRODUCT_NAME: "500 MB - 30 days (SME)", PRODUCT_AMOUNT: "140" }] }] } });
  const mode = real[path];
  if (mode === "lowwallet") return send(200, { status: "INSUFFICIENT_BALANCE" });
  if (mode === "badnumber") return send(200, { status: "INVALID_MOBILENUMBER" });
  if (mode === "ok") return send(200, { statuscode: "100", status: "ORDER_RECEIVED", orderid: `CK-${path}`, requestid: p.RequestID });
  return send(200, {});
});

// ── fake Bigisub (spec v2.2.0 shapes) ────────────────────────────────────────────────────────────────────────────
let bgMode = "ok", bgLog = [], bgOrders = new Map(), bgHistory = [], bgN = 0, bgLookupStatus = null;
const lagosNow = () => new Date(Date.now() + 3600_000).toISOString().slice(0, 19);
const bgSrv = http.createServer((req, res) => {
  let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    const u = new URL(req.url, "http://x");
    const send = (code, body) => { res.writeHead(code, { "Content-Type": typeof body === "string" ? "text/html" : "application/json" }); res.end(typeof body === "string" ? body : J(body)); };
    if (req.headers.authorization !== `Token ${TOKEN}`) return send(401, { success: false, message: "Invalid credentials" });
    const body = b ? JSON.parse(b) : {};
    const P = u.pathname.replace(/^\/api\/v2/, "");
    if (P === "/financial/wallet/balance/") return send(200, { success: true, data: { balance: 9000, user_type: "Corporate" } });
    if (P === "/vtu/data/plans/") return send(200, { success: true, data: [
      { id: 298, network: 1, plantype: "SME", size: 1, plan_volume: "GB", validity: "7days", amount: 455, plan_amount: 455, corporate_amount: 450, plan_disabled: false },
      { id: 299, network: 1, plantype: "SME", size: 2, plan_volume: "GB", validity: "30 days", amount: 900, corporate_amount: 880, plan_disabled: true }] });
    if (P === "/vtu/airtime/purchase/" || P === "/vtu/data/purchase/") {
      const svc = P.includes("airtime") ? "airtime" : "data";
      bgLog.push(`buy:${svc}:${body.phone_number}:${body.amount ?? body.plan}:pin=${body.pin === PIN}`);
      if (body.pin !== PIN) return send(400, { success: false, message: "Invalid transaction PIN" });
      if (bgMode === "poor") return send(402, { success: false, message: "Insufficient balance" });
      if (bgMode === "badnumber") return send(400, { success: false, message: "Validation failed", errors: { phone_number: ["Enter a valid 11-digit phone number"] } });
      const id = `${svc === "airtime" ? "Air" : "Data"}T${++bgN}`;
      const status = bgMode === "processing" ? "processing" : bgMode === "failed" ? "failed" : "successful";
      bgOrders.set(id, { status, svc });
      bgHistory.unshift({ tranx_id: id, unique_element: body.phone_number, status, service_type: svc, date_created: lagosNow(), transaction_amount: String(body.amount ?? 450) });
      if (bgMode === "lost") return send(500, "<html>Server Error (500)</html>");          // the order WAS created, the reply lost
      if (bgMode === "lost-none") { bgOrders.delete(id); bgHistory.shift(); return send(500, "<html>Server Error (500)</html>"); }
      return send(201, { success: true, data: { transaction_id: id, reference: `ref${bgN}`, status, amount: svc === "data" ? 450 : body.amount }, message: "ok" });
    }
    if (P === "/financial/transactions/") {
      bgLog.push(`history:${u.searchParams.get("unique_element")}:${u.searchParams.get("transaction_type")}`);
      const ue = u.searchParams.get("unique_element");
      return send(200, { count: 1, results: bgHistory.filter((r) => r.unique_element === ue) });
    }
    let m = /^\/anubis\/transactions\/([^/]+)\/(requery\/)?$/.exec(P);
    if (m) {
      bgLog.push(`${m[2] ? "requery" : "status"}:${m[1]}`);
      const o = bgOrders.get(decodeURIComponent(m[1]));
      if (!o) return send(404, { success: false, message: "Transaction not found" });
      const st = m[2] ? (bgLookupStatus ?? o.status) : o.status;   // a status read shows what Bigisub last stored; a requery asks the network
      return send(200, { success: true, data: m[2] ? { tranx_id: m[1], old_status: o.status, new_status: st } : { tranx_id: m[1], status: st } });
    }
    send(404, { success: false, message: "Not found" });
  });
});

// ── fake Supabase (PostgREST) ─────────────────────────────────────────────────────────────────────────────────────
let config = {}, alerts = [], claims = new Map(), costs = [];
const rowOut = (rid, r) => ({ request_id: rid, providers: r.providers, vt_request_id: r.vt ?? null, bg_tranx_id: r.bg_tranx_id ?? null, bg_meta: r.bg_meta ?? null, service: r.service });
const sbSrv = http.createServer((req, res) => {
  let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    const u = new URL(req.url, "http://x");
    const send = (c, o) => { res.writeHead(c, { "Content-Type": "application/json" }); res.end(o === null ? "" : J(o)); };
    if (u.pathname === "/rest/v1/rpc/bill_provider_claim") {
      const a = JSON.parse(b);
      if (!["clubkonnect", "vtpass", "bigisub"].includes(a.p_provider)) return send(400, { message: "unknown provider" });
      let row = claims.get(a.p_request_id);
      if (!row) { row = { providers: [a.p_provider], service: a.p_service }; claims.set(a.p_request_id, row); }
      else if (J(row.providers) === J(a.p_expect ?? []) && !row.providers.includes(a.p_provider)) row.providers = [...row.providers, a.p_provider];
      return send(200, { providers: row.providers, vt_request_id: null });
    }
    if (u.pathname === "/rest/v1/rpc/finance_record_bill_cost") { costs.push(JSON.parse(b)); return send(200, true); }
    const t = /^\/rest\/v1\/(\w+)/.exec(u.pathname)?.[1];
    if (t === "bill_provider_attempts") {
      const rid = (u.searchParams.get("request_id") || "").replace(/^eq\./, "");
      if (req.method === "PATCH") { const row = claims.get(rid); if (row) Object.assign(row, JSON.parse(b)); return send(204, null); }
      const inIds = u.searchParams.get("bg_tranx_id");
      if (inIds && inIds.startsWith("in.")) {
        const ids = inIds.slice(4, -1).split(",").map((x) => x.replace(/^"|"$/g, ""));
        return send(200, [...claims.entries()].filter(([, r]) => ids.includes(r.bg_tranx_id)).map(([k, r]) => rowOut(k, r)));
      }
      const row = claims.get(rid);
      const wantsOne = (req.headers.accept || "").includes("vnd.pgrst.object");
      if (wantsOne) return row ? send(200, rowOut(rid, row)) : send(406, { code: "PGRST116", message: "no rows" });
      return send(200, row ? [rowOut(rid, row)] : []);
    }
    if (t === "platform_config" && req.method === "GET") return send(200, Object.entries(config).map(([key, value]) => ({ key, value })));
    if (t === "platform_config") return send(201, null);
    if (t === "admin_notifications" && req.method === "GET") return send(200, []);
    if (t === "admin_notifications" && req.method === "POST") { alerts.push(JSON.parse(b)); return send(201, null); }
    send(200, []);
  });
});
await Promise.all([ckSrv, sbSrv, bgSrv].map((s, i) => new Promise((r) => s.listen([CK, SB, BGP][i], "127.0.0.1", r))));

let fnProc = null, fnLog = "";
const stopFn = () => { if (fnProc) { try { killTree(fnProc); } catch {} fnProc = null; } };
const cleanup = () => { stopFn(); try { ckSrv.close(); sbSrv.close(); bgSrv.close(); } catch {} };
process.on("exit", cleanup);
async function startFn() {
  try { await fetch(`http://127.0.0.1:${FNPORT}/`, { method: "OPTIONS", signal: AbortSignal.timeout(1500) }); console.log(`port ${FNPORT} busy — stop the stale process first`); process.exit(3); } catch {}
  const env = { ...process.env, CK_BASE: `http://127.0.0.1:${CK}/`, SUPABASE_URL: `http://127.0.0.1:${SB}`, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, SUPABASE_ANON_KEY: "anon",
    CK_USER_ID: "ckuser", CK_AIRTIME_KEY: "k-air", CK_DATA_KEY: "k-data", CK_CABLETV_KEY: "k-cable",
    BIGISUB_TOKEN: TOKEN, BIGISUB_PIN: PIN, BIGISUB_BASE: `http://127.0.0.1:${BGP}/api/v2` };
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
  real = o.real ?? {}; bgMode = o.bgMode ?? "ok"; ckBalance = o.ckBalance ?? "500000"; bgLookupStatus = o.bgLookupStatus ?? null;
  ckLog = []; bgLog = []; alerts.length = 0; costs.length = 0;
};
const fresh = () => call({ action: "provider-status" });   // clears every health / config cache
let n = 0;
const ref = () => `KDT-BILL-${Date.now()}${String(++n).padStart(2, "0")}`.slice(0, 30);
const PHONE = "08031234567";
const airtime = (rid) => call({ action: "airtime", phone: PHONE, network: "MTN", amount: "100", requestId: rid });
const BASE_CFG = { ck_v3_fallback_enabled: "false", ck_v3_fallback_services: "", ck_v3_force_services: "", ck_route_healthcheck_enabled: "true", bill_provider: "clubkonnect", bill_provider_failover: "true" };

await startFn();
let r, rid, st;

console.log("Bigisub switched OFF…");
config = { ...BASE_CFG, bill_provider_bigisub: "false" }; await fresh();
reset({ real: { "APIAirtimeV1.asp": "lowwallet" } }); rid = ref();
r = await airtime(rid);
ok(!!r?.error && !bgLog.some((x) => x.startsWith("buy")), "switch off: ClubKonnect's empty wallet → clean error, Bigisub never called", J([r, bgLog]));
st = await fresh();
ok(st?.bigisub?.configured === true && st?.bigisub?.on === false && st?.routing?.airtime?.join() === "clubkonnect", "provider-status: Bigisub set up but off; airtime routes to ClubKonnect only", J(st?.bigisub));

console.log("Bigisub switched ON…");
config = { ...BASE_CFG, bill_provider_bigisub: "true" }; await fresh();
st = await fresh();
ok(J(st?.routing?.airtime) === J(["clubkonnect", "bigisub"]) && J(st?.routing?.data) === J(["clubkonnect", "bigisub"]) && J(st?.routing?.cable) === J(["clubkonnect"]),
  "routing: airtime / data → ClubKonnect then Bigisub; cable stays ClubKonnect", J(st?.routing));

reset({ real: { "APIAirtimeV1.asp": "ok" } }); rid = ref();
r = await airtime(rid);
ok(r?.status === "SUCCESS" && !bgLog.some((x) => x.startsWith("buy")), "ClubKonnect works → it serves the order, Bigisub not touched", J([r, bgLog]));

reset({ real: { "APIAirtimeV1.asp": "lowwallet" } }); rid = ref();
r = await airtime(rid);
const row = claims.get(rid);
ok(r?.status === "SUCCESS" && r?.provider === "bigisub" && bgLog.includes(`buy:airtime:${PHONE}:100:pin=true`), "ClubKonnect's wallet empty → Bigisub delivers (with our PIN)", J([r, bgLog]));
ok(J(row?.providers) === J(["clubkonnect", "bigisub"]) && /^AirT\d+$/.test(row?.bg_tranx_id || "") && row?.bg_meta?.phone === PHONE, "claim row: both providers, Bigisub's id and what we sent stored", J(row));
ok(alerts.some((a) => a.title === "Bills moved to the backup provider"), "admins told the order moved to the backup", J(alerts.map((a) => a.title)));
r = await call({ action: "verify", requestId: rid, service: "airtime" });
ok(r?.status === "SUCCESS" && r?.provider === "bigisub" && bgLog.some((x) => x.startsWith("status:AirT")), "verify asks Bigisub by its stored id → SUCCESS", J([r, bgLog]));

reset({ real: { "APIAirtimeV1.asp": "badnumber" } }); rid = ref();
r = await airtime(rid);
ok(!!r?.error && !bgLog.some((x) => x.startsWith("buy")), "ClubKonnect refuses the NUMBER → not sent to Bigisub", J([r, bgLog]));

reset({ real: { "APIAirtimeV1.asp": "lowwallet" }, bgMode: "poor" }); rid = ref();
r = await airtime(rid);
ok(!!r?.error && !/pending|confirm/i.test(r.error) && !bgLog.some((x) => x.startsWith("history")), "both wallets empty → clean failure (refund), no history search", J([r, bgLog]));

reset({ real: { "APIAirtimeV1.asp": "lowwallet" }, bgMode: "badnumber" }); rid = ref();
r = await airtime(rid);
ok(r?.error === "Enter a valid 11-digit phone number", "Bigisub refuses the number → the customer sees why", J(r));

reset({ real: { "APIAirtimeV1.asp": "lowwallet" }, bgMode: "lost" }); rid = ref();
r = await airtime(rid);
ok(r?.status === "SUCCESS" && r?.provider === "bigisub" && bgLog.filter((x) => x.startsWith("buy")).length === 1 && bgLog.some((x) => x === `history:${PHONE}:airtime`),
  "Bigisub's reply lost → found in its history → delivered, bought ONCE", J([r, bgLog]));
ok(/^AirT\d+$/.test(claims.get(rid)?.bg_tranx_id || ""), "…and the id found in the history is stored", J(claims.get(rid)));

reset({ real: { "APIAirtimeV1.asp": "lowwallet" }, bgMode: "lost-none" }); rid = ref();
r = await airtime(rid);
ok(/confirm|pending|processing/i.test(r?.error || r?.message || J(r)) && bgLog.filter((x) => x.startsWith("buy")).length === 1, "Bigisub's reply lost and NOT in its history → held (confirming), never refunded", J([r, bgLog]));
r = await call({ action: "verify", requestId: rid, service: "airtime" });
ok(r?.status === "PENDING", "verify soon after → still PENDING (its history may lag)", J(r));
claims.get(rid).bg_meta.sent_at = new Date(Date.now() - 40 * 60_000).toISOString();
r = await call({ action: "verify", requestId: rid, service: "airtime" });
ok(r?.status === "NOT_FOUND", "verify 40 minutes after sending, still not in its history → NOT_FOUND (refundable)", J(r));

reset({ real: { "APIAirtimeV1.asp": "lowwallet" }, bgMode: "processing" }); rid = ref();
r = await airtime(rid);
ok(/confirm|pending|processing/i.test(r?.error || r?.message || J(r)), "Bigisub processing → held", J(r));
bgLookupStatus = "failed";
r = await call({ action: "verify", requestId: rid, service: "airtime" });
ok(r?.status === "FAILED" && bgLog.some((x) => x.startsWith("requery:")), "verify: still processing → requery → failed (refunded on Bigisub's side) → FAILED", J([r, bgLog]));

console.log("data…");
reset({ ckBalance: "900" }); await fresh();
r = await call({ action: "data-plans", network: "MTN" });
ok(r?._provider === "bigisub" && r?.plans?.length === 1 && r.plans[0].plan_id === "bg:298" && r.plans[0].plan_amount === 455 && r.plans[0].cost_amount === 450,
  "ClubKonnect wallet under ₦1,500 → Bigisub's plans (disabled ones out), sold at its public price, our cost its corporate price", J(r));
reset({ ckBalance: "900" }); rid = ref();
r = await call({ action: "data", phone: PHONE, network: "MTN", planId: "bg:298", requestId: rid });
ok(r?.status === "SUCCESS" && r?.provider === "bigisub" && bgLog.includes(`buy:data:${PHONE}:298:pin=true`) && !ckLog.some((x) => x.startsWith("APIDatabundleV1")),
  "a Bigisub plan buys on Bigisub only", J([r, bgLog, ckLog]));
ok(costs.some((c) => c.p_provider === "bigisub" || J(c).includes("bigisub")) || costs.length >= 1, "data cost recorded for the finance ledger", J(costs));
reset({ ckBalance: "500000" }); await fresh();
r = await call({ action: "data-plans", network: "MTN" });
ok(r?._provider !== "bigisub" && r?.plans?.some((p) => p.plan_id === "500"), "ClubKonnect wallet fine → ClubKonnect's plans as before", J(r));
r = await call({ action: "bill-preflight", cat: "airtime", network: "MTN", amount: 100 });
ok(r?.ok === true, "preflight: airtime open", J(r));
reset({ ckBalance: "50" }); await fresh();
r = await call({ action: "bill-preflight", cat: "airtime", network: "MTN", amount: 100 });
ok(r?.ok === true && r?.provider === "bigisub", "preflight: ClubKonnect wallet can't cover it → still open, Bigisub will take it", J(r));

console.log(fails ? `\n${fails} of ${checks} checks FAILED` : `\nall ${checks} checks passed`);
if (fails) console.log("--- function log tail ---\n" + fnLog.slice(-4000));
cleanup();
process.exit(fails ? 1 : 0);
