// Bill-payment regression suite (moved from local testing on 2026-10-01). Run: node tests/bills/fixed-ip-relay.e2e.mjs  — see tests/bills/README.md
// End-to-end: the REAL clubkonnect edge function + the REAL flw-relay, against two fake ClubKonnects — one the function
// reaches directly (CK_BASE), one only the relay reaches (CK_BASE_URL) — so each test sees which path an order took.
// Fake Supabase serves platform_config (with key filters, so maybeSingle behaves like PostgREST).
import { FN, RELAY_JS, killTree } from "./_harness.mjs";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
const CK_DIRECT = 8793, CK_RELAYED = 8795, SB = 8794, RELAY = 18800, FNPORT = 8000, SERVICE_KEY = "svc-test-key", RKEY = "relay-test-key";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0, checks = 0;
const ok = (c, m, x = "") => { checks++; if (!c) { fails++; console.log(`  FAIL ${m}\n       ${x}`); } else console.log(`  ok   ${m}`); };

// ── two fake ClubKonnects ────────────────────────────────────────────────────────────────────────────────────────
const hits = { direct: [], relayed: [] };
let mode = {};   // mode[path] = "ok" | "crash"
function fakeCk(label) {
  return http.createServer((req, res) => {
    const u = new URL(req.url, "http://x"); const path = u.pathname.slice(1); const p = Object.fromEntries(u.searchParams);
    const send = (code, body) => { res.writeHead(code, { "Content-Type": typeof body === "string" ? "text/html" : "application/json" }); res.end(typeof body === "string" ? body : JSON.stringify(body)); };
    if (p.UserID === "CK000000") return send(200, { status: "INVALID_CREDENTIALS" });   // made-up-account health probe
    hits[label].push({ path, rid: p.RequestID ?? "", user: p.UserID, key: p.APIKey });
    if (path === "APIQueryV1.asp") return send(200, { status: "INVALID_REQUESTID" });
    if (path === "APIWalletBalanceV1.asp") return send(200, { WalletBalance: "500000" });
    if (mode[path] === "crash") return send(503, "<html><body><h1>Service Unavailable</h1></body></html>");
    if (mode[path] === "ok") return send(200, { statuscode: "100", status: "ORDER_RECEIVED", orderid: `CK-${label}`, requestid: p.RequestID });
    return send(200, {});
  });
}
let ckDirect = fakeCk("direct"), ckRelayed = fakeCk("relayed");

// ── fake Supabase ────────────────────────────────────────────────────────────────────────────────────────────────
let config = {};
const sbSrv = http.createServer((req, res) => {
  let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    const u = new URL(req.url, "http://x");
    const send = (c, o) => { res.writeHead(c, { "Content-Type": "application/json" }); res.end(o === null ? "" : JSON.stringify(o)); };
    const t = /^\/rest\/v1\/(\w+)/.exec(u.pathname)?.[1];
    if (t === "platform_config" && req.method === "GET") {
      const k = u.searchParams.get("key") || "";
      let rows = Object.entries(config).map(([key, value]) => ({ key, value }));
      if (k.startsWith("eq.")) rows = rows.filter((r) => r.key === k.slice(3));
      if (k.startsWith("in.(")) { const set = k.slice(4, -1).split(",").map((s) => s.replace(/"/g, "")); rows = rows.filter((r) => set.includes(r.key)); }
      return send(200, rows);
    }
    if (t === "platform_config") return send(201, null);
    if (t === "admin_notifications" && req.method === "GET") return send(200, []);
    if (t === "admin_notifications") return send(201, null);
    send(200, []);
  });
});

await Promise.all([[ckDirect, CK_DIRECT], [ckRelayed, CK_RELAYED], [sbSrv, SB]].map(([s, p]) => new Promise((r) => s.listen(p, "127.0.0.1", r))));

// ── the real relay ───────────────────────────────────────────────────────────────────────────────────────────────
let relayProc = null, relayLog = "";
async function startRelay(key = RKEY) {
  relayProc = spawn(process.execPath, [RELAY_JS], { env: { ...process.env, RELAY_KEY: key, PORT: String(RELAY), CK_BASE_URL: `http://127.0.0.1:${CK_RELAYED}` } });
  relayProc.stdout.on("data", (d) => (relayLog += d)); relayProc.stderr.on("data", (d) => (relayLog += d));
  for (let i = 0; i < 30; i++) { try { if ((await fetch(`http://127.0.0.1:${RELAY}/health`)).ok) return; } catch {} await sleep(200); }
  throw new Error("relay never started");
}
const stopRelay = async () => { if (relayProc) { relayProc.kill(); relayProc = null; await sleep(300); } };

// ── the real function ────────────────────────────────────────────────────────────────────────────────────────────
let fnProc = null;
const stopFn = async () => { if (fnProc) { try { killTree(fnProc); } catch {} fnProc = null; await sleep(500); } };
const cleanup = () => { if (fnProc) try { killTree(fnProc); } catch {} if (relayProc) relayProc.kill(); for (const s of [ckDirect, ckRelayed, sbSrv]) try { s.close(); } catch {} };
process.on("exit", cleanup);
async function startFn() {
  try { await fetch(`http://127.0.0.1:${FNPORT}/`, { method: "OPTIONS", signal: AbortSignal.timeout(1500) }); console.log(`port ${FNPORT} busy`); process.exit(3); } catch {}
  const env = { ...process.env, CK_BASE: `http://127.0.0.1:${CK_DIRECT}/`, SUPABASE_URL: `http://127.0.0.1:${SB}`, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, SUPABASE_ANON_KEY: "anon",
    CK_USER_ID: "ckuser", CK_AIRTIME_KEY: "k-air", CK_DATA_KEY: "k-data", FLW_RELAY_URL: `http://127.0.0.1:${RELAY}/`, FLW_RELAY_KEY: RKEY };
  fnProc = spawn("deno", ["run", "--allow-all", "--no-lock", "--node-modules-dir=none", FN], { env, shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; fnProc.stdout.on("data", (d) => (log += d)); fnProc.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${FNPORT}/`, { method: "OPTIONS" }); if (r.status < 500) return; } catch {} await sleep(1000); }
  console.log("function never started\n" + log.slice(-2000)); cleanup(); process.exit(2);
}
const call = async (body) => {
  const r = await fetch(`http://127.0.0.1:${FNPORT}/`, { method: "POST", headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json().catch(() => null);
};
const airtime = (rid) => call({ action: "airtime", phone: "08011111111", network: "MTN", amount: "100", requestId: rid });
const reset = (m = {}) => { mode = m; hits.direct = []; hits.relayed = []; };
const buys = (label) => hits[label].filter((h) => h.path === "APIAirtimeV1.asp");
// the app treats an error matching this as "maybe placed — confirm" (BillPayments.jsx CK_NET_ERR), anything else as a refusal
const CK_NET_ERR = /network|timeout|timed ?out|failed to fetch|failed to send a request|load failed|connection|aborted|ECONNRESET|socket|gateway|502|503|504|non-2xx|FunctionsFetchError|FunctionsRelayError|edge function/i;
const held = (r) => r?.status !== "SUCCESS" && CK_NET_ERR.test(String(r?.error ?? ""));
const BASE_CFG = { ck_v3_fallback_enabled: "false", ck_route_healthcheck_enabled: "false" };

try {
  await startRelay();

  // ═══ switch OFF: everything direct, as before ════════════════════════════════════════════════════════════════
  config = { ...BASE_CFG };
  await startFn();
  reset({ "APIAirtimeV1.asp": "ok" });
  let r = await airtime("OFF1");
  ok(r?.status === "SUCCESS" && buys("direct").length === 1 && hits.relayed.length === 0, "switch off → order goes DIRECT, relay untouched", JSON.stringify([r, hits]));
  r = await call({ action: "route-check" });
  ok(r?.relay?.configured === true && r?.relay?.switchOn === false && r?.account?.callsGoVia === "direct", "route check: relay configured, switch off, calls go direct", JSON.stringify(r?.relay));
  ok(r?.relay?.airtimeKey === "valid", "route check tests the relay path even while the switch is off", JSON.stringify(r?.relay));
  ok(!JSON.stringify(r).includes("500000"), "route check never reports the balance");
  await stopFn();

  // ═══ switch ON ════════════════════════════════════════════════════════════════════════════════════════════════
  config = { ...BASE_CFG, ck_via_relay: "true" };
  await startFn();
  reset({ "APIAirtimeV1.asp": "ok" });
  r = await airtime("ON1");
  const b = buys("relayed");
  ok(r?.status === "SUCCESS" && b.length === 1 && hits.direct.filter((h) => h.user === "ckuser").length === 0, "switch on → order goes through the RELAY, nothing direct", JSON.stringify([r, hits]));
  ok(b[0]?.user === "ckuser" && b[0]?.key === "k-air" && b[0]?.rid === "ON1", "ClubKonnect gets our UserID, the airtime key and the same RequestID", JSON.stringify(b[0]));
  r = await call({ action: "route-check" });
  ok(r?.relay?.switchOn === true && r?.account?.callsGoVia === "relay", "route check: switch on, calls go via relay", JSON.stringify(r?.account));
  ok(r?.keys?.airtime === "valid" && hits.direct.filter((h) => h.user === "ckuser").length === 0, "the key check itself goes through the relay too", JSON.stringify(r?.keys));

  // ClubKonnect's own error page through the relay: retried with the SAME RequestID, like before
  reset({ "APIAirtimeV1.asp": "crash" });
  r = await airtime("ON2");
  ok(buys("relayed").length === 3 && buys("relayed").every((h) => h.rid === "ON2"), "ClubKonnect 503 via relay → retried 3× with the same RequestID", JSON.stringify(buys("relayed")));

  // ClubKonnect unreachable FROM THE RELAY (relay answers 502 + X-Relay-Error): must be "held", never a refusal
  reset({ "APIAirtimeV1.asp": "ok" });
  await new Promise((res) => ckRelayed.close(res));
  r = await airtime("ON3");
  ok(held(r), "relay can't reach ClubKonnect → order HELD (unconfirmed), not refused", JSON.stringify(r));
  ok(!/INVALID|refus|not been charged/i.test(JSON.stringify(r)), "…and never reported as a ClubKonnect refusal", JSON.stringify(r));
  ok(hits.direct.filter((h) => h.user === "ckuser").length === 0, "…and never silently sent direct instead", JSON.stringify(hits.direct));
  ckRelayed = fakeCk("relayed"); await new Promise((res) => ckRelayed.listen(CK_RELAYED, "127.0.0.1", res));

  // relay itself down (connection refused): same — held
  await stopRelay();
  reset({ "APIAirtimeV1.asp": "ok" });
  r = await airtime("ON4");
  ok(held(r), "relay down → order HELD, not refused", JSON.stringify(r));

  // relay refuses our key (misconfigured): held, not refused
  await startRelay("a-different-key");
  reset({ "APIAirtimeV1.asp": "ok" });
  r = await airtime("ON5");
  ok(held(r) && buys("relayed").length === 0, "relay rejects our relay key → held, ClubKonnect never called", JSON.stringify([r, hits]));
  await stopRelay(); await startRelay();

  // back to healthy
  reset({ "APIAirtimeV1.asp": "ok" });
  r = await airtime("ON6");
  ok(r?.status === "SUCCESS" && buys("relayed").length === 1, "relay back → orders go through again", JSON.stringify(r));
  ok(!/k-air|ckuser/.test(relayLog), "relay log never contains our key or UserID", relayLog.slice(0, 300));
} finally {
  await stopFn(); cleanup();
}
console.log(fails ? `\n${fails} of ${checks} checks FAILED` : `\nall ${checks} checks passed`);
process.exit(fails ? 1 : 0);
