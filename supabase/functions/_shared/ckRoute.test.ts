// Run: deno test supabase/functions/_shared/ckRoute.test.ts
import { buyWithFallback, isProviderCrash, parseServiceList, PENDING_STATUS, probeVerdict, purchaseServiceState, V3_PATH, type CkResult, type Lookup, type RouteConfig, type RouteDeps, type RouteEvent } from "./ckRoute.ts";

function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`ASSERT ${msg}: got ${a}, expected ${e}`);
}

const CRASH: CkResult = { _raw: "<!DOCTYPE html PUBLIC ...><title>500 - Internal server error.</title>", _http: 500 };
const OK: CkResult = { statuscode: "100", status: "ORDER_RECEIVED", orderid: "CK1" };
const REJECT: CkResult = { status: "INVALID_DATAPLAN" };
const PARAMS = { APIKey: "k", MobileNetwork: "01", Amount: "100", MobileNumber: "08011111111", RequestID: "KDT-BILL-1", CallBackURL: "https://kudiai.app/" };
const isOk = (d: CkResult) => ["100", "200"].includes(String(d.statuscode)) || ["ORDER_RECEIVED", "ORDER_COMPLETED"].includes(String(d.status));
const CFG_ON: RouteConfig = { fallbackOn: true, fallbackServices: new Set(["airtime", "data"]), forceV3: new Set() };

// Scripted fake: `ck` answers per path from a queue; `lookup` answers from its own queue. Records every call.
function harness(opts: { v1?: (CkResult | Error)[]; v3?: (CkResult | Error)[]; lookups?: Lookup[]; cfg?: RouteConfig }) {
  const calls: string[] = [], events: RouteEvent[] = [];
  const v1 = [...(opts.v1 ?? [])], v3 = [...(opts.v3 ?? [])], lookups = [...(opts.lookups ?? [])];
  const deps: RouteDeps = {
    ck: async (path, params) => {
      calls.push(`${path}#${params.RequestID}`);
      const r = (path.includes("V3") ? v3 : v1).shift();
      if (r === undefined) throw new Error(`unexpected call to ${path}`);
      if (r instanceof Error) throw r;
      return r;
    },
    lookup: async (key, rid) => { calls.push(`lookup#${rid}#${key}`); const r = lookups.shift(); if (!r) throw new Error("unexpected lookup"); return r; },
    config: async () => opts.cfg ?? CFG_ON,
    isOk,
    alert: (e) => { events.push(e); },
  };
  return { deps, calls, events };
}

Deno.test("isProviderCrash: only a non-JSON 5xx counts — real answers and non-5xx junk don't", () => {
  eq(isProviderCrash(CRASH), true, "IIS 500 page");
  eq(isProviderCrash({ _raw: "<html>", _http: 502 }), true, "502 page");
  eq(isProviderCrash({ _raw: "plain text ok", _http: 200 }), false, "non-JSON 200 (e.g. electricity token text) is not a crash");
  eq(isProviderCrash(OK), false, "success");
  eq(isProviderCrash(REJECT), false, "a real JSON rejection");
  eq(isProviderCrash(null), false, "null");
});

Deno.test("every V3 twin is the same script name with V1 → V3", () => {
  for (const [v1, v3] of Object.entries(V3_PATH)) eq(v3, v1.replace("V1.asp", "V3.asp"), v1);
});

Deno.test("main route healthy: V1's answer is returned untouched, no lookup, no V3, no alert", async () => {
  const h = harness({ v1: [OK] });
  eq(await buyWithFallback("airtime", "APIAirtimeV1.asp", PARAMS, h.deps), OK, "result");
  eq(h.calls, ["APIAirtimeV1.asp#KDT-BILL-1"], "calls");
  eq(h.events, [], "no alert");
});

Deno.test("a real rejection from V1 (JSON) is never retried on V3 — it's an answer, not an outage", async () => {
  const h = harness({ v1: [REJECT] });
  eq(await buyWithFallback("airtime", "APIAirtimeV1.asp", PARAMS, h.deps), REJECT, "result");
  eq(h.calls.length, 1, "only V1");
});

Deno.test("a network error on V1 propagates unchanged (the app's own retry + confirm handles it)", async () => {
  const h = harness({ v1: [new Error("connection reset")] });
  let msg = ""; try { await buyWithFallback("airtime", "APIAirtimeV1.asp", PARAMS, h.deps); } catch (e) { msg = (e as Error).message; }
  eq(msg, "connection reset", "thrown");
  eq(h.calls.length, 1, "no lookup, no V3");
});

Deno.test("V1 crashes, no order exists → same order on V3 with the SAME RequestID → success via V3", async () => {
  const h = harness({ v1: [CRASH], v3: [OK], lookups: [{ kind: "not-found" }] });
  const r = await buyWithFallback("airtime", "APIAirtimeV1.asp", PARAMS, h.deps);
  eq(r, { ...OK, _via: "V3" }, "V3's answer, marked");
  eq(h.calls, ["APIAirtimeV1.asp#KDT-BILL-1", "lookup#KDT-BILL-1#k", "APIAirtimeV3.asp#KDT-BILL-1"], "lookup BEFORE V3, same RequestID + key");
  eq(h.events, [{ svc: "airtime", outcome: "v3-ok" }], "admins told");
});

Deno.test("V1 crashed but the order WAS created → returned as a success, V3 never called (no double purchase)", async () => {
  const q = { statuscode: "200", status: "ORDER_COMPLETED", orderid: "CK9" };
  const h = harness({ v1: [CRASH], lookups: [{ kind: "found-ok", q }] });
  eq(await buyWithFallback("airtime", "APIAirtimeV1.asp", PARAMS, h.deps), { ...q, _via: "V1-recovered" }, "the found order");
  eq(h.calls.some((c) => c.includes("V3")), false, "no V3");
  eq(h.events[0].outcome, "v1-recovered", "alert");
});

Deno.test("V1 crashed and an order exists but isn't finished → held as pending (app confirms, doesn't refund), no V3", async () => {
  const h = harness({ v1: [CRASH], lookups: [{ kind: "found-pending", q: { orderid: "CK9", status: "ORDER_ONHOLD" } }] });
  const r = await buyWithFallback("airtime", "APIAirtimeV1.asp", PARAMS, h.deps);
  eq([r.status, r._pending, r._via], [PENDING_STATUS, true, "V1"], "pending");
  eq(/gateway|timeout/i.test(String(r.status)), true, "matches the app's network-error pattern so it takes the confirm/hold path");
  eq(h.calls.some((c) => c.includes("V3")), false, "no V3");
});

Deno.test("V1 crashed and the lookup can't tell (down, unrecognised, or 'failed') → no second attempt, V1's crash returned", async () => {
  for (const kind of ["unknown", "found-failed"] as const) {
    const h = harness({ v1: [CRASH], lookups: [{ kind }] });
    eq(await buyWithFallback("airtime", "APIAirtimeV1.asp", PARAMS, h.deps), CRASH, kind);
    eq(h.calls.some((c) => c.includes("V3")), false, `${kind}: no V3`);
  }
});

Deno.test("V3 refuses with a real answer and the lookup confirms nothing was placed → V1's crash returned (customer refunded)", async () => {
  const h = harness({ v1: [CRASH], v3: [REJECT], lookups: [{ kind: "not-found" }, { kind: "not-found" }] });
  eq(await buyWithFallback("data", "APIDatabundleV1.asp", PARAMS, h.deps), CRASH, "the clean-error path, not V3's confusing INVALID_DATAPLAN");
  eq(h.events, [{ svc: "data", outcome: "v3-rejected", detail: "INVALID_DATAPLAN" }], "admins see why V3 refused");
});

Deno.test("V3 refuses and the lookup can't tell → still no hold: a real refusal means nothing was placed", async () => {
  const h = harness({ v1: [CRASH], v3: [REJECT], lookups: [{ kind: "not-found" }, { kind: "unknown" }] });
  eq(await buyWithFallback("data", "APIDatabundleV1.asp", PARAMS, h.deps), CRASH, "refund path");
});

Deno.test("V3 answers in a shape we don't recognise as success, but the lookup shows the order done → success, not a refund", async () => {
  const q = { statuscode: "200", status: "ORDER_COMPLETED", orderid: "CK5" };
  const h = harness({ v1: [CRASH], v3: [{ status: "SOMETHING_NEW", orderid: "CK5" }], lookups: [{ kind: "not-found" }, { kind: "found-ok", q }] });
  eq(await buyWithFallback("airtime", "APIAirtimeV1.asp", PARAMS, h.deps), { ...q, _via: "V3-recovered" }, "trust the lookup");
});

Deno.test("V3 crashes too and the lookup confirms no order → V1's crash returned (refund); lookup shows one → pending", async () => {
  let h = harness({ v1: [CRASH], v3: [CRASH], lookups: [{ kind: "not-found" }, { kind: "not-found" }] });
  eq(await buyWithFallback("airtime", "APIAirtimeV1.asp", PARAMS, h.deps), CRASH, "both down, nothing placed");
  eq(h.events[0].outcome, "v3-failed", "alert");
  h = harness({ v1: [CRASH], v3: [CRASH], lookups: [{ kind: "not-found" }, { kind: "found-pending", q: { orderid: "X" } }] });
  eq((await buyWithFallback("airtime", "APIAirtimeV1.asp", PARAMS, h.deps))._pending, true, "order exists after V3 crash → hold");
});

Deno.test("V3 crashes/unreachable and the lookup can't tell → hold (an order may exist), never refund blind", async () => {
  for (const v3 of [CRASH, new Error("timeout")]) {
    const h = harness({ v1: [CRASH], v3: [v3], lookups: [{ kind: "not-found" }, { kind: "unknown" }] });
    eq((await buyWithFallback("airtime", "APIAirtimeV1.asp", PARAMS, h.deps))._pending, true, String(v3 instanceof Error ? v3.message : "crash"));
  }
});

Deno.test("switches: master off, service not listed, or an unrouted path → V1's crash returned, nothing else called", async () => {
  const cases: [string, string, RouteConfig][] = [
    ["master off", "airtime", { ...CFG_ON, fallbackOn: false }],
    ["service not listed", "electricity", CFG_ON],
    ["no V3 twin", "airtime", CFG_ON],
  ];
  for (const [name, svc, cfg] of cases) {
    const h = harness({ v1: [CRASH], cfg });
    const path = name === "no V3 twin" ? "APIQueryV1.asp" : (svc === "electricity" ? "APIElectricityV1.asp" : "APIAirtimeV1.asp");
    eq(await buyWithFallback(svc, path, PARAMS, h.deps), CRASH, name);
    eq(h.calls.length, 1, `${name}: only the first call`);
  }
});

Deno.test("no RequestID → no fallback (the lookup and the no-double-charge guarantee both need it)", async () => {
  const h = harness({ v1: [CRASH] });
  const { RequestID: _drop, ...noRid } = PARAMS;
  eq(await buyWithFallback("airtime", "APIAirtimeV1.asp", noRid, h.deps), CRASH, "returned as-is");
  eq(h.calls.length, 1, "no lookup");
});

Deno.test("test mode (force V3): goes straight to V3, V1 never called", async () => {
  const h = harness({ v3: [OK], cfg: { ...CFG_ON, forceV3: new Set(["airtime"]) } });
  eq(await buyWithFallback("airtime", "APIAirtimeV1.asp", PARAMS, h.deps), { ...OK, _via: "V3" }, "V3 answer");
  eq(h.calls, ["APIAirtimeV3.asp#KDT-BILL-1"], "only V3");
});

Deno.test("probeVerdict: a JSON refusal is 'up', a 5xx error page 'down', anything else 'unknown'", () => {
  eq(probeVerdict({ status: "INVALID_DATAPLAN" }), "up", "a real refusal = the service works");
  eq(probeVerdict({ _raw: "The service is unavailable.", _http: 503 }), "down", "IIS 503 (2026-09-28 evening)");
  eq(probeVerdict(CRASH), "down", "IIS 500");
  eq(probeVerdict({ _raw: "odd text", _http: 200 }), "unknown", "non-JSON 200");
  eq(probeVerdict(null), "unknown", "no answer (network error)");
});

Deno.test("purchaseServiceState: 'down' ONLY when both scripts are down — one bad script can never pause every sale", () => {
  eq(purchaseServiceState("down", "down"), "down", "both down");
  eq(purchaseServiceState("down", "up"), "up", "one working = the service is up");
  eq(purchaseServiceState("up", "down"), "up", "either order");
  eq(purchaseServiceState("down", "unknown"), "unknown", "one down, one can't tell → never block");
  eq(purchaseServiceState("unknown", "unknown"), "unknown", "can't tell");
  eq(purchaseServiceState("up", "up"), "up", "healthy");
});

Deno.test("parseServiceList trims, lower-cases and drops blanks", () => {
  eq([...parseServiceList(" Airtime, data ,,CABLE ")], ["airtime", "data", "cable"], "list");
  eq([...parseServiceList(null)], [], "null");
  eq([...parseServiceList("")], [], "empty");
});
