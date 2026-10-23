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
  if (path === "APIDatabundlePlansV2.asp") return send(200, { MOBILE_NETWORK: { MTN: [{ ID: "01", PRODUCT: [{ PRODUCT_ID: "500", PRODUCT_NAME: "500 MB - 30 days (SME)", PRODUCT_AMOUNT: "140" },
    { PRODUCT_ID: "1000", PRODUCT_NAME: "1 GB - Weekly (SME)", PRODUCT_AMOUNT: "410" }] }] } });
  if (path === "APIWAECPackagesV2.asp") return send(200, { EXAM_TYPE: [{ PRODUCT_CODE: "waecdirect", PRODUCT_DESCRIPTION: "WAEC Result Checker PIN", PRODUCT_AMOUNT: "5350" }] });
  if (path === "APIWAECV1.asp" && real[path] === "ok") return send(200, { statuscode: "100", status: "ORDER_RECEIVED", orderid: "CK-WAEC", carddetails: "Serial No:CKS1, PIN: CKPIN1" });
  const mode = real[path];
  if (mode === "lowwallet") return send(200, { status: "INSUFFICIENT_BALANCE" });
  if (mode === "invalidplan") return send(200, { status: "INVALID_DATAPLAN" });
  if (mode === "badnumber") return send(200, { status: "INVALID_MOBILENUMBER" });
  if (mode === "ok") return send(200, { statuscode: "100", status: "ORDER_RECEIVED", orderid: `CK-${path}`, requestid: p.RequestID });
  if (mode === "elec-token") return send(200, { statuscode: "200", status: "ORDER_COMPLETED", orderid: "CK-ELEC", metertoken: "99998888777766665555" });
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
      { id: 299, network: 1, plantype: "SME", size: 2, plan_volume: "GB", validity: "30 days", amount: 900, corporate_amount: 880, plan_disabled: true },
      { id: 310, network: 1, plantype: "SME", size: 500, plan_volume: "MB", validity: "30 days", amount: 120, corporate_amount: 100, plan_disabled: false }] });
    if (P === "/bills/education/services/") return send(200, { success: true, data: { services: [
      { id: "WAEC", name: "WAEC Result Checker", type: "WAEC", regular_price: 5250, corporate_price: 5200 },
      { id: "NECO", name: "NECO Result Checker", type: "NECO", regular_price: 2500, corporate_price: 2450 },
      { id: "NABTEB", name: "NABTEB Result Checker", type: "NABTEB", regular_price: 1000, corporate_price: 955 }] } });
    if (P === "/bills/result-checker/purchase/") {
      bgLog.push(`exam:${body.exam}:${body.quantity}:pin=${body.pin_code === PIN}`);
      if (body.pin_code !== PIN) return send(400, { success: false, message: "Invalid transaction PIN" });
      if (bgMode === "poor") return send(402, { success: false, message: "Insufficient balance" });
      const id = `EduT${++bgN}`;
      return send(201, { success: true, data: { transaction_id: id, status: "successful", exam_type: body.exam, quantity: 1, unit_price: 5200, total_amount: 5200, pins: [`${body.exam}-PIN-${bgN}`] } });
    }
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
    if (P === "/bills/electricity/providers/") return send(200, { success: true, data: { providers: [
      { name: "Ikeja Electric - IKEDC", code: "ikeja-electric", min_amount_prepaid: 1000, min_amount_postpaid: 500, service_charge: 100, service_charge_type: "fixed" },
      { name: "IBEDC", code: "ibadan-electric", min_amount_prepaid: 2000, min_amount_postpaid: 2000, service_charge: 100, service_charge_type: "fixed" }] } });
    if (P === "/bills/electricity/verify/") {
      bgLog.push(`meter:${body.company}:${body.meter_no}:${body.meter_type}`);
      if (body.meter_no === "0000000000") return send(404, { success: false, message: "Meter not found" });
      return send(200, { success: true, data: { customer_name: "ADA OBI", customer_address: "1 Allen Ave", meter_number: body.meter_no, meter_type: body.meter_type } });
    }
    if (P === "/bills/electricity/pay/") {
      bgLog.push(`elec:${body.company}:${body.meter_no}:${body.amount}:${body.Customer_name}:pin=${body.pin === PIN}`);
      if (body.pin !== PIN) return send(400, { success: false, message: "Invalid transaction PIN" });
      if (bgMode === "poor") return send(402, { success: false, message: "Insufficient balance" });
      const id = `ElecT${++bgN}`;
      const status = bgMode === "processing" ? "processing" : "successful";
      const token = status === "successful" && body.meter_type === "prepaid" ? "1234-5678-9012-3456-7890" : "";
      bgOrders.set(id, { status, svc: "electricity", token: token || "5555-4444-3333-2222-1111" });
      bgHistory.unshift({ tranx_id: id, unique_element: body.meter_no, status, service_type: "electricity", date_created: lagosNow(), transaction_amount: String(body.amount + 100) });
      return send(201, { success: true, data: { transaction_id: id, status, amount: body.amount, service_charge: 100, total_amount: body.amount + 100, ...(token ? { token, units: "45.2kWh" } : {}) }, message: "ok" });
    }
    if (P === "/vtu/cable/plans/") { bgLog.push("cableplans"); return send(200, { success: true, data: [
      { id: 55, cable_name: "dstv", product_name: "DStv Padi N4,400", variation_code: "dstv-padi", amount: 4400 },
      { id: 95, cable_name: "dstv", product_name: "Movie Bundle Add-on N3500", variation_code: "dstv-movie-bundle-add-on", amount: 3500 },
      { id: 98, cable_name: "dstv", product_name: "Compact Plus Movie Add-on N3,500", variation_code: "dstv-compact-plus-movie", amount: 3500 }] }); }
    if (P === "/vtu/cable/verify/") { bgLog.push(`cableverify:${body.card_no}`); return send(200, { success: true, data: { valid: true, customer_name: "ADA OBI" } }); }
    if (P === "/vtu/cable/purchase/") {
      bgLog.push(`cable:${body.cable_type}:${body.card_no}:${body.amount}:${body.Customer}:pin=${body.pin === PIN}`);
      if (bgMode === "poor") return send(402, { success: false, message: "Insufficient balance" });
      const id = `CableT${++bgN}`; bgOrders.set(id, { status: "successful", svc: "cable" });
      return send(201, { success: true, data: { transaction_id: id, status: "successful" } });
    }
    if (P === "/betting/validate/") { bgLog.push(`betvalidate:${body.biller_code}:${body.customer_id}`); return send(200, { success: true, data: { valid: true, customer_name: "John Doe", validation_reference: "VR-1" } }); }
    if (P === "/betting/fund/") {
      bgLog.push(`bet:${body.biller_code}:${body.customer_id}:${body.amount}:${body.validation_reference}:pin=${body.pin_code === PIN}`);
      const id = `MONBET${++bgN}`; bgOrders.set(id, { status: "successful", svc: "betting" });
      return send(201, { success: true, data: { transaction_id: id, status: "successful" } });
    }
    if (P === "/isp/smile/plans/") return send(200, { success: true, data: [{ id: 45, variation_code: "858", name: "Smile 450GB" }, { id: 1, variation_code: "airtime", name: "Buy Airtime" }] });
    if (P === "/isp/smile/verify/") { bgLog.push(`smileverify:${body.account_id}`); return send(200, { success: true, data: { verified: true, customer_name: "TOLU" } }); }
    if (P === "/isp/smile/topup/") {
      bgLog.push(`smile:${body.plan}:${body.account_id}:pin=${body.pin === PIN}`);
      const id = `SMLT${++bgN}`; bgOrders.set(id, { status: "successful", svc: "smile" });
      return send(201, { success: true, data: { transaction_id: id, status: "successful" } });
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
      if (o.svc === "electricity") {
        // as live (22 Oct): once vended, the STATUS read carries the token; a requery of a finished order says "processing", no token
        if (bgLookupStatus) o.status = bgLookupStatus;
        if (m[2]) return send(200, { success: true, data: { tranx_id: m[1], old_status: o.status, new_status: o.status === "successful" ? "processing" : o.status } });
        return send(200, { success: true, data: { tranx_id: m[1], service_type: "electricity", status: o.status, ...(o.status === "successful" ? { token: o.token, units: "12.5" } : {}) } });
      }
      const st = m[2] ? (bgLookupStatus ?? o.status) : o.status;   // a status read shows what Bigisub last stored; a requery asks the network
      return send(200, { success: true, data: m[2] ? { tranx_id: m[1], old_status: o.status, new_status: st } : { tranx_id: m[1], status: st } });
    }
    send(404, { success: false, message: "Not found" });
  });
});

// ── fake Supabase (PostgREST) ─────────────────────────────────────────────────────────────────────────────────────
let config = {}, alerts = [], claims = new Map(), costs = [], planBlocks = new Map();
const rowOut = (rid, r) => ({ request_id: rid, providers: r.providers, vt_request_id: r.vt ?? null, bg_tranx_id: r.bg_tranx_id ?? null, bg_meta: r.bg_meta ?? null, service: r.service, ck_last_sent_at: r.ck_last_sent_at ?? null });
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
    if (u.pathname === "/rest/v1/rpc/bill_plan_block") {
      const a = JSON.parse(b), k = `${a.p_provider}|${a.p_service}|${a.p_network}|${a.p_plan_id}`;
      const was = planBlocks.get(k), until = Date.now() + a.p_hours * 3600_000;
      planBlocks.set(k, { until, name: a.p_plan_name, count: (was?.count ?? 0) + 1 });
      return send(200, !(was && was.until > Date.now()));
    }
    const t = /^\/rest\/v1\/(\w+)/.exec(u.pathname)?.[1];
    if (t === "bill_provider_attempts") {
      const rid = (u.searchParams.get("request_id") || "").replace(/^eq\./, "");
      if (req.method === "PATCH") {
        const row = claims.get(rid);
        const wantRows = (req.headers.prefer || "").includes("return=representation");
        if (!row || (u.searchParams.get("bg_meta") === "is.null" && row.bg_meta != null)) return wantRows ? send(200, []) : send(204, null);
        Object.assign(row, JSON.parse(b));
        return wantRows ? send(200, [rowOut(rid, row)]) : send(204, null);
      }
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
    if (t === "bill_plan_blocks") {
      const q = (f) => (u.searchParams.get(f) || "").replace(/^eq\./, "");
      const pre = `${q("provider")}|${q("service")}|${q("network")}|`;
      if (req.method === "DELETE") { planBlocks.delete(pre + q("plan_id")); return send(204, null); }
      const since = Date.parse((u.searchParams.get("blocked_until") || "").replace(/^gt\./, ""));
      return send(200, [...planBlocks.entries()].filter(([k, v]) => k.startsWith(pre) && v.until > since).map(([k]) => ({ plan_id: k.slice(pre.length) })));
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

console.log("never bought twice on Bigisub…");
reset({ real: { "APIAirtimeV1.asp": "lowwallet" }, bgMode: "processing" }); rid = ref();
r = await airtime(rid);
r = await airtime(rid);   // the app retries on the "confirming" answer
ok(bgLog.filter((x) => x.startsWith("buy")).length === 1 && /confirm|pending/i.test(r?.error || ""), "a retry of an order Bigisub is processing is looked up, not bought again", J([r, bgLog]));
reset({ real: { "APIAirtimeV1.asp": "lowwallet" } }); rid = ref();
r = await airtime(rid); r = await airtime(rid);
ok(r?.status === "SUCCESS" && bgLog.filter((x) => x.startsWith("buy")).length === 1, "a retry of an order Bigisub delivered → SUCCESS from its record, bought once", J([r, bgLog]));
reset({ real: { "APIAirtimeV1.asp": "lowwallet" }, bgMode: "poor" }); rid = ref();
r = await airtime(rid);
bgMode = "ok"; r = await airtime(rid);
ok(r?.status === "SUCCESS" && bgLog.filter((x) => x.startsWith("buy")).length === 2, "Bigisub refused (its wallet) → nothing placed, so a later retry may send it", J([r, bgLog]));

console.log("ClubKonnect timed out, then confirmed no order → Bigisub (rule 14)…");
const later = (o) => call({ action: "airtime", phone: PHONE, network: "MTN", amount: "100", requestId: o, afterNoOrder: true });
reset(); rid = ref();
r = await airtime(rid);   // ClubKonnect answers nothing usable and holds no order → a plain failure, claim stays with ClubKonnect
ok(!!r?.error && J(claims.get(rid)?.providers) === J(["clubkonnect"]) && !!claims.get(rid)?.ck_last_sent_at, "the send to ClubKonnect is stamped on the order", J([r, claims.get(rid)]));
r = await later(rid);
ok(/confirm/i.test(r?.error || "") && !bgLog.some((x) => x.startsWith("buy")), "asked to move right after the send → held, NOT moved (ClubKonnect may still deliver)", J([r, bgLog]));
claims.get(rid).ck_last_sent_at = new Date(Date.now() - 120_000).toISOString();
const ckBuys = () => ckLog.filter((x) => x.startsWith("APIAirtimeV1")).length;
const before = ckBuys();
r = await later(rid);
ok(r?.status === "SUCCESS" && r?.provider === "bigisub" && bgLog.filter((x) => x.startsWith("buy")).length === 1 && ckBuys() === before && ckLog.some((x) => x.startsWith("APIQueryV1")),
  "2 minutes quiet + ClubKonnect's lookup finds no order → bought on Bigisub, not re-sent to ClubKonnect", J([r, bgLog, ckLog]));
ok(J(claims.get(rid)?.providers) === J(["clubkonnect", "bigisub"]) && alerts.some((a) => a.title === "Bills moved to the backup provider"), "…the move is recorded and admins told", J([claims.get(rid), alerts.map((a) => a.title)]));
r = await later(rid); const r2 = await airtime(rid);
ok(r?.status === "SUCCESS" && r2?.status === "SUCCESS" && bgLog.filter((x) => x.startsWith("buy")).length === 1, "asking again (either way) never buys it twice", J([r, r2, bgLog]));
reset(); rid = ref();
r = await airtime(rid); delete claims.get(rid).ck_last_sent_at;
r = await later(rid);
ok(r?.error === "Airtime purchase failed. You have not been charged." && !bgLog.some((x) => x.startsWith("buy")), "no record of when ClubKonnect got it → not moved (plain failure)", J([r, bgLog]));
r = await later(ref());
ok(r?.error === "Airtime purchase failed. You have not been charged." && !bgLog.some((x) => x.startsWith("buy")), "an order never sent anywhere → nothing to move", J([r, bgLog]));
config = { ...BASE_CFG, bill_provider_bigisub: "false" }; await fresh(); reset(); rid = ref();
r = await airtime(rid); claims.get(rid).ck_last_sent_at = new Date(Date.now() - 120_000).toISOString();
r = await later(rid);
ok(r?.error === "Airtime purchase failed. You have not been charged." && !bgLog.some((x) => x.startsWith("buy")), "Bigisub off → not moved", J([r, bgLog]));
config = { ...BASE_CFG, bill_provider_bigisub: "true" }; await fresh();

console.log("data…");
reset({ ckBalance: "900" }); await fresh();
r = await call({ action: "data-plans", network: "MTN" });
ok(r?._provider === "bigisub" && !r.plans.some((p) => p.plan_id === "bg:299") && r.plans.find((p) => p.plan_id === "bg:298")?.plan_amount === 455 && r.plans.find((p) => p.plan_id === "bg:298")?.cost_amount === 450,
  "ClubKonnect wallet under ₦1,500 → Bigisub's plans (disabled ones out), sold at its public price, our cost its corporate price", J(r));
reset({ ckBalance: "900" }); rid = ref();
r = await call({ action: "data", phone: PHONE, network: "MTN", planId: "bg:298", requestId: rid });
ok(r?.status === "SUCCESS" && r?.provider === "bigisub" && bgLog.includes(`buy:data:${PHONE}:298:pin=true`) && !ckLog.some((x) => x.startsWith("APIDatabundleV1")),
  "a Bigisub plan buys on Bigisub only", J([r, bgLog, ckLog]));
ok(costs.some((c) => c.p_provider === "bigisub" || J(c).includes("bigisub")) || costs.length >= 1, "data cost recorded for the finance ledger", J(costs));
reset({ ckBalance: "500000" }); await fresh();
r = await call({ action: "data-plans", network: "MTN" });
ok(r?._provider !== "bigisub" && r?.plans?.some((p) => p.plan_id === "1000"), "ClubKonnect wallet fine → ClubKonnect's list (with cheaper Bigisub plans swapped in, checked below)", J(r));
r = await call({ action: "bill-preflight", cat: "airtime", network: "MTN", amount: 100 });
ok(r?.ok === true, "preflight: airtime open", J(r));
reset({ ckBalance: "50" }); await fresh();
r = await call({ action: "bill-preflight", cat: "airtime", network: "MTN", amount: 100 });
ok(r?.ok === true && r?.provider === "bigisub", "preflight: ClubKonnect wallet can't cover it → still open, Bigisub will take it", J(r));

console.log("cheapest provider per data plan…");
reset({ ckBalance: "500000" }); await fresh();
r = await call({ action: "data-plans", network: "MTN" });
const p500 = r?.plans?.find((p) => p.plan_id === "bg:310"), p1g = r?.plans?.find((p) => p.plan_id === "1000");
ok(!!p500 && p500.plan_amount === 140 && p500.cost_amount === 100 && p500.replaces === "500" && !r.plans.some((p) => p.plan_id === "500"),
  "500MB/30 days: Bigisub ₦100 < ClubKonnect ₦140 → Bigisub's plan shown at the SAME customer price (₦140)", J(r?.plans));
ok(!!p1g && !r.plans.some((p) => p.plan_id === "bg:298"), "1GB weekly: Bigisub isn't ₦5+ cheaper → ClubKonnect's plan stays", J(r?.plans));
r = await call({ action: "bill-preflight", cat: "data", network: "MTN", amount: 140, planId: "bg:310" });
ok(r?.ok === true && r?.provider === "bigisub", "preflight for a Bigisub plan checks Bigisub's wallet", J(r));

console.log("exam PINs…");
reset(); await fresh();
r = await call({ action: "exam-price", exam: "waec", examType: "waecdirect" });
ok(r?.amount === 5350 && r?.provider === "bigisub", "WAEC price: we keep charging ClubKonnect's ₦5,350 while Bigisub sells it to us for ₦5,200", J(r));
r = await call({ action: "exam-price", exam: "waec", examType: "neco" });
ok(r?.amount === 2500 && r?.provider === "bigisub", "NECO price from Bigisub (₦2,500)", J(r));
reset({ real: { "APIWAECV1.asp": "ok" } }); rid = ref();
r = await call({ action: "waec", examType: "waecdirect", phone: PHONE, requestId: rid });
ok(r?.status === "SUCCESS" && r?.provider === "bigisub" && /PIN: WAEC-PIN-/.test(r?.cardDetails || "") && !ckLog.some((x) => x.startsWith("APIWAECV1")),
  "WAEC result checker bought on Bigisub first, PIN on the receipt, ClubKonnect not used", J([r, bgLog, ckLog]));
reset({ real: { "APIWAECV1.asp": "ok" }, bgMode: "poor" }); rid = ref();
r = await call({ action: "waec", examType: "waecdirect", phone: PHONE, requestId: rid });
ok(r?.status === "SUCCESS" && /CKPIN1/.test(r?.cardDetails || "") && ckLog.some((x) => x.startsWith("APIWAECV1")), "Bigisub's wallet empty → WAEC falls back to ClubKonnect", J([r, ckLog]));
reset(); rid = ref();
r = await call({ action: "waec", examType: "nabteb", phone: PHONE, requestId: rid });
ok(r?.status === "SUCCESS" && /NABTEB-PIN-/.test(r?.cardDetails || "") && bgLog.includes("exam:NABTEB:1:pin=true"), "NABTEB bought on Bigisub", J([r, bgLog]));
reset({ real: { "APIWAECV1.asp": "ok" } }); rid = ref();
r = await call({ action: "waec", examType: "waec-registration", phone: PHONE, requestId: rid });
ok(!bgLog.some((x) => x.startsWith("exam:")), "WAEC registration never goes to Bigisub", J([r, bgLog]));
config = { ...BASE_CFG, bill_provider_bigisub: "false" }; await fresh(); reset(); rid = ref();
r = await call({ action: "waec", examType: "neco", phone: PHONE, requestId: rid });
ok(/aren't available/.test(r?.error || "") && !bgLog.length, "Bigisub switched off → NECO cleanly unavailable, nothing bought", J([r, bgLog]));

console.log("ClubKonnect refuses a plan it still lists → Bigisub's plan of the same size and validity (2026-10-23)…");
config = { ...BASE_CFG, bill_provider_bigisub: "true" }; await fresh();
reset({ real: { "APIDatabundleV1.asp": "invalidplan" } }); rid = ref();
r = await call({ action: "data", phone: PHONE, network: "MTN", planId: "500", requestId: rid });
ok(r?.status === "SUCCESS" && r?.provider === "bigisub" && bgLog.includes(`buy:data:${PHONE}:310:pin=true`) && ckLog.filter((x) => x.startsWith("APIDatabundleV1")).length === 1,
  "500MB / 30 days refused by ClubKonnect → Bigisub's 500MB / 30 days bought (₦100 ≤ the ₦140 paid), ClubKonnect not asked again", J([r, bgLog, ckLog]));
ok(J(claims.get(rid)?.providers) === J(["clubkonnect", "bigisub"]) && alerts.some((a) => a.title === "Bills moved to the backup provider"), "…recorded on the claim, admins told", J([claims.get(rid), alerts.map((a) => a.title)]));
reset({ real: { "APIDatabundleV1.asp": "invalidplan" } }); rid = ref();
r = await call({ action: "data", phone: PHONE, network: "MTN", planId: "1000", requestId: rid });
ok(!!r?.error && /INVALID_DATAPLAN/.test(r.error) && !bgLog.some((x) => x.startsWith("buy:")), "1GB weekly: Bigisub's costs more than the customer paid → never at a loss, fails and is refunded as before", J([r, bgLog]));

console.log("…and a refused plan is hidden from the list for 24 h (2026-10-23)…");
ok(planBlocks.get("clubkonnect|data|MTN|500")?.until > Date.now() + 23 * 3600_000 && planBlocks.has("clubkonnect|data|MTN|1000"), "both refused plans recorded as hidden for 24 h", J([...planBlocks]));
ok(alerts.some((a) => a.title === "ClubKonnect refused a data plan — MTN 1 GB - Weekly (SME) hidden for 24 h"), "admins told which plan was hidden", J(alerts.map((a) => a.title)));
reset(); await fresh();
r = await call({ action: "data-plans", network: "MTN" });
ok(!r?.plans?.some((p) => p.plan_id === "1000" || p.plan_id === "500") && r?.plans?.find((p) => p.replaces === "500")?.plan_id === "bg:310" && r.plans.find((p) => p.replaces === "500").plan_amount === 140,
  "list: 1GB weekly gone (no Bigisub plan fits), 500MB shows as Bigisub's 500MB at the same ₦140", J(r));
config = { ...BASE_CFG, bill_provider_bigisub: "false" }; await fresh();
r = await call({ action: "data-plans", network: "MTN" });
ok(Array.isArray(r?.plans) && !r.plans.some((p) => p.plan_id === "1000" || p.plan_id === "500" || String(p.plan_id).startsWith("bg:")), "Bigisub off → the refused plans are simply hidden", J(r));
r = await call({ action: "data-plans", network: "MTN", print: true });
ok(r?.plans?.some((p) => p.plan_id === "1000"), "Print Data list is untouched", J(r));
config = { ...BASE_CFG, bill_provider_bigisub: "true" }; await fresh();
reset({ real: { "APIDatabundleV1.asp": "invalidplan" } });
r = await call({ action: "data", phone: PHONE, network: "MTN", planId: "1000", requestId: ref() });
ok(!alerts.some((a) => /refused a data plan/.test(a.title)) && planBlocks.get("clubkonnect|data|MTN|1000")?.count === 2, "refused again while hidden → hiding extended, admins not told twice", J([alerts.map((a) => a.title), [...planBlocks]]));
reset({ real: { "APIDatabundleV1.asp": "ok" } });
r = await call({ action: "data", phone: PHONE, network: "MTN", planId: "1000", requestId: ref() });
await sleep(500);
ok(r?.status === "SUCCESS" && !planBlocks.has("clubkonnect|data|MTN|1000") && planBlocks.has("clubkonnect|data|MTN|500"), "a delivered order for a hidden plan brings it back at once", J([r, [...planBlocks]]));
planBlocks.clear();

console.log("cable / betting / Smile: Bigisub backs ClubKonnect up only once switched on (2026-10-23)…");
const cable = (o, pkg = "dstv-padi", card = "1234567890") => call({ action: "cable", provider: "dstv", packageId: pkg, smartcard: card, phone: PHONE, requestId: o });
const bet = (o) => call({ action: "betting", company: "product-bet-king", customerId: "BK-778", amount: "500", requestId: o });
const smile = (o) => call({ action: "smile", accountNo: "08051112222", planId: "858", requestId: o });
config = { ...BASE_CFG, bill_provider_bigisub: "true" }; await fresh();
reset({ real: { "APICableTVV1.asp": "lowwallet", "APIBettingV1.asp": "lowwallet", "APISmileV1.asp": "lowwallet" } });
r = await cable(ref()); const r2b = await bet(ref()); const r3s = await smile(ref());
ok(!!r?.error && !!r2b?.error && !!r3s?.error && bgLog.length === 0, "not switched on yet: ClubKonnect's empty wallet → clean failure, Bigisub never contacted", J([r, r2b, r3s, bgLog]));
config = { ...BASE_CFG, bill_provider_bigisub: "true", bill_bigisub_services: "airtime,data,electricity,cable,betting,smile" }; await fresh();
reset({ real: { "APICableTVV1.asp": "ok", "APIBettingV1.asp": "ok", "APISmileV1.asp": "ok" } });
r = await cable(ref());
ok(r?.status === "SUCCESS" && r?.provider !== "bigisub" && bgLog.length === 0, "ClubKonnect works → Bigisub not even asked (no extra checks slow the order down)", J([r, bgLog]));
reset({ real: { "APICableTVV1.asp": "lowwallet" } }); rid = ref();
r = await cable(rid);
ok(r?.status === "SUCCESS" && r?.provider === "bigisub" && bgLog.includes("cableverify:1234567890") && bgLog.includes("cable:dstv:1234567890:4400:ADA OBI:pin=true"),
  "cable: ClubKonnect's wallet empty → Bigisub subscribes DStv Padi (₦4,400, the verified name)", J([r, bgLog]));
ok(J(claims.get(rid)?.providers) === J(["clubkonnect", "bigisub"]), "…the move is on the claim", J(claims.get(rid)));
reset({ real: { "APICableTVV1.asp": "lowwallet" } });
r = await cable(ref(), "dstv-movie-bundle-add-on");
ok(!!r?.error && !bgLog.some((x) => x.startsWith("cable:")), "a package whose price another package shares is never bought on Bigisub (it buys by amount)", J([r, bgLog]));
reset({ real: { "APICableTVV1.asp": "badnumber" } });
r = await cable(ref());
ok(!!r?.error && bgLog.length === 0, "ClubKonnect refuses the CUSTOMER (bad smartcard) → not moved", J([r, bgLog]));
reset({ real: { "APIBettingV1.asp": "lowwallet" } }); rid = ref();
r = await bet(rid);
ok(r?.status === "SUCCESS" && r?.provider === "bigisub" && bgLog.includes("betvalidate:biller-bet-king:BK-778") && bgLog.includes("bet:biller-bet-king:BK-778:500:VR-1:pin=true"),
  "betting: validated on Bigisub (BetKing → biller-bet-king), funded with its validation reference", J([r, bgLog]));
reset({ real: { "APISmileV1.asp": "lowwallet" } }); rid = ref();
r = await smile(rid);
ok(r?.status === "SUCCESS" && r?.provider === "bigisub" && bgLog.includes("smileverify:08051112222") && bgLog.includes("smile:45:08051112222:pin=true"),
  "Smile: same plan code (858 → Bigisub plan 45), account verified, topped up", J([r, bgLog]));
r = await call({ action: "verify", requestId: rid, service: "smile" });
ok(r?.status === "SUCCESS" && r?.provider === "bigisub", "verify asks Bigisub for a moved Smile order", J(r));

console.log("owner's own test: cable / betting / Smile to Bigisub FIRST…");
config = { ...BASE_CFG, bill_provider_bigisub: "true", bill_bigisub_services: "airtime,data,electricity,cable,betting,smile", bill_bigisub_first: "cable,betting,smile" }; await fresh();
reset({ real: { "APICableTVV1.asp": "ok" } }); rid = ref();
r = await cable(rid);
ok(r?.status === "SUCCESS" && r?.provider === "bigisub" && !ckLog.some((x) => x.startsWith("APICableTVV1")), "test mode: cable goes to Bigisub first, ClubKonnect not used", J([r, ckLog]));
reset({ real: { "APICableTVV1.asp": "ok" } }); rid = ref();
r = await cable(rid, "dstv-movie-bundle-add-on");
ok(r?.status === "SUCCESS" && r?.provider !== "bigisub" && ckLog.some((x) => x.startsWith("APICableTVV1")) && !bgLog.some((x) => x.startsWith("cable:")),
  "test mode: a package Bigisub can't take (shared price) still goes through ClubKonnect", J([r, bgLog, ckLog]));

console.log("Bigisub FIRST for airtime and electricity (owner, 2026-10-21)…");
config = { ...BASE_CFG, bill_provider_bigisub: "true", bill_bigisub_first: "airtime,electricity" }; await fresh(); reset();
st = await fresh();
ok(J(st?.routing?.airtime) === J(["bigisub", "clubkonnect"]) && J(st?.routing?.electricity) === J(["bigisub", "clubkonnect"]) && J(st?.routing?.data) === J(["clubkonnect", "bigisub"]),
  "routing: airtime and electricity → Bigisub then ClubKonnect; data unchanged", J(st?.routing));
reset({ real: { "APIAirtimeV1.asp": "ok" } }); rid = ref();
r = await airtime(rid);
ok(r?.status === "SUCCESS" && r?.provider === "bigisub" && !ckLog.some((x) => x.startsWith("APIAirtimeV1")), "airtime bought on Bigisub, ClubKonnect not used", J([r, ckLog]));
reset({ real: { "APIAirtimeV1.asp": "ok" }, bgMode: "poor" }); rid = ref();
r = await airtime(rid);
ok(r?.status === "SUCCESS" && r?.provider !== "bigisub" && ckLog.some((x) => x.startsWith("APIAirtimeV1")), "Bigisub's wallet can't cover it → ClubKonnect delivers", J([r, ckLog]));
const elec = (o, x = {}) => call({ action: "electricity", company: "02", meterType: "01", meterNo: "45012345678", amount: "1000", phone: PHONE, requestId: o, ...x });
reset();
r = await call({ action: "electricity-verify", company: "02", meterNo: "45012345678", meterType: "01" });
ok(r?.customer_name === "ADA OBI" && bgLog.includes("meter:ikeja-electric:45012345678:prepaid") && !ckLog.some((x) => x.startsWith("APIVerifyElectricity")), "meter check asks Bigisub", J([r, bgLog, ckLog]));
reset({ real: { "APIElectricityV1.asp": "elec-token" } }); rid = ref();
r = await elec(rid);
ok(r?.status === "SUCCESS" && r?.provider === "bigisub" && r?.token === "1234-5678-9012-3456-7890" && bgLog.includes(`elec:ikeja-electric:45012345678:1000:ADA OBI:pin=true`) && !ckLog.some((x) => x.startsWith("APIElectricityV1")),
  "prepaid electricity bought on Bigisub with the checked name; token on the receipt; ClubKonnect not used", J([r, bgLog, ckLog]));
for (let i = 0; i < 20 && !costs.some((c) => c.p_request_id === rid); i++) await sleep(100);   // written just after the reply
ok(costs.some((c) => c.p_request_id === rid && c.p_cost_kobo === 110000 && c.p_face_kobo === 100000), "our real cost recorded: ₦1,000 + Bigisub's ₦100 charge", J(costs));
reset({ real: { "APIElectricityV1.asp": "elec-token" } }); rid = ref();
r = await call({ action: "electricity", company: "07", meterType: "01", meterNo: "45012345678", amount: "1500", phone: PHONE, requestId: rid });
ok(r?.status === "SUCCESS" && r?.token === "99998888777766665555" && !bgLog.some((x) => x.startsWith("elec:")), "below Bigisub's disco minimum (IBEDC ₦2,000) → ClubKonnect takes it", J([r, bgLog]));
reset({ real: { "APIElectricityV1.asp": "elec-token" }, bgMode: "poor" }); rid = ref();
r = await elec(rid);
ok(r?.status === "SUCCESS" && r?.token === "99998888777766665555" && J(claims.get(rid)?.providers) === J(["bigisub", "clubkonnect"]), "Bigisub's wallet can't cover it → ClubKonnect delivers", J([r, claims.get(rid)]));
reset({ real: { "APIElectricityV1.asp": "elec-token" } }); rid = ref();
r = await elec(rid, { meterNo: "0000000000" });
ok(!bgLog.some((x) => x.startsWith("elec:")) && ckLog.some((x) => x.startsWith("APIElectricityV1")), "Bigisub doesn't know the meter → not paid there (ClubKonnect decides)", J([r, bgLog]));
reset({ bgMode: "processing" }); rid = ref();
r = await elec(rid);
ok(r?.status === "PENDING" && r?.reference === rid && r?.provider === "bigisub", "Bigisub still processing → PENDING under our reference (the app keeps asking)", J(r));
bgLookupStatus = "successful";
r = await call({ action: "electricity-query", orderId: rid });
ok(r?.status === "SUCCESS" && r?.token === "5555-4444-3333-2222-1111" && bgLog.some((x) => x.startsWith("status:ElecT")) && !bgLog.some((x) => x.startsWith("requery:ElecT")),
  "electricity-query reads Bigisub's STATUS → token when it's ready (no requery of a finished order: it says 'processing', no token)", J([r, bgLog]));
r = await call({ action: "verify", requestId: rid, service: "electricity" });
ok(r?.status === "SUCCESS" && r?.token === "5555-4444-3333-2222-1111", "verify of a finished Bigisub electricity order returns its token (22 Oct: the token never reached the customer)", J(r));
reset({ bgMode: "processing" }); rid = ref();
r = await elec(rid); bgLookupStatus = "failed";
r = await call({ action: "electricity-query", orderId: rid });
ok(r?.status === "CANCELLED" && !ckLog.some((x) => x.startsWith("APIQuery")), "Bigisub failed it → CANCELLED (refunded), ClubKonnect never asked", J([r, ckLog]));
reset({ bgMode: "processing" }); rid = ref();
r = await elec(rid);
const meterChecks = () => bgLog.filter((x) => x.startsWith("meter:")).length, elecPays = () => bgLog.filter((x) => x.startsWith("elec:")).length;
const [m1, p1] = [meterChecks(), elecPays()];
r = await elec(rid);   // the app's retry after its request timed out
ok(r?.status === "PENDING" && r?.reference === rid && meterChecks() === m1 && elecPays() === p1, "a retry of an electricity order already at Bigisub: no new meter check, not paid again", J([r, bgLog]));
bgLookupStatus = "successful";
r = await elec(rid);
ok(r?.status === "SUCCESS" && r?.token === "5555-4444-3333-2222-1111" && elecPays() === p1, "…once Bigisub has the token, the retry returns it (still paid once)", J([r, bgLog]));
reset();
r = await call({ action: "bill-preflight", cat: "electricity", amount: 1000 });
ok(r?.ok === true && r?.provider === "bigisub", "preflight: electricity checks Bigisub's wallet", J(r));
config = { ...BASE_CFG, bill_provider_bigisub: "true" }; await fresh();

console.log(fails ? `\n${fails} of ${checks} checks FAILED` : `\nall ${checks} checks passed`);
if (fails) console.log("--- function log tail ---\n" + fnLog.slice(-4000));
cleanup();
process.exit(fails ? 1 : 0);
