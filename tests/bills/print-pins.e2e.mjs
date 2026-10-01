// Bill-payment regression suite (moved from local testing on 2026-10-01). Run: node tests/bills/print-pins.e2e.mjs  — see tests/bills/README.md
// End-to-end: the REAL clubkonnect function's Print Airtime / Print Data against a fake ClubKonnect that answers print
// orders in every way seen or possible — PINs at once, PINs only via the order lookup, never, refused, error page.
import { FN, killTree } from "./_harness.mjs";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
const CK = 8793, SB = 8794, FNPORT = 8000, SERVICE_KEY = "svc-test-key";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0, checks = 0;
const ok = (c, m, x = "") => { checks++; if (!c) { fails++; console.log(`  FAIL ${m}\n       ${x}`); } else console.log(`  ok   ${m}`); };
// the app: an error matching this is "maybe placed — hold and confirm"; anything else is a refusal (refund)
const CK_NET_ERR = /network|timeout|timed ?out|failed to fetch|failed to send a request|load failed|connection|aborted|ECONNRESET|socket|gateway|502|503|504|non-2xx|FunctionsFetchError|FunctionsRelayError|edge function/i;
const held = (r) => r?.status !== "SUCCESS" && CK_NET_ERR.test(String(r?.error ?? ""));
const refunded = (r) => r?.status !== "SUCCESS" && !!r?.error && !CK_NET_ERR.test(String(r.error));

const PAGE503 = "<html><body><h1>Service Unavailable</h1>The service is unavailable.</body></html>";
const pins = (n, k = "pin") => Array.from({ length: n }, (_, i) => ({ [k]: `PIN${i}`, sno: `S${i}` }));
let buyAnswer = null, queryAnswers = [], calls = [];
const ckSrv = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"); const path = u.pathname.slice(1); const p = Object.fromEntries(u.searchParams);
  const send = (code, body) => { res.writeHead(code, { "Content-Type": typeof body === "string" ? "text/html" : "application/json" }); res.end(typeof body === "string" ? body : JSON.stringify(body)); };
  if (p.UserID === "CK000000") return send(200, { status: "INVALID_CREDENTIALS" });
  calls.push(`${path}#${p.RequestID ?? ""}`);
  if (path === "APIQueryV1.asp") { const a = queryAnswers.length > 1 ? queryAnswers.shift() : queryAnswers[0]; return a === "503" ? send(503, PAGE503) : send(200, a ?? { status: "INVALID_REQUESTID" }); }
  if (path === "APIEPINV1.asp" || path === "APIDatabundleEPINV1.asp") return buyAnswer === "503" ? send(503, PAGE503) : send(200, buyAnswer);
  if (path === "APIWalletBalanceV1.asp") return send(200, { WalletBalance: "500000" });
  return send(200, {});
});
const sbSrv = http.createServer((req, res) => {
  let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    const u = new URL(req.url, "http://x"); const t = /^\/rest\/v1\/(\w+)/.exec(u.pathname)?.[1];
    const send = (c, o) => { res.writeHead(c, { "Content-Type": "application/json" }); res.end(o === null ? "" : JSON.stringify(o)); };
    if (t === "platform_config" && req.method === "GET") return send(200, [{ key: "ck_v3_fallback_enabled", value: "false" }]);
    if (req.method === "GET") return send(200, []);
    send(201, null);
  });
});
await Promise.all([new Promise((r) => ckSrv.listen(CK, "127.0.0.1", r)), new Promise((r) => sbSrv.listen(SB, "127.0.0.1", r))]);
let fnProc = null;
const cleanup = () => { if (fnProc) try { killTree(fnProc); } catch {} for (const s of [ckSrv, sbSrv]) try { s.close(); } catch {} };
process.on("exit", cleanup);
{
  const env = { ...process.env, CK_BASE: `http://127.0.0.1:${CK}/`, SUPABASE_URL: `http://127.0.0.1:${SB}`, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, SUPABASE_ANON_KEY: "anon",
    CK_USER_ID: "ckuser", CK_AIRTIME_KEY: "k-air", CK_PRINT_AIRTIME_KEY: "k-pa", CK_PRINT_DATA_KEY: "k-pd" };
  fnProc = spawn("deno", ["run", "--allow-all", "--no-lock", "--node-modules-dir=none", FN], { env, shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; fnProc.stdout.on("data", (d) => (log += d)); fnProc.stderr.on("data", (d) => (log += d));
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { const r = await fetch(`http://127.0.0.1:${FNPORT}/`, { method: "OPTIONS" }); up = r.status < 500; } catch {} if (!up) await sleep(1000); }
  if (!up) { console.log("function never started\n" + log.slice(-2000)); cleanup(); process.exit(2); }
}
const call = async (body) => (await fetch(`http://127.0.0.1:${FNPORT}/`, { method: "POST", headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body) })).json().catch(() => null);
const printAirtime = (rid) => call({ action: "print-airtime", network: "MTN", value: "100", quantity: "2", requestId: rid });
const printData = (rid) => call({ action: "print-data", network: "MTN", planId: "500", quantity: "2", requestId: rid });
const reset = (buy, queries = []) => { buyAnswer = buy; queryAnswers = [...queries]; calls = []; };
const queries = () => calls.filter((c) => c.startsWith("APIQueryV1")).length;

try {
  reset({ ORDER_ID: "9001", TXN_EPIN: pins(2) });
  let r = await printAirtime("P1");
  ok(r?.status === "SUCCESS" && r.pins?.length === 2 && queries() === 0, "PINs in the first reply → delivered at once, no lookup", JSON.stringify([r, calls]));

  reset({ ORDER_ID: "9002" }, [{ ORDER_ID: "9002", TXN_EPIN: pins(20) }]);
  r = await printAirtime("P2");
  ok(r?.status === "SUCCESS" && r.pins?.length === 20, "THE 1 OCT CASE: reply has only ORDER_ID → PINs fetched by lookup → delivered (20)", JSON.stringify(r).slice(0, 200));
  ok(calls.filter((c) => c.startsWith("APIEPINV1")).length === 1 && calls.every((c) => c.endsWith("#P2")), "bought once, looked up with the same RequestID", JSON.stringify(calls));

  reset({}, [{ ORDER_ID: "9003" }, { ORDER_ID: "9003", TXN_EPIN: pins(1) }]);
  r = await printAirtime("P3");
  ok(r?.status === "SUCCESS" && r.pins?.length === 1 && queries() === 2, "empty reply, PINs ready on the 2nd lookup → delivered", JSON.stringify([r?.status, calls]));

  reset({ ORDER_ID: "9004" }, [{ ORDER_ID: "9004" }]);
  r = await printAirtime("P4");
  ok(held(r), "order exists but PINs never appear → HELD (app confirms later), not failed", JSON.stringify(r));
  ok(queries() === 4, "looked up 4 times before holding", String(queries()));

  reset({ ORDER_ID: "9005" }, ["503"]);
  r = await printAirtime("P5");
  ok(held(r), "lookups can't be read (error page) → HELD, not failed", JSON.stringify(r));

  reset("503", [{ status: "INVALID_REQUESTID" }]);
  r = await printAirtime("P6");
  ok(refunded(r) && /temporarily unavailable/i.test(r.error), "ClubKonnect's error page + every lookup says no such order → failed (refund)", JSON.stringify(r));

  reset("503", [{ ORDER_ID: "9007", TXN_EPIN: pins(2) }]);
  r = await printAirtime("P7");
  ok(r?.status === "SUCCESS" && r.pins?.length === 2, "error page on the order, but the lookup has the PINs → delivered", JSON.stringify(r).slice(0, 160));

  reset({ status: "INSUFFICIENT_BALANCE" });
  r = await printAirtime("P8");
  ok(refunded(r) && r.error === "INSUFFICIENT_BALANCE" && queries() === 0, "explicit refusal (insufficient balance) → failed at once, no lookup", JSON.stringify([r, calls]));

  reset({ ORDER_ID: "9009" }, [{ status: "ORDER_CANCELLED" }]);
  r = await printAirtime("P9");
  ok(refunded(r) && /CANCEL/.test(r.error), "lookup says the order was cancelled → failed", JSON.stringify(r));

  reset({ ORDER_ID: "9010" }, [{ ORDER_ID: "9010", TXN_EPIN_DATABUNDLE: pins(2, "pin") }]);
  r = await printData("D1");
  ok(r?.status === "SUCCESS" && r.pins?.length === 2, "Print Data: PINs only via lookup → delivered", JSON.stringify(r).slice(0, 160));

  reset({ ORDER_ID: "9011", TXN_EPIN_DATABUNDLE: pins(3) });
  r = await printData("D2");
  ok(r?.status === "SUCCESS" && r.pins?.length === 3 && queries() === 0, "Print Data: PINs at once → delivered, no lookup", JSON.stringify([r?.status, calls]));

  reset({ ORDER_ID: "9012" }, [{ ORDER_ID: "9012" }]);
  r = await printData("D3");
  ok(held(r), "Print Data: order but no PINs → HELD", JSON.stringify(r));

  // the app's confirm path then gets the PINs
  reset(null, [{ ORDER_ID: "9012", TXN_EPIN_DATABUNDLE: pins(2) }]);
  r = await call({ action: "verify", requestId: "D3", service: "print-data" });
  ok(r?.status === "SUCCESS" && r.pins?.length === 2, "…and the app's confirm step (verify) collects the PINs", JSON.stringify(r).slice(0, 160));
} finally { cleanup(); }
console.log(fails ? `\n${fails} of ${checks} checks FAILED` : `\nall ${checks} checks passed`);
process.exit(fails ? 1 : 0);
