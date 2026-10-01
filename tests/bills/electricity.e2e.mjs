// Bill-payment regression suite (moved from local testing on 2026-10-01). Run: node tests/bills/electricity.e2e.mjs  — see tests/bills/README.md
// End-to-end: the REAL clubkonnect function's electricity purchase, electricity-query and electricity-sweep, against a fake
// ClubKonnect (order states per RequestID / OrderID) and a fake Supabase (transactions, wallet ledger, RPCs, notify-send).
import { FN, killTree } from "./_harness.mjs";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
const CK = 8793, SB = 8794, FNPORT = 8000, SERVICE_KEY = "svc-test-key";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0, checks = 0;
const ok = (c, m, x = "") => { checks++; if (!c) { fails++; console.log(`  FAIL ${m}\n       ${x}`); } else console.log(`  ok   ${m}`); };
const CK_NET_ERR = /network|timeout|timed ?out|failed to fetch|failed to send a request|load failed|connection|aborted|ECONNRESET|socket|gateway|502|503|504|non-2xx|FunctionsFetchError|FunctionsRelayError|edge function/i;
const TOKEN = "1234-5678-9012-3456-7890";

// ── fake ClubKonnect: per order (keyed by OrderID or RequestID) a list of answers, consumed one per query ──
let buy = {}, states = {}, ckCalls = [];
const answerFor = (id) => { const a = states[id]; if (!a) return { status: "INVALID_ORDERID" }; return a.length > 1 ? a.shift() : a[0]; };
const ckSrv = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"); const path = u.pathname.slice(1); const p = Object.fromEntries(u.searchParams);
  const send = (o) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
  if (p.UserID === "CK000000") return send({ status: "INVALID_CREDENTIALS" });
  ckCalls.push({ path, by: p.OrderID ? `O:${p.OrderID}` : p.RequestID ? `R:${p.RequestID}` : "" });
  if (path === "APIElectricityV1.asp") return send(buy[p.RequestID] ?? { status: "ORDER_RECEIVED", statuscode: "100", orderid: `ORD-${p.RequestID}` });
  if (path === "APIQueryV1.asp") return send(answerFor(p.OrderID || p.RequestID));
  send({});
});
// ── fake Supabase ──
let txRows = [], ledger = {}, patches = [], rpcs = [], notifies = [], adminNotes = [];
const sbSrv = http.createServer((req, res) => {
  let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    const u = new URL(req.url, "http://x");
    const send = (c, o, h = {}) => { res.writeHead(c, { "Content-Type": "application/json", ...h }); res.end(o === null ? "" : JSON.stringify(o)); };
    if (u.pathname === "/functions/v1/notify-send") { notifies.push(JSON.parse(b || "{}")); return send(200, { ok: true }); }
    const rpc = /^\/rest\/v1\/rpc\/(\w+)/.exec(u.pathname)?.[1];
    if (rpc) {
      const args = JSON.parse(b || "{}"); rpcs.push({ rpc, args });
      if (rpc === "verify_cron_secret") return send(200, args.p_secret === "good-secret");
      return send(200, null);
    }
    const t = /^\/rest\/v1\/(\w+)/.exec(u.pathname)?.[1];
    if (t === "transactions" && req.method === "GET") return send(200, txRows);
    if (t === "transactions" && req.method === "PATCH") { patches.push({ q: Object.fromEntries(u.searchParams), body: JSON.parse(b || "{}") }); return send(204, null, { "content-range": "*/1" }); }
    if (t === "wallet_ledger" && req.method === "GET") { const id = (u.searchParams.get("related_txn_id") || "").replace(/^eq\./, ""); return send(200, ledger[id] ? [ledger[id]] : []); }
    if (t === "admin_notifications" && req.method === "POST") { adminNotes.push(JSON.parse(b || "{}")); return send(201, null); }
    if (t === "platform_config") return send(200, []);
    send(200, []);
  });
});
await Promise.all([new Promise((r) => ckSrv.listen(CK, "127.0.0.1", r)), new Promise((r) => sbSrv.listen(SB, "127.0.0.1", r))]);
let fnProc = null;
const cleanup = () => { if (fnProc) try { killTree(fnProc); } catch {} for (const s of [ckSrv, sbSrv]) try { s.close(); } catch {} };
process.on("exit", cleanup);
{
  const env = { ...process.env, CK_BASE: `http://127.0.0.1:${CK}/`, SUPABASE_URL: `http://127.0.0.1:${SB}`, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, SUPABASE_ANON_KEY: "anon",
    CK_USER_ID: "ckuser", CK_ELECTRICITY_KEY: "k-el" };
  fnProc = spawn("deno", ["run", "--allow-all", "--no-lock", "--node-modules-dir=none", FN], { env, shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; fnProc.stdout.on("data", (d) => (log += d)); fnProc.stderr.on("data", (d) => (log += d));
  globalThis.__fnlog = () => log;
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { const r = await fetch(`http://127.0.0.1:${FNPORT}/`, { method: "OPTIONS" }); up = r.status < 500; } catch {} if (!up) await sleep(1000); }
  if (!up) { console.log("function never started\n" + log.slice(-2000)); cleanup(); process.exit(2); }
}
const call = async (body, headers = { Authorization: `Bearer ${SERVICE_KEY}` }) => {
  const r = await fetch(`http://127.0.0.1:${FNPORT}/`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { status: r.status, j: await r.json().catch(() => null) };
};
const buyElec = (rid) => call({ action: "electricity", company: "01", meterType: "01", meterNo: "45012345678", amount: "2000", phone: "08011111111", requestId: rid });

try {
  // ── purchase ──
  states = { "ORD-E1": [{ status: "ORDER_RECEIVED", statuscode: "100" }, { status: "ORDER_COMPLETED", statuscode: "200", metertoken: TOKEN }] };
  let t0 = Date.now(), r = (await buyElec("E1")).j;
  ok(r?.status === "SUCCESS" && r.token === TOKEN, "token on the 2nd lookup → delivered", JSON.stringify(r));
  ok(Date.now() - t0 < 12000, `…within seconds (${Math.round((Date.now() - t0) / 1000)} s)`);

  states = { "ORD-E2": [{ status: "ORDER_RECEIVED", statuscode: "100" }, { status: "ORDER_REFUNDED", statuscode: "899", metertoken: "" }] };
  r = (await buyElec("E2")).j;
  ok(r?.error && /could not issue a token/.test(r.error) && !CK_NET_ERR.test(r.error), "THE 26 SEPT CASE: provider refunded (899) → a refusal the app refunds at once", JSON.stringify(r));

  states = { "ORD-E3": [{ status: "ORDER_RECEIVED", statuscode: "100" }] };
  t0 = Date.now(); r = (await buyElec("E3")).j;
  const waited = (Date.now() - t0) / 1000;
  ok(r?.status === "PENDING" && r.reference === "ORD-E3", "no token yet → PENDING with the order id (app keeps asking)", JSON.stringify(r));
  ok(waited < 30, `hands over after ~23 s, not ~88 s (${Math.round(waited)} s)`);

  buy = { E4: { status: "ORDER_RECEIVED", statuscode: "100" } };   // no order id in the reply
  states = { E4: [{ status: "ORDER_COMPLETED", statuscode: "200", metertoken: TOKEN }] };
  ckCalls = []; r = (await buyElec("E4")).j;
  ok(r?.status === "SUCCESS" && ckCalls.some((c) => c.by === "R:E4"), "reply without an order id → looked up by the payment reference", JSON.stringify([r, ckCalls]));
  buy = {};

  // ── electricity-query (the app's polling) ──
  states = { "ORD-Q1": [{ status: "ORDER_REFUNDED", statuscode: "899" }] };
  r = (await call({ action: "electricity-query", orderId: "ORD-Q1" })).j;
  ok(r?.status === "CANCELLED" && /could not issue a token/.test(r.message), "query: refunded → CANCELLED (no longer 'pending' forever)", JSON.stringify(r));
  states = { "KDT-BILL-1759999": [{ status: "ORDER_COMPLETED", statuscode: "200", metertoken: TOKEN }] };
  ckCalls = []; r = (await call({ action: "electricity-query", orderId: "KDT-BILL-1759999" })).j;
  ok(r?.status === "SUCCESS" && r.token === TOKEN && ckCalls[0]?.by === "R:KDT-BILL-1759999", "query: a payment reference is looked up as RequestID", JSON.stringify([r, ckCalls]));
  ok(!globalThis.__fnlog().includes("1234-5678") && !globalThis.__fnlog().includes("45012345678"), "the function log never contains the token or the meter number");

  // ── electricity-sweep ──
  const old = (min) => new Date(Date.now() - min * 60000).toISOString();
  const row = (id, orderId, min, extra = {}) => ({ id, user_id: `u-${id}`, amount: 2976, note: `Meter: 450 | Type: Prepaid | Provider: AEDC | Token loading... | Ref: ${orderId}`, bill_details: { orderId, paid_via: "wallet" }, created_at: old(min), ...extra });
  txRows = [row("t1", "ORD-S1", 10), row("t2", "ORD-S2", 15), row("t3", "ORD-S3", 20), row("t4", "ORD-S4", 49 * 60)];
  ledger = { t2: { id: "led-2", status: "completed" } };   // t2 paid from wallet (linked); t3 not linked (card)
  states = {
    "ORD-S1": [{ status: "ORDER_COMPLETED", statuscode: "200", metertoken: TOKEN, units: "45.2" }],
    "ORD-S2": [{ status: "ORDER_REFUNDED", statuscode: "899" }],
    "ORD-S3": [{ status: "ORDER_CANCELLED", statuscode: "500" }],
    "ORD-S4": [{ status: "ORDER_RECEIVED", statuscode: "100" }],
  };

  let s = await call({ action: "electricity-sweep" }, { "x-cron-secret": "wrong" });
  ok(s.status === 401, "sweep refuses a wrong cron secret", String(s.status));
  s = await call({ action: "electricity-sweep" }, {});
  ok(s.status === 401, "sweep refuses no credentials", String(s.status));

  patches = []; rpcs = []; notifies = []; adminNotes = [];
  s = await call({ action: "electricity-sweep", dryRun: true }, { "x-cron-secret": "good-secret" });
  ok(s.status === 200 && s.j?.checked === 4 && s.j.delivered === 1 && s.j.refundedToWallet === 1 && s.j.manualRefund === 1 && s.j.waiting === 1, "dry run classifies all four", JSON.stringify(s.j));
  ok(patches.length === 0 && !rpcs.some((x) => x.rpc === "wallet_reverse_bill") && notifies.length === 0 && adminNotes.length === 0, "dry run changes nothing", JSON.stringify({ patches: patches.length, rpcs, notifies: notifies.length }));
  ok(!JSON.stringify(s.j).includes("1234-5678"), "the sweep answer never contains a token");

  states["ORD-S1"] = [{ status: "ORDER_COMPLETED", statuscode: "200", metertoken: TOKEN, units: "45.2" }];
  s = await call({ action: "electricity-sweep" }, { "x-cron-secret": "good-secret" });
  await sleep(300);
  const p1 = patches.find((p) => p.q.id === "eq.t1");
  ok(p1?.body.bill_details?.token === TOKEN && /^Token: 1234-5678-9012-3456-7890 \| Units: 45.2 \| Meter: 450/.test(p1?.body.note) && !/Token loading/.test(p1?.body.note), "late token saved on the order in the app's format", p1?.body.note);
  ok(p1?.q.note === "ilike.%Token loading%", "…only while it still says 'Token loading' (no double write)", JSON.stringify(p1?.q));
  ok(notifies.some((n) => n.userId === "u-t1" && /token is ready/.test(n.title)), "customer told the token is ready");

  ok(rpcs.some((x) => x.rpc === "wallet_reverse_bill" && x.args.p_ledger_id === "led-2"), "refunded order: the order's own wallet debit is reversed", JSON.stringify(rpcs));
  const p2 = patches.find((p) => p.q.id === "eq.t2");
  ok(p2?.body.bill_status === "failed" && /refunded to your wallet/.test(p2?.body.note) && p2?.body.bill_details?.refund === "wallet", "…order marked failed, refunded to wallet", JSON.stringify(p2?.body).slice(0, 200));
  ok(notifies.some((n) => n.userId === "u-t2" && /refunded/i.test(n.title) && /back in your wallet/.test(n.body)), "…customer told the money is back");

  const p3 = patches.find((p) => p.q.id === "eq.t3");
  ok(p3?.body.bill_status === "failed" && /our team is refunding you/.test(p3?.body.note) && !rpcs.some((x) => x.rpc === "wallet_reverse_bill" && x.args.p_ledger_id !== "led-2"), "card/unlinked order: marked failed, NO guessed wallet refund", JSON.stringify(p3?.body).slice(0, 160));
  ok(adminNotes.some((a) => /manual refund/i.test(a.title) && a.metadata?.txn_id === "t3"), "…admins told to refund it by hand", JSON.stringify(adminNotes.map((a) => a.title)));

  ok(adminNotes.some((a) => /48 hours/.test(a.title) && a.metadata?.txn_id === "t4") && patches.some((p) => p.q.id === "eq.t4" && p.body.bill_details?.sweep_alerted === true), "waiting > 48 h: admins alerted once (flag set)", JSON.stringify(adminNotes.map((a) => a.title)));
  ok(!adminNotes.concat(notifies).some((x) => JSON.stringify(x).includes("1234-5678") || JSON.stringify(x).includes("45012345678")), "no token or meter number in any alert or notification");

  // ── our key refused for the LOOKUP (1 Oct evening: the key was reset on clubkonnect.com) — says nothing about the order ──
  txRows = [row("t5", "ORD-S5", 30)]; ledger = { t5: { id: "led-5", status: "completed" } };
  states = { "ORD-S5": [{ status: "INVALID_CREDENTIALS" }] };
  patches = []; rpcs = []; notifies = []; adminNotes = [];
  s = await call({ action: "electricity-sweep" }, { "x-cron-secret": "good-secret" });
  ok(s.j?.waiting === 1 && s.j.refundedToWallet === 0 && s.j.manualRefund === 0 && !rpcs.some((x) => x.rpc === "wallet_reverse_bill") &&
    !patches.some((p) => p.body.bill_status === "failed") && notifies.length === 0, "sweep: lookup refused for our key → still waiting, NOT refunded", JSON.stringify([s.j, rpcs.map((x) => x.rpc), patches.length]));
  states = { "ORD-Q2": [{ status: "INVALID_CREDENTIALS" }] };
  r = (await call({ action: "electricity-query", orderId: "ORD-Q2" })).j;
  ok(r?.status === "PENDING", "query: lookup refused for our key → PENDING, not CANCELLED", JSON.stringify(r));
  states = { "ORD-E5": [{ status: "ORDER_RECEIVED", statuscode: "100" }, { status: "INVALID_CREDENTIALS" }] };
  r = (await buyElec("E5")).j;
  ok(r?.status === "PENDING" && !r.error, "purchase taken, then the key is refused for the follow-up lookups → PENDING (the sweep finishes it), not a refund", JSON.stringify(r));
  buy = { E6: { status: "INVALID_CREDENTIALS" } };
  r = (await buyElec("E6")).j;
  ok(r?.error && !CK_NET_ERR.test(r.error), "the PURCHASE refused for our key → still a refusal the app refunds (nothing was bought)", JSON.stringify(r));
  buy = {};
} finally { cleanup(); }
console.log(fails ? `\n${fails} of ${checks} checks FAILED` : `\nall ${checks} checks passed`);
process.exit(fails ? 1 : 0);
