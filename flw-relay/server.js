// KudiAI → Flutterwave payout relay.
//
// Flutterwave requires transfers to originate from a whitelisted IP. Supabase
// Edge Functions have no fixed egress IP, so this tiny service — deployed
// somewhere with ONE static outbound IP — forwards the payout call from that IP.
//
// It is a dumb, authenticated pass-through: it adds no logic, keeps no state,
// logs no bodies. All the OAuth + request building stays in the edge function.
//
//   POST /direct-transfers        → forwarded to <FLW_BASE_URL>/direct-transfers
//   POST /transfers/:id/retry     → forwarded likewise
//   GET  /ck/API<name>.asp?<query> → forwarded to <CK_BASE_URL>/API<name>.asp?<query>  (ClubKonnect: it also only
//                                    accepts our account's calls from whitelisted IPs)
//   GET  /health                  → 200 "ok"
//
// Auth: every forwarded request must carry  x-relay-key: <RELAY_KEY>.
// The relay's OWN failures (bad key, path not allowed, upstream unreachable) carry  X-Relay-Error: 1  so the caller never
// mistakes them for an answer from Flutterwave / ClubKonnect.

import { createServer } from "node:http";
import dns from "node:dns";

// Prefer IPv4 for outbound so the whitelisted (IPv4) address is the source —
// some hosts otherwise egress over IPv6, which Flutterwave's form can't accept.
dns.setDefaultResultOrder("ipv4first");

const RELAY_KEY = process.env.RELAY_KEY || "";
const FLW_BASE  = (process.env.FLW_BASE_URL || "https://f4bexperience.flutterwave.com").replace(/\/$/, "");
const CK_BASE   = (process.env.CK_BASE_URL || "https://www.nellobytesystems.com").replace(/\/$/, "");
const PORT      = Number(process.env.PORT || 8080);

// only these upstream paths may be proxied
const ALLOW = [/^\/direct-transfers$/, /^\/transfers\/[A-Za-z0-9_-]+\/retry$/, /^\/transfers$/];
const CK_PATH = /^\/ck\/(API[A-Za-z0-9]+\.asp)$/;   // ClubKonnect's API scripts, nothing else on that host

const send = (res, status, body, type = "application/json") => {
  res.writeHead(status, { "Content-Type": type });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};
// the relay's own failures — never confused with an upstream answer
const fail = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json", "X-Relay-Error": "1" });
  res.end(JSON.stringify(body));
};

const server = createServer(async (req, res) => {
  try {
    const url = (req.url || "").split("?")[0];

    if (req.method === "GET" && (url === "/health" || url === "/")) return send(res, 200, "ok", "text/plain");
    if (req.method === "GET" && url === "/whoami") {
      if (!RELAY_KEY || req.headers["x-relay-key"] !== RELAY_KEY) return send(res, 401, { error: "unauthorized" });
      try {
        const ip = await (await fetch("https://api.ipify.org?format=json")).json();
        return send(res, 200, ip);
      } catch (e) { return send(res, 502, { error: String(e?.message || e) }); }
    }
    // ClubKonnect: GET with everything in the query string. The query carries our UserID and API key — never logged.
    const ckm = CK_PATH.exec(url);
    if (req.method === "GET" && ckm) {
      if (!RELAY_KEY || req.headers["x-relay-key"] !== RELAY_KEY) return fail(res, 401, { error: "unauthorized" });
      const query = (req.url || "").slice(url.length);   // "?…" or ""
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 45_000);
      let upstream;
      try {
        upstream = await fetch(`${CK_BASE}/${ckm[1]}${query}`, { headers: { Accept: "application/json" }, signal: ctrl.signal });
      } catch (e) {
        console.error(`relay GET /ck/${ckm[1]} upstream error:`, e?.message || e);
        return fail(res, 502, { error: "relay upstream error" });
      } finally {
        clearTimeout(timer);
      }
      const text = await upstream.text();
      console.log(`relay GET /ck/${ckm[1]} -> ${upstream.status}`);
      return send(res, upstream.status, text, upstream.headers.get("content-type") || "text/plain");
    }

    if (req.method !== "POST") return fail(res, 405, { error: "method not allowed" });
    if (!RELAY_KEY || req.headers["x-relay-key"] !== RELAY_KEY) return fail(res, 401, { error: "unauthorized" });
    if (!ALLOW.some((re) => re.test(url))) return fail(res, 404, { error: "path not allowed" });

    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 1_000_000) return send(res, 413, { error: "too large" });
    }

    const headers = { "Content-Type": "application/json" };
    if (req.headers["authorization"])      headers["Authorization"]     = req.headers["authorization"];
    if (req.headers["x-idempotency-key"])  headers["X-Idempotency-Key"] = req.headers["x-idempotency-key"];
    if (req.headers["x-trace-id"])         headers["X-Trace-Id"]        = req.headers["x-trace-id"];

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45_000);
    let upstream;
    try {
      upstream = await fetch(FLW_BASE + url, { method: "POST", headers, body, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }

    const text = await upstream.text();
    console.log(`relay POST ${url} -> ${upstream.status}`);
    return send(res, upstream.status, text);
  } catch (e) {
    console.error("relay error:", e?.message || e);
    return fail(res, 502, { error: "relay upstream error", detail: String(e?.message || e) });
  }
});

server.listen(PORT, () => console.log(`flw-relay listening on :${PORT} → ${FLW_BASE}`));
