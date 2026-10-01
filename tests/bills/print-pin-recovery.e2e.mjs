// Bill-payment regression suite (moved from local testing on 2026-10-01). Run: node tests/bills/print-pin-recovery.e2e.mjs  — see tests/bills/README.md
// The REAL clubkonnect function's "epin-recover" mode against a fake Supabase (failed print orders) and a fake
// ClubKonnect (the issued PINs): dry run changes nothing; apply writes the app's delivered-order shape; never echoes a PIN.
import { FN, killTree } from "./_harness.mjs";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
const CK = 8793, SB = 8794, FNPORT = 8000, SERVICE_KEY = "svc-test-key";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0, checks = 0;
const ok = (c, m, x = "") => { checks++; if (!c) { fails++; console.log(`  FAIL ${m}\n       ${x}`); } else console.log(`  ok   ${m}`); };

const SECRET = (i) => `98765432${String(i).padStart(4, "0")}`;
const pinsFor = (n) => Array.from({ length: n }, (_, i) => ({ pin: SECRET(i), sno: `SN${i}`, amount: "100", mobilenetwork: "MTN" }));
const orders = {
  "KDT-BILL-1001": { ORDER_ID: "77001", TXN_EPIN: pinsFor(20) },
  "KDT-BILL-1002": { ORDER_ID: "77002", TXN_EPIN: pinsFor(1) },
  "KDT-BILL-1003": { status: "INVALID_REQUESTID" },
};
const rows = [
  { id: "t1", user_id: "u1", category: "print-airtime", amount: 2000, note: "FAILED: Print airtime failed | PS: KDT-BILL-1001", created_at: "2026-10-01T08:28:00Z" },
  { id: "t2", user_id: "u1", category: "print-airtime", amount: 100, note: "FAILED: Print airtime failed | PS: KDT-BILL-1002", created_at: "2026-10-01T10:40:00Z" },
  { id: "t3", user_id: "u1", category: "print-airtime", amount: 500, note: "FAILED: Print airtime failed | PS: KDT-BILL-1003", created_at: "2026-10-01T11:00:00Z" },
  { id: "t4", user_id: "u1", category: "print-airtime", amount: 100, note: "FAILED: something", created_at: "2026-10-01T11:05:00Z" },
];
let patches = [], rpcs = [];
const ckSrv = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"); const path = u.pathname.slice(1); const p = Object.fromEntries(u.searchParams);
  res.writeHead(200, { "Content-Type": "application/json" });
  if (path === "APIQueryV1.asp") return res.end(JSON.stringify(orders[p.RequestID] ?? { status: "INVALID_REQUESTID" }));
  res.end("{}");
});
const sbSrv = http.createServer((req, res) => {
  let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    const u = new URL(req.url, "http://x"); const t = /^\/rest\/v1\/(?:rpc\/)?(\w+)/.exec(u.pathname)?.[1];
    const send = (c, o, h = {}) => { res.writeHead(c, { "Content-Type": "application/json", ...h }); res.end(o === null ? "" : JSON.stringify(o)); };
    if (t === "transactions" && req.method === "GET") return send(200, rows);
    if (t === "transactions" && req.method === "PATCH") {
      patches.push({ q: Object.fromEntries(u.searchParams), body: JSON.parse(b || "{}") });
      return send(204, null, { "content-range": "*/1" });
    }
    if (u.pathname.includes("/rpc/")) { rpcs.push(t); return send(200, null); }
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
    CK_USER_ID: "ckuser", CK_PRINT_AIRTIME_KEY: "k-pa", CK_PRINT_DATA_KEY: "k-pd" };
  fnProc = spawn("deno", ["run", "--allow-all", "--no-lock", "--node-modules-dir=none", FN], { env, shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; fnProc.stdout.on("data", (d) => (log += d)); fnProc.stderr.on("data", (d) => (log += d));
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { const r = await fetch(`http://127.0.0.1:${FNPORT}/`, { method: "OPTIONS" }); up = r.status < 500; } catch {} if (!up) await sleep(1000); }
  if (!up) { console.log("function never started\n" + log.slice(-2000)); cleanup(); process.exit(2); }
}
const call = async (body, auth = SERVICE_KEY) => (await fetch(`http://127.0.0.1:${FNPORT}/`, { method: "POST", headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" }, body: JSON.stringify(body) })).json().catch(() => null);

try {
  let r = await call({ action: "ck-variants", mode: "epin-recover" }, "not-the-service-key");
  ok(!r?.results, "not callable without the service key", JSON.stringify(r).slice(0, 120));

  r = await call({ action: "ck-variants", mode: "epin-recover" });
  ok(r?.apply === false && patches.length === 0, "preview (no apply) writes nothing", JSON.stringify(patches));
  const [a, b, c, d] = r?.results ?? [];
  ok(a?.pins === 20 && a?.network === "MTN" && a?.value === 100 && b?.pins === 1, "preview reports 20 + 1 PINs, MTN, ₦100", JSON.stringify([a, b]));
  ok(/no PINs/.test(c?.skipped ?? "") && /no payment reference/.test(d?.skipped ?? ""), "orders ClubKonnect doesn't have / without a reference are skipped", JSON.stringify([c, d]));
  ok(!JSON.stringify(r).includes("98765432"), "the answer never contains a PIN");

  r = await call({ action: "ck-variants", mode: "epin-recover", apply: true });
  await sleep(500);
  ok(patches.length === 2, "apply updates exactly the two orders that have PINs", JSON.stringify(patches.map((p) => p.q)));
  const p1 = patches.find((p) => p.q.id === "eq.t1");
  ok(p1?.q.bill_status === "eq.failed", "only an order still marked failed is touched (no double recovery)", JSON.stringify(p1?.q));
  const body = p1?.body ?? {};
  ok(body.bill_status === "success" && body.item_name === "MTN ₦100 Airtime Print x20" && body.customer_name === "20 pins", "marked delivered with the app's item name", JSON.stringify(body).slice(0, 200));
  const [head, json] = String(body.note ?? "").split("__PINS__");
  const notePins = JSON.parse(json || "[]");
  ok(/^Network: MTN \| Value: ₦100 x20 \| Ref: 77001 \| Recovered from ClubKonnect$/.test(head), "note in the app's format", head);
  ok(notePins.length === 20 && notePins[0].pin === SECRET(0) && notePins[0].network === "MTN", "all 20 PINs in the note, each tagged with its network");
  ok(Array.isArray(body.bill_details?.pins) && body.bill_details.pins.length === 20 && body.bill_details.paid_via === "cashback", "PINs in bill_details too, paid via (fully covered)", JSON.stringify(body.bill_details).slice(0, 120));
  ok(!JSON.stringify(r).includes("98765432") && r?.results?.[0]?.updated === 1, "apply answer reports updated=1, still no PIN", JSON.stringify(r?.results?.[0]));
  ok(rpcs.includes("finance_record_bill_cost"), "provider cost recorded for the profit report", JSON.stringify(rpcs));
} finally { cleanup(); }
console.log(fails ? `\n${fails} of ${checks} checks FAILED` : `\nall ${checks} checks passed`);
process.exit(fails ? 1 : 0);
