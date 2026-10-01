// Bill-payment regression suite (moved from local testing on 2026-10-01). Run: node tests/bills/route-fallback.e2e.mjs  — see tests/bills/README.md
// End-to-end: the REAL clubkonnect edge function (deno) against a fake ClubKonnect (V1/V3 purchase scripts, order
// lookup, made-up-account health probes) and a fake Supabase (platform_config, admin_notifications, admin_users).
// node e2e-ck-route.mjs
import { FN, killTree } from "./_harness.mjs";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
const CK = 8793, SB = 8794, FNPORT = 8000, SERVICE_KEY = "svc-test-key";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0, checks = 0;
const ok = (c, m, x = "") => { checks++; if (!c) { fails++; console.log(`  FAIL ${m} ${x}`); } };

const CRASH_HTML = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN"><html><head><title>500 - Internal server error.</title></head><body><h2>500 - Internal server error.</h2></body></html>`;

// ── fake ClubKonnect ──────────────────────────────────────────────────────────────────────────────────────────────
// real[path] = "crash" | "ok" | "reject" (calls with our UserID); canary[path] = "crash" | "json" (made-up account CK000000)
let real = {}, canary = {}, queries = [], ckLog = [], svcProbe = {};
const ckSrv = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"); const path = u.pathname.slice(1); const p = Object.fromEntries(u.searchParams);
  const send = (code, body) => { res.writeHead(code, { "Content-Type": typeof body === "string" ? "text/html" : "application/json" }); res.end(typeof body === "string" ? body : JSON.stringify(body)); };
  if (p.UserID === "CK000000") { ckLog.push(`probe:${path}`); return (canary[path] ?? "json") === "crash" ? send(500, CRASH_HTML) : send(200, { status: "INVALID_CREDENTIALS" }); }
  // the real-account purchase-service probe (orders that must be refused): svcProbe[path] = "503" | "json"
  if (String(p.RequestID || "").startsWith("KUDIAI-HEALTH-")) {
    ckLog.push(`svcprobe:${path}`);
    if (p.MobileNumber !== "0" || Number(p.Amount) >= 50) return send(400, { status: "TEST_FAIL_PROBE_WAS_FULFILLABLE" });
    return svcProbe[path] === "503" ? send(503, "<html><body><h1>Service Unavailable</h1>The service is unavailable.</body></html>") : send(200, { status: path.includes("Databundle") ? "INVALID_DATAPLAN" : "INVALID_MOBILENETWORK" });
  }
  ckLog.push(`${path}#${p.RequestID ?? ""}`);
  if (path === "APIQueryV1.asp") { const q = queries.shift() ?? { status: "INVALID_REQUESTID" }; return q === "crash" ? send(500, CRASH_HTML) : send(200, q); }
  if (path === "APIWalletBalanceV1.asp") return send(200, { WalletBalance: "500000" });
  const mode = real[path];
  if (mode === "crash") return send(500, CRASH_HTML);
  if (mode === "reject") return send(200, { status: "INVALID_DATAPLAN" });
  if (mode === "ok") return send(200, { statuscode: "100", status: "ORDER_RECEIVED", orderid: `CK-${path}`, requestid: p.RequestID });
  return send(200, {});   // catalogues / discount lists etc.
});

// ── fake Supabase (PostgREST) ─────────────────────────────────────────────────────────────────────────────────────
let config = {}, alerts = [];
const sbSrv = http.createServer((req, res) => {
  let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    const u = new URL(req.url, "http://x");
    const send = (c, o) => { res.writeHead(c, { "Content-Type": "application/json" }); res.end(o === null ? "" : JSON.stringify(o)); };
    const t = /^\/rest\/v1\/(\w+)/.exec(u.pathname)?.[1];
    if (t === "platform_config" && req.method === "GET") return send(200, Object.entries(config).map(([key, value]) => ({ key, value })));
    if (t === "platform_config") return send(201, null);   // price refresh writes — accepted, ignored
    if (t === "admin_notifications" && req.method === "GET") {
      const title = (u.searchParams.get("title") || "").replace(/^eq\./, "");
      return send(200, alerts.filter((a) => a.title === title).map(() => ({ id: 1 })));
    }
    if (t === "admin_notifications" && req.method === "POST") { alerts.push(JSON.parse(b)); return send(201, null); }
    if (t === "admin_users") return send(200, []);   // no admin emails in the test
    send(200, []);
  });
});
await Promise.all([new Promise((r) => ckSrv.listen(CK, "127.0.0.1", r)), new Promise((r) => sbSrv.listen(SB, "127.0.0.1", r))]);

let fnProc = null;
const stopFn = () => { if (fnProc) { try { killTree(fnProc); } catch {} fnProc = null; } };
const cleanup = () => { stopFn(); try { ckSrv.close(); sbSrv.close(); } catch {} };
process.on("exit", cleanup);
async function startFn() {
  try { await fetch(`http://127.0.0.1:${FNPORT}/`, { method: "OPTIONS", signal: AbortSignal.timeout(1500) }); console.log(`port ${FNPORT} busy — stop the stale process first`); process.exit(3); } catch {}
  const env = { ...process.env, CK_BASE: `http://127.0.0.1:${CK}/`, SUPABASE_URL: `http://127.0.0.1:${SB}`, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, SUPABASE_ANON_KEY: "anon",
    CK_USER_ID: "ckuser", CK_AIRTIME_KEY: "k-air", CK_DATA_KEY: "k-data", CK_CABLETV_KEY: "k-cable" };
  fnProc = spawn("deno", ["run", "--allow-all", "--no-lock", "--node-modules-dir=none", FN], { env, shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; fnProc.stdout.on("data", (d) => (log += d)); fnProc.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${FNPORT}/`, { method: "OPTIONS" }); if (r.status < 500) return; } catch {} await sleep(1000); }
  console.log("function never started\n" + log.slice(-2000)); cleanup(); process.exit(2);
}
const call = async (body) => {
  const r = await fetch(`http://127.0.0.1:${FNPORT}/`, { method: "POST", headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json().catch(() => null);
};
const reset = (r = {}, c = {}, q = [], s = {}) => { real = r; canary = c; queries = [...q]; svcProbe = s; ckLog = []; alerts.length = 0; };
const resetHealthCache = () => call({ action: "route-check" });   // route-check clears the health cache
const airtime = (rid) => call({ action: "airtime", phone: "08011111111", network: "MTN", amount: "100", requestId: rid });
const CLEAN = "The bill payment service is temporarily unavailable. Please try again shortly.";

// ═══ Run 1: fallback ON for airtime + cable, health check ON ═══════════════════════════════════════════════════════
config = { ck_v3_fallback_enabled: "true", ck_v3_fallback_services: "airtime,cable", ck_v3_force_services: "", ck_route_healthcheck_enabled: "true" };
await startFn();
console.log("run 1 (fallback on)…");

reset({ "APIAirtimeV1.asp": "ok" });
let r = await airtime("R1");
ok(r?.status === "SUCCESS" && ckLog.join() === "APIAirtimeV1.asp#R1", "healthy main route: V1 only, untouched", JSON.stringify([r, ckLog]));

reset({ "APIAirtimeV1.asp": "crash", "APIAirtimeV3.asp": "ok" }, {}, [{ status: "INVALID_REQUESTID" }]);
r = await airtime("R2"); await sleep(600);
ok(r?.status === "SUCCESS", "V1 crash + no order → V3 delivers → SUCCESS", JSON.stringify(r));
ok(ckLog.filter((c) => c.startsWith("APIAirtimeV1")).length === 3 && ckLog.at(-2) === "APIQueryV1.asp#R2" && ckLog.at(-1) === "APIAirtimeV3.asp#R2",
  "V1 retried, then lookup, then V3 — all with the SAME RequestID", JSON.stringify(ckLog));
ok(alerts.length === 1 && /backup route in use/.test(alerts[0].title) && alerts[0].metadata?.svc === "airtime", "admins alerted once", JSON.stringify(alerts));

reset({ "APIAirtimeV1.asp": "crash", "APIAirtimeV3.asp": "ok" }, {}, [{ statuscode: "200", status: "ORDER_COMPLETED", orderid: "CK-EXISTING" }]);
r = await airtime("R3");
ok(r?.status === "SUCCESS" && !ckLog.some((c) => c.startsWith("APIAirtimeV3")), "V1 crashed but the order exists → success, V3 NEVER called (no double purchase)", JSON.stringify([r, ckLog]));

reset({ "APIAirtimeV1.asp": "crash", "APIAirtimeV3.asp": "reject" }, {}, [{ status: "INVALID_REQUESTID" }, { status: "INVALID_REQUESTID" }]);
r = await airtime("R4"); await sleep(600);
ok(r?.error === CLEAN, "V3 refuses + lookup confirms nothing placed → the clean message (refund), not V3's code", JSON.stringify(r));
ok(alerts.some((a) => /refusing orders/.test(a.title)), "admins told the backup is refusing", JSON.stringify(alerts));

reset({ "APIAirtimeV1.asp": "crash", "APIAirtimeV3.asp": "crash" }, {}, [{ status: "INVALID_REQUESTID" }, "crash", "crash"]);   // the lookup retries a crash page once
r = await airtime("R5");
ok(/gateway|timeout/i.test(r?.error || ""), "both crash + lookup can't tell → held (app confirms, doesn't refund)", JSON.stringify(r));

reset({ "APIDatabundleV1.asp": "crash", "APIDatabundleV3.asp": "ok" });
r = await call({ action: "data", phone: "08011111111", network: "MTN", planId: "500", requestId: "R6" });
ok(r?.error && !r.error.includes("<!DOCTYPE") && !ckLog.some((c) => c.startsWith("APIQuery") || c.includes("V3")), "service not listed (data) → no lookup, no V3, clean error", JSON.stringify([r, ckLog]));

// pre-charge check
reset({}, { "APIAirtimeV1.asp": "crash", "APIAirtimeV3.asp": "json" }); await resetHealthCache(); ckLog = []; alerts.length = 0;
r = await call({ action: "bill-preflight", cat: "airtime", network: "MTN", amount: 100 });
ok(r?.ok === true, "preflight: main down but backup up + listed → allowed (the fallback will carry it)", JSON.stringify(r));

reset({}, { "APIAirtimeV1.asp": "crash", "APIAirtimeV3.asp": "crash" }); await resetHealthCache(); alerts.length = 0;
r = await call({ action: "bill-preflight", cat: "airtime", network: "MTN", amount: 100 }); await sleep(600);
ok(r?.ok === false && r?.reason === "provider_down" && /not been charged/.test(r?.message), "preflight: main AND backup down → blocked BEFORE charging", JSON.stringify(r));
ok(alerts.some((a) => /bill sales paused/.test(a.title)), "admins told sales are paused", JSON.stringify(alerts));

reset({}, { "APIDatabundleV1.asp": "crash", "APIDatabundleV3.asp": "json" }); await resetHealthCache();
r = await call({ action: "bill-preflight", cat: "data", network: "MTN", amount: 100 });
ok(r?.ok === false && r?.reason === "provider_down", "preflight: main down, backup not enabled for data → blocked (never debit into a likely refusal)", JSON.stringify(r));

reset({}, {}); await resetHealthCache();
r = await call({ action: "bill-preflight", cat: "airtime", network: "MTN", amount: 100 });
ok(r?.ok === true, "preflight: everything healthy → allowed as before", JSON.stringify(r));

// the purchase service behind the login check (2026-09-28 evening: login fine, every real order → IIS 503)
reset({}, {}, [], { "APIDatabundleV1.asp": "503", "APIAirtimeV1.asp": "503" }); await resetHealthCache(); ckLog = []; alerts.length = 0;
r = await call({ action: "bill-preflight", cat: "cable", amount: 4400 }); await sleep(600);
ok(r?.ok === true, "preflight: must-refuse test orders 503 but the scripts are up → NOT paused (ClubKonnect 503s invalid orders while taking real ones, 2026-09-30)", JSON.stringify(r));
ok(!alerts.some((a) => /bill sales paused/.test(a.title)), "…and no 'sales paused' alert", JSON.stringify(alerts));
ok(!ckLog.some((c) => c.startsWith("svcprobe:")), "the pre-charge check no longer sends those test orders at all", JSON.stringify(ckLog));

reset({}, {}, [], { "APIDatabundleV1.asp": "503" }); await resetHealthCache();
r = await call({ action: "bill-preflight", cat: "airtime", network: "MTN", amount: 100 });
ok(r?.ok === true, "preflight: only ONE probe script down → not blocked (a single script's quirk never pauses every sale)", JSON.stringify(r));

reset({}, {}, [], { "APIDatabundleV1.asp": "503", "APIAirtimeV1.asp": "503" }); await resetHealthCache();
r = await call({ action: "route-check" });
ok(r?.purchaseService === "down", "route-check reports the purchase service", JSON.stringify(r?.purchaseService));

reset({ "APIAirtimeV1.asp": "reject", "APIAirtimeV3.asp": "reject" }, { "APIAirtimeV1.asp": "crash" }, [{ status: "INVALID_REQUESTID" }]);
r = await call({ action: "route-check" });
ok(r?.canary?.["APIAirtimeV1.asp"] === "down" && r?.canary?.["APIAirtimeV3.asp"] === "up", "route-check: per-script health", JSON.stringify(r?.canary));
ok(r?.lookup?.kind === "not-found" && r?.lookup?.status === "INVALID_REQUESTID", "route-check: the real 'no such order' reply", JSON.stringify(r?.lookup));
ok(r?.dryRun?.airtimeV1 === "INVALID_DATAPLAN" && r?.dryRun?.airtimeV3 === "INVALID_DATAPLAN", "route-check: dry run on both routes", JSON.stringify(r?.dryRun));
ok(r?.config?.fallbackOn === true && r?.config?.fallbackServices?.join() === "airtime,cable", "route-check: live switches", JSON.stringify(r?.config));
const noAuth = await fetch(`http://127.0.0.1:${FNPORT}/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "route-check" }) });
ok(noAuth.status === 401, "route-check is service-only", String(noAuth.status));
stopFn(); await sleep(1500);

// ═══ Run 2: master switch OFF ══════════════════════════════════════════════════════════════════════════════════════
config = { ck_v3_fallback_enabled: "false", ck_v3_fallback_services: "airtime,cable", ck_v3_force_services: "", ck_route_healthcheck_enabled: "true" };
await startFn();
console.log("run 2 (fallback off)…");
reset({ "APIAirtimeV1.asp": "crash", "APIAirtimeV3.asp": "ok" });
r = await airtime("R7");
ok(r?.error === CLEAN && !ckLog.some((c) => c.startsWith("APIQuery") || c.includes("V3")), "master off → exactly the old behaviour: clean error, no lookup, no V3", JSON.stringify([r, ckLog]));
reset({}, { "APIAirtimeV1.asp": "crash", "APIAirtimeV3.asp": "json" }); await resetHealthCache();
r = await call({ action: "bill-preflight", cat: "airtime", network: "MTN", amount: 100 });
ok(r?.ok === false && r?.reason === "provider_down", "master off → a down main route blocks before charging even if V3 is up", JSON.stringify(r));
stopFn(); await sleep(1500);

// ═══ Run 3: test mode (force V3 for airtime) + health check OFF ════════════════════════════════════════════════════
config = { ck_v3_fallback_enabled: "true", ck_v3_fallback_services: "airtime", ck_v3_force_services: "airtime", ck_route_healthcheck_enabled: "false" };
await startFn();
console.log("run 3 (force V3, health check off)…");
reset({ "APIAirtimeV1.asp": "ok", "APIAirtimeV3.asp": "ok" });
r = await airtime("R8");
ok(r?.status === "SUCCESS" && ckLog.join() === "APIAirtimeV3.asp#R8", "force V3 → straight to V3, V1 never called", JSON.stringify([r, ckLog]));
reset({}, { "APIAirtimeV1.asp": "crash", "APIAirtimeV3.asp": "crash" }, [], { "APIDatabundleV1.asp": "503", "APIAirtimeV1.asp": "503" }); await resetHealthCache(); ckLog = [];
r = await call({ action: "bill-preflight", cat: "airtime", network: "MTN", amount: 100 });
ok(r?.ok === true && !ckLog.some((c) => c.startsWith("probe:") || c.startsWith("svcprobe:")), "health check off → never probes, never blocks", JSON.stringify([r, ckLog]));

console.log(fails ? `\n${fails} of ${checks} checks FAILED` : `\nall ${checks} checks passed`);
cleanup();
process.exit(fails ? 1 : 0);
