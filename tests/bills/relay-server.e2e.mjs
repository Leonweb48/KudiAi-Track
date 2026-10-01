// Bill-payment regression suite (moved from local testing on 2026-10-01). Run: node tests/bills/relay-server.e2e.mjs  — see tests/bills/README.md
// End-to-end test of flw-relay/server.js: the real relay process between a fake ClubKonnect and a fake Flutterwave.
import { RELAY_JS } from "./_harness.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

let fails = 0, checks = 0;
const ok = (c, m, x = "") => { checks++; if (!c) { fails++; console.log(`  FAIL ${m}\n       ${x}`); } else console.log(`  ok   ${m}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fake ClubKonnect: records what reached it; /APICrash.asp answers like IIS when it breaks
const ckSeen = [];
let ckMode = "ok";
const fakeCk = createServer((req, res) => {
  ckSeen.push({ method: req.method, url: req.url });
  if (req.url.startsWith("/APIAirtimeV1.asp") && ckMode === "503") { res.writeHead(503, { "Content-Type": "text/html" }); return res.end("<h1>Service Unavailable</h1>"); }
  if (req.url.startsWith("/APISlow.asp")) return;   // never answers
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ORDER_RECEIVED", echo: req.url }));
}).listen(18801);
const flwSeen = [];
const fakeFlw = createServer(async (req, res) => {
  let b = ""; for await (const c of req) b += c;
  flwSeen.push({ method: req.method, url: req.url, body: b, auth: req.headers.authorization });
  res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"status":"success"}');
}).listen(18802);

const relayLog = [];
const relay = spawn(process.execPath, [RELAY_JS], {
  env: { ...process.env, RELAY_KEY: "test-relay-key", PORT: "18800", CK_BASE_URL: "http://127.0.0.1:18801", FLW_BASE_URL: "http://127.0.0.1:18802" },
});
relay.stdout.on("data", (d) => relayLog.push(String(d))); relay.stderr.on("data", (d) => relayLog.push(String(d)));
await sleep(800);
const R = "http://127.0.0.1:18800";
const K = { "x-relay-key": "test-relay-key" };

try {
  // 1. a ClubKonnect call is forwarded with its exact path + query, answer passed straight back
  const q = "UserID=CK100&APIKey=SECRET%2Bkey%3D%3D&MobileNetwork=01&Amount=50&MobileNumber=08134807312&RequestID=KDT1&CallBackURL=https%3A%2F%2Fkudiai.app%2F";
  let r = await fetch(`${R}/ck/APIAirtimeV1.asp?${q}`, { headers: K });
  let t = await r.text();
  ok(r.status === 200 && !r.headers.get("x-relay-error"), "forwarded call answers 200, no relay-error marker", `${r.status}`);
  ok(ckSeen.at(-1)?.url === `/APIAirtimeV1.asp?${q}`, "ClubKonnect receives exactly the same script + query (encoding intact)", ckSeen.at(-1)?.url);
  ok(JSON.parse(t).status === "ORDER_RECEIVED" && r.headers.get("content-type").includes("json"), "ClubKonnect's JSON + content type come back unchanged", t);

  // 2. ClubKonnect's own error page is passed through as ClubKonnect's (no relay marker) — the function's retry logic sees it as before
  ckMode = "503";
  r = await fetch(`${R}/ck/APIAirtimeV1.asp?UserID=CK100`, { headers: K }); t = await r.text();
  ok(r.status === 503 && !r.headers.get("x-relay-error") && t.includes("Service Unavailable"), "ClubKonnect's 503 page passes through as ClubKonnect's answer", `${r.status} ${r.headers.get("x-relay-error")}`);
  ckMode = "ok";

  // 3. no / wrong relay key → refused, marked as the relay's own error, never reaches ClubKonnect
  const before = ckSeen.length;
  r = await fetch(`${R}/ck/APIWalletBalanceV1.asp?UserID=CK100`, { headers: { "x-relay-key": "wrong" } });
  ok(r.status === 401 && r.headers.get("x-relay-error") === "1", "wrong relay key → 401 marked X-Relay-Error", `${r.status}`);
  r = await fetch(`${R}/ck/APIWalletBalanceV1.asp?UserID=CK100`);
  ok(r.status === 401 && r.headers.get("x-relay-error") === "1", "no relay key → 401 marked X-Relay-Error");
  ok(ckSeen.length === before, "refused calls never reach ClubKonnect");

  // 4. only ClubKonnect API scripts — nothing else on that host, no path tricks
  for (const p of ["/ck/login.asp", "/ck/../APIAirtimeV1.asp", "/ck/APIAirtimeV1.asp/x", "/ck/sub/APIAirtimeV1.asp", "/ck/APIAirtimeV1.aspx", "/ck/"]) {
    r = await fetch(`${R}${p}?UserID=CK100`, { headers: K });
    ok(r.status >= 400 && r.headers.get("x-relay-error") === "1", `blocked path ${p} → ${r.status} marked as relay error`);
  }
  ok(ckSeen.length === before, "no blocked path reached ClubKonnect");

  // 5. ClubKonnect unreachable → 502 marked as the relay's error (the function then retries / holds the order)
  fakeCk.close(); await sleep(200);
  r = await fetch(`${R}/ck/APIAirtimeV1.asp?UserID=CK100`, { headers: K });
  ok(r.status === 502 && r.headers.get("x-relay-error") === "1", "ClubKonnect down → 502 marked X-Relay-Error", `${r.status}`);

  // 6. Flutterwave payouts still work exactly as before
  r = await fetch(`${R}/direct-transfers`, { method: "POST", headers: { ...K, Authorization: "Bearer flw", "Content-Type": "application/json" }, body: '{"amount":100}' });
  ok(r.status === 200 && flwSeen.at(-1)?.url === "/direct-transfers" && flwSeen.at(-1)?.body === '{"amount":100}' && flwSeen.at(-1)?.auth === "Bearer flw", "Flutterwave POST /direct-transfers still forwarded unchanged");
  r = await fetch(`${R}/health`); ok(r.status === 200 && (await r.text()) === "ok", "/health still ok");

  // 7. the relay never logs the query (it holds our UserID and API key)
  await sleep(200);
  const log = relayLog.join("");
  ok(!/SECRET|CK100|APIKey|08134807312/.test(log), "relay log has no API key, UserID or phone number", log.slice(0, 300));
  ok(/relay GET \/ck\/APIAirtimeV1\.asp -> 200/.test(log), "relay log names only the script and status");
} finally {
  relay.kill(); fakeFlw.close(); try { fakeCk.close(); } catch {}
}
console.log(fails ? `\n${fails} of ${checks} checks FAILED` : `\nall ${checks} checks passed`);
process.exit(fails ? 1 : 0);
