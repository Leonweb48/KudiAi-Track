// Bill-payment regression suite (moved from local testing on 2026-10-01). Run: node tests/bills/unclear-replies.e2e.mjs  — see tests/bills/README.md
// End-to-end: the REAL clubkonnect function's safety net for unclear purchase replies (ckFailedOrHeld) and WAEC/JAMB card
// details that arrive after the reply (cardDetailsLater), against a fake ClubKonnect.
import { FN, killTree } from "./_harness.mjs";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
const CK = 8793, SB = 8794, FNPORT = 8000, SERVICE_KEY = "svc-test-key";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0, checks = 0;
const ok = (c, m, x = "") => { checks++; if (!c) { fails++; console.log(`  FAIL ${m}\n       ${x}`); } else console.log(`  ok   ${m}`); };
const CK_NET_ERR = /network|timeout|timed ?out|failed to fetch|failed to send a request|load failed|connection|aborted|ECONNRESET|socket|gateway|502|503|504|non-2xx|FunctionsFetchError|FunctionsRelayError|edge function/i;
const held = (r) => r?.status !== "SUCCESS" && CK_NET_ERR.test(String(r?.error ?? ""));
const refunded = (r) => r?.status !== "SUCCESS" && !!r?.error && !CK_NET_ERR.test(String(r.error));

let buy = null, queries = [], calls = [];
const ckSrv = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"); const path = u.pathname.slice(1); const p = Object.fromEntries(u.searchParams);
  const send = (code, body) => { res.writeHead(code, { "Content-Type": typeof body === "string" ? "text/html" : "application/json" }); res.end(typeof body === "string" ? body : JSON.stringify(body)); };
  if (p.UserID === "CK000000") return send(200, { status: "INVALID_CREDENTIALS" });
  calls.push(path);
  if (path === "APIQueryV1.asp") { const a = queries.length > 1 ? queries.shift() : queries[0]; return send(200, a ?? { status: "INVALID_REQUESTID" }); }
  if (path === "APIWalletBalanceV1.asp") return send(200, { WalletBalance: "500000" });
  if (/^API(Airtime|Databundle|CableTV|WAEC|JAMB|Smile|Spectranet|Betting)V1\.asp$/.test(path)) return buy === "503" ? send(503, "<h1>Service Unavailable</h1>") : send(200, buy);
  return send(200, {});
});
const sbSrv = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(req.method === "GET" ? "[]" : ""); }); });
await Promise.all([new Promise((r) => ckSrv.listen(CK, "127.0.0.1", r)), new Promise((r) => sbSrv.listen(SB, "127.0.0.1", r))]);
let fnProc = null;
const cleanup = () => { if (fnProc) try { killTree(fnProc); } catch {} for (const s of [ckSrv, sbSrv]) try { s.close(); } catch {} };
process.on("exit", cleanup);
{
  const env = { ...process.env, CK_BASE: `http://127.0.0.1:${CK}/`, SUPABASE_URL: `http://127.0.0.1:${SB}`, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, SUPABASE_ANON_KEY: "anon",
    CK_USER_ID: "ckuser", CK_AIRTIME_KEY: "k-a", CK_DATA_KEY: "k-d", CK_CABLETV_KEY: "k-c", CK_WAEC_KEY: "k-w", CK_JAMB_KEY: "k-j", CK_SMILE_KEY: "k-s" };
  fnProc = spawn("deno", ["run", "--allow-all", "--no-lock", "--node-modules-dir=none", FN], { env, shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; fnProc.stdout.on("data", (d) => (log += d)); fnProc.stderr.on("data", (d) => (log += d));
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { const r = await fetch(`http://127.0.0.1:${FNPORT}/`, { method: "OPTIONS" }); up = r.status < 500; } catch {} if (!up) await sleep(1000); }
  if (!up) { console.log("function never started\n" + log.slice(-2000)); cleanup(); process.exit(2); }
}
const call = async (body) => (await fetch(`http://127.0.0.1:${FNPORT}/`, { method: "POST", headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body) })).json().catch(() => null);
const reset = (b, q = []) => { buy = b; queries = [...q]; calls = []; };
const lookups = () => calls.filter((c) => c === "APIQueryV1.asp").length;
const airtime = (rid) => call({ action: "airtime", phone: "08031234567", network: "MTN", amount: "100", requestId: rid });
const cable = (rid) => call({ action: "cable", provider: "dstv", packageId: "dstv-padi", smartcard: "1234567890", phone: "08031234567", requestId: rid });
const waec = (rid) => call({ action: "waec", examType: "waecdirect", phone: "08031234567", requestId: rid });

try {
  reset({ statuscode: "100", status: "ORDER_RECEIVED", orderid: "1" });
  let r = await airtime("A1");
  ok(r?.status === "SUCCESS" && lookups() === 0, "a normal success is untouched (no lookup)", JSON.stringify([r, calls]));

  reset({ status: "INVALID_MOBILENUMBER" });
  r = await airtime("A2");
  ok(refunded(r) && r.error === "INVALID_MOBILENUMBER" && lookups() === 0, "a clear refusal fails at once, no lookup", JSON.stringify([r, calls]));

  reset({ status: "INSUFFICIENT_BALANCE" });
  r = await airtime("A3");
  ok(refunded(r) && lookups() === 0, "insufficient balance fails at once", JSON.stringify(r));

  reset({}, [{ status: "ORDER_COMPLETED", statuscode: "200", orderid: "9" }]);
  r = await airtime("A4");
  ok(held(r), "reply with NO status but ClubKonnect has the order → HELD (app confirms), not refunded", JSON.stringify([r, calls]));

  reset({}, [{ status: "INVALID_REQUESTID" }]);
  r = await airtime("A5");
  ok(refunded(r) && lookups() === 1, "reply with no status and ClubKonnect says no such order → failed, refund", JSON.stringify([r, calls]));

  reset({ status: "DUPLICATE_REQUESTID" }, [{ status: "ORDER_COMPLETED", statuscode: "200", orderid: "9" }]);
  r = await airtime("A6");
  ok(held(r), "a RETRY told 'duplicate' while the order exists → HELD, never a refund of a delivered order", JSON.stringify(r));

  reset({ status: "ORDER_ON_HOLD" }, [{ status: "ORDER_ON_HOLD" }]);
  r = await cable("C1");
  ok(held(r), "Cable: ORDER_ON_HOLD → HELD", JSON.stringify(r));

  reset({ status: "ORDER_REFUNDED", statuscode: "899" });
  r = await cable("C2");
  ok(refunded(r) && lookups() === 0, "Cable: refunded by the provider → failed at once", JSON.stringify([r, calls]));

  reset("503");
  r = await cable("C3");
  ok(refunded(r) && /temporarily unavailable/i.test(r.error), "error page (ClubKonnect's refusal of an invalid order) → failed as before", JSON.stringify(r));

  reset({ statuscode: "100", status: "ORDER_RECEIVED", orderid: "5" }, [{ status: "ORDER_COMPLETED", carddetails: "Serial No:ABC PIN:XYZ" }]);
  r = await waec("W1");
  ok(r?.status === "SUCCESS" && r.cardDetails === "Serial No:ABC PIN:XYZ", "WAEC accepted without card details → fetched by lookup → delivered", JSON.stringify(r));

  reset({ statuscode: "100", status: "ORDER_RECEIVED", orderid: "6" }, [{ status: "ORDER_RECEIVED" }]);
  r = await waec("W2");
  ok(held(r), "WAEC accepted, card details not out yet → HELD (no more 'contact support' refund)", JSON.stringify(r));

  reset({ statuscode: "100", status: "ORDER_RECEIVED", orderid: "7", carddetails: "Serial No:DEF PIN:UVW" });
  r = await waec("W3");
  ok(r?.status === "SUCCESS" && lookups() === 0, "WAEC with card details in the reply → delivered at once", JSON.stringify([r?.status, calls]));
} finally { cleanup(); }
console.log(fails ? `\n${fails} of ${checks} checks FAILED` : `\nall ${checks} checks passed`);
process.exit(fails ? 1 : 0);
