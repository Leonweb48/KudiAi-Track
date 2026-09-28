// Run: deno test supabase/functions/_shared/billProvider.test.ts
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buyAcrossProviders, ckAccountRefusal, classifyVt, combineVerdicts, LOOKALIKE_MSG, parseProviderConfig, providerOrder, RETRY_MSG,
  UNAVAILABLE_MSG, vtCostKobo, vtMessage, vtProbeVerdict, vtVerify, type BuyDeps, type BuyOutcome, type Provider,
  type ProviderState, type SwitchEvent,
} from "./billProvider.ts";
import { PENDING_STATUS, type CkResult, type Lookup } from "./ckRoute.ts";
import type { VtResult } from "./vtpass.ts";

// ── VTpass answers exactly as the sandbox gave them (vtpass-probe, 2026-09-28) ─────────────────────────────────────
const txn = (status: string) => ({ transactions: { status, total_amount: 96.5, commission: 3.5, amount: "100", transactionId: "17590000000001" } });
const VT = {
  delivered: { _http: 200, code: "000", response_description: "TRANSACTION SUCCESSFUL", requestId: "R", content: txn("delivered") },
  pending:   { _http: 200, code: "000", response_description: "TRANSACTION PROCESSING - PENDING", requestId: "R", content: txn("pending") },
  failed:    { _http: 200, code: "016", response_description: "TRANSACTION FAILED", requestId: "R", content: txn("failed") },
  dup:       { _http: 200, code: "014", response_description: "REQUEST ID ALREADY EXIST", content: { errors: [] } },
  notFound:  { _http: 200, code: "015", response_description: "INVALID REQUEST ID", content: { errors: [] } },
  sysError:  { _http: 500, code: "083", content: { errors: [] } },
  lowWallet: { _http: 200, code: "018", response_description: "LOW WALLET BALANCE" },
  badCreds:  { _http: 200, code: "087", response_description: "INVALID CREDENTIALS" },
  belowMin:  { _http: 200, code: "013", response_description: "BELOW MINIMUM AMOUNT ALLOWED" },
  lookalike: { _http: 200, code: "019", response_description: "LIKELY DUPLICATE TRANSACTION" },   // sandbox proof, 2026-09-28
  page:      { _raw: "<html><body>502 Bad Gateway</body></html>", _http: 502 },
  dead:      { _unreachable: true, _error: "connection reset" },
} satisfies Record<string, VtResult>;

const CK = {
  ok:        { statuscode: "100", status: "ORDER_RECEIVED", orderid: "CK-1" },
  crash:     { _raw: "<html>503 Service Unavailable</html>", _http: 503 },
  lowWallet: { status: "INSUFFICIENT_BALANCE" },
  badCreds:  { status: "INVALID_CREDENTIALS" },
  badNumber: { status: "INVALID_MOBILENUMBER" },
} satisfies Record<string, CkResult>;

const isOk = (d: CkResult) => String(d.statuscode) === "100" || d.status === "ORDER_RECEIVED";

// ── A fake world: one claim row, scripted provider answers, a log of every call ────────────────────────────────────
interface World {
  row: Provider[] | null;            // the claim row, as the database holds it
  claimDown?: boolean;               // the claim can't be recorded
  ck: (CkResult | Error)[];          // successive ClubKonnect purchase answers
  lookup: Lookup[];                  // successive ClubKonnect lookup answers
  pay: VtResult[];                   // successive VTpass /pay answers
  requery: VtResult[];               // successive VTpass /requery answers
  calls: string[];
  alerts: SwitchEvent[];
}
function world(w: Partial<World>): World {
  return { row: null, ck: [], lookup: [], pay: [], requery: [], calls: [], alerts: [], ...w };
}
function deps(w: World): BuyDeps {
  const take = <T>(q: T[], what: string): T => { if (!q.length) throw new Error(`unexpected ${what} call`); return q.shift()!; };
  return {
    // Same semantics as the SQL bill_provider_claim: insert if new; append only if the caller's view is current.
    claim: async (p, expect) => {
      w.calls.push(`claim:${p}<-[${expect.join(",")}]`);
      if (w.claimDown) return null;
      if (!w.row) { w.row = [p]; return [...w.row]; }
      if (JSON.stringify(w.row) === JSON.stringify(expect) && !w.row.includes(p)) w.row = [...w.row, p];
      return [...w.row];
    },
    ck: async () => { w.calls.push("ck"); const r = take(w.ck, "ck"); if (r instanceof Error) throw r; return r; },
    ckLookup: async () => { w.calls.push("ckLookup"); return take(w.lookup, "ckLookup"); },
    vtPay: async () => { w.calls.push("vtPay"); return take(w.pay, "vtPay"); },
    vtRequery: async () => { w.calls.push("vtRequery"); return take(w.requery, "vtRequery"); },
    isOk,
    alert: (e) => { w.alerts.push(e); },
  };
}
const run = (order: Provider[], w: World): Promise<BuyOutcome> => buyAcrossProviders("airtime", order, deps(w));
const BOTH: Provider[] = ["clubkonnect", "vtpass"];
const VT_FIRST: Provider[] = ["vtpass", "clubkonnect"];

// ── Config and order ─────────────────────────────────────────────────────────────────────────────────────────────

Deno.test("parseProviderConfig: defaults to ClubKonnect with failover on; only exact values change it", () => {
  assertEquals(parseProviderConfig({}), { primary: "clubkonnect", failover: true });
  assertEquals(parseProviderConfig({ bill_provider: " VTpass ", bill_provider_failover: "false" }), { primary: "vtpass", failover: false });
  assertEquals(parseProviderConfig({ bill_provider: "paystack", bill_provider_failover: "no" }), { primary: "clubkonnect", failover: true });
});

const st = (vtUsable: boolean, ck: ProviderState["health"]["clubkonnect"] = "up", vt: ProviderState["health"]["vtpass"] = "up"): ProviderState =>
  ({ vtUsable, health: { clubkonnect: ck, vtpass: vt } });

Deno.test("providerOrder: VTpass never serves customers unless it is usable (live keys) — even when chosen", () => {
  assertEquals(providerOrder("airtime", { primary: "vtpass", failover: true }, st(false)), ["clubkonnect"]);
  assertEquals(providerOrder("airtime", { primary: "clubkonnect", failover: true }, st(false, "down")), ["clubkonnect"]);
});

Deno.test("providerOrder: services VTpass doesn't carry stay on ClubKonnect", () => {
  for (const svc of ["electricity", "cable", "betting", "print-airtime", "waec", "smile"]) {
    assertEquals(providerOrder(svc, { primary: "vtpass", failover: true }, st(true, "down")), ["clubkonnect"], svc);
  }
});

Deno.test("providerOrder: main provider first, the other as backup; failover off = main only", () => {
  assertEquals(providerOrder("airtime", { primary: "clubkonnect", failover: true }, st(true)), BOTH);
  assertEquals(providerOrder("data", { primary: "vtpass", failover: true }, st(true)), VT_FIRST);
  assertEquals(providerOrder("airtime", { primary: "vtpass", failover: false }, st(true)), ["vtpass"]);
  assertEquals(providerOrder("airtime", { primary: "clubkonnect", failover: false }, st(true, "down")), ["clubkonnect"]);
});

Deno.test("providerOrder: a main provider known to be down is skipped while the other isn't down", () => {
  assertEquals(providerOrder("airtime", { primary: "clubkonnect", failover: true }, st(true, "down", "up")), ["vtpass"]);
  assertEquals(providerOrder("airtime", { primary: "clubkonnect", failover: true }, st(true, "down", "unknown")), ["vtpass"]);
  assertEquals(providerOrder("airtime", { primary: "vtpass", failover: true }, st(true, "up", "down")), ["clubkonnect"]);
  assertEquals(providerOrder("airtime", { primary: "clubkonnect", failover: true }, st(true, "down", "down")), BOTH);
  assertEquals(providerOrder("airtime", { primary: "clubkonnect", failover: true }, st(true, "unknown", "up")), BOTH);
});

// ── Reading answers ──────────────────────────────────────────────────────────────────────────────────────────────

Deno.test("classifyVt: every sandbox shape", () => {
  assertEquals(classifyVt(VT.delivered), "delivered");
  assertEquals(classifyVt(VT.pending), "pending");
  assertEquals(classifyVt(VT.failed), "failed");
  assertEquals(classifyVt(VT.dup), "duplicate");
  assertEquals(classifyVt(VT.notFound), "not-found");
  assertEquals(classifyVt(VT.sysError), "unknown");
  assertEquals(classifyVt(VT.page), "unknown");
  assertEquals(classifyVt(VT.dead), "unknown");
  assertEquals(classifyVt(VT.lowWallet), "refused");
  assertEquals(classifyVt(VT.belowMin), "refused");
  assertEquals(classifyVt(null), "unknown");
});

Deno.test("classifyVt: accepted-but-not-final is pending; reversed is failed; an unknown code is unknown", () => {
  assertEquals(classifyVt({ code: "000", content: txn("initiated") }), "pending");
  assertEquals(classifyVt({ code: "000", content: {} }), "pending");
  assertEquals(classifyVt({ code: "000", content: txn("reversed") }), "failed");
  assertEquals(classifyVt({ code: "099" }), "pending");
  assertEquals(classifyVt({ code: "040" }), "failed");
  assertEquals(classifyVt({ code: "777" }), "unknown");
});

Deno.test("vtMessage: the customer sees order problems, never our account problems", () => {
  assertEquals(vtMessage(VT.belowMin), "Below minimum amount allowed");
  assertEquals(vtMessage(VT.failed), "Transaction failed");
  assertEquals(vtMessage(VT.lowWallet), UNAVAILABLE_MSG);
  assertEquals(vtMessage(VT.badCreds), UNAVAILABLE_MSG);
  assertEquals(vtMessage(VT.page), UNAVAILABLE_MSG);
  assertEquals(vtMessage({ code: "013", response_description: "<html>oops</html>" }), UNAVAILABLE_MSG);
});

Deno.test("ckAccountRefusal: our wallet / credentials — not the customer's number, not an error page", () => {
  assert(ckAccountRefusal(CK.lowWallet));
  assert(ckAccountRefusal(CK.badCreds));
  assert(ckAccountRefusal({ status: "INVALID_APICREDENTIALS" }));
  assert(!ckAccountRefusal(CK.badNumber));
  assert(!ckAccountRefusal(CK.crash));
  assert(!ckAccountRefusal(CK.ok));
});

// ── Buying: ClubKonnect first ────────────────────────────────────────────────────────────────────────────────────

Deno.test("buy: ClubKonnect delivers → VTpass is never touched", async () => {
  const w = world({ ck: [CK.ok] });
  const out = await run(BOTH, w);
  assertEquals(out, { via: "clubkonnect", data: CK.ok });
  assertEquals(w.calls, ["claim:clubkonnect<-[]", "ck"]);
  assertEquals(w.row, ["clubkonnect"]);
  assertEquals(w.alerts, []);
});

Deno.test("buy: ClubKonnect error page + lookup 'no such order' → claimed for VTpass, then bought there", async () => {
  const w = world({ ck: [CK.crash], lookup: [{ kind: "not-found" }], pay: [VT.delivered] });
  const out = await run(BOTH, w);
  assertEquals(out.via, "vtpass");
  assertEquals((out as { state: string }).state, "delivered");
  assertEquals(w.calls, ["claim:clubkonnect<-[]", "ck", "ckLookup", "claim:vtpass<-[clubkonnect]", "vtPay"]);
  assertEquals(w.row, ["clubkonnect", "vtpass"]);
  assertEquals(w.alerts.map((a) => a.outcome), ["provider-refused", "failover"]);
});

Deno.test("buy: ClubKonnect error page but the lookup can't tell → no second provider (same as before: clean error)", async () => {
  const w = world({ ck: [CK.crash], lookup: [{ kind: "unknown" }] });
  const out = await run(BOTH, w);
  assertEquals(out, { via: "clubkonnect", data: CK.crash });
  assert(!w.calls.includes("vtPay"));
});

Deno.test("buy: ClubKonnect error page but the order DID go through → delivered, not bought again", async () => {
  const w = world({ ck: [CK.crash], lookup: [{ kind: "found-ok", q: { status: "ORDER_COMPLETED", orderid: "CK-9" } }] });
  const out = await run(BOTH, w);
  assertEquals(out.via, "clubkonnect");
  assertEquals((out as { data: CkResult }).data.orderid, "CK-9");
  assert(!w.calls.includes("vtPay"));
});

Deno.test("buy: ClubKonnect error page and the order is still processing → held for confirmation", async () => {
  const w = world({ ck: [CK.crash], lookup: [{ kind: "found-pending", q: {} }] });
  const out = await run(BOTH, w);
  assertEquals((out as { data: CkResult }).data.status, PENDING_STATUS);
  assert(!w.calls.includes("vtPay"));
});

Deno.test("buy: ClubKonnect refuses for OUR reason (wallet empty / key refused) → straight to VTpass, no lookup needed", async () => {
  for (const refusal of [CK.lowWallet, CK.badCreds]) {
    const w = world({ ck: [refusal], pay: [VT.delivered] });
    const out = await run(BOTH, w);
    assertEquals((out as { state: string }).state, "delivered");
    assertEquals(w.calls, ["claim:clubkonnect<-[]", "ck", "claim:vtpass<-[clubkonnect]", "vtPay"]);
  }
});

Deno.test("buy: ClubKonnect alone (VTpass not in play) → exactly as before: an error page is the answer, no extra lookup", async () => {
  for (const d of [CK.crash, CK.lowWallet]) {
    const w = world({ ck: [d] });
    const out = await run(["clubkonnect"], w);
    assertEquals(out, { via: "clubkonnect", data: d });
    assertEquals(w.calls, ["claim:clubkonnect<-[]", "ck"]);
    assertEquals(w.alerts, []);
  }
});

Deno.test("buy: ClubKonnect refuses the ORDER (bad number) → customer told, VTpass not tried", async () => {
  const w = world({ ck: [CK.badNumber] });
  const out = await run(BOTH, w);
  assertEquals(out, { via: "clubkonnect", data: CK.badNumber });
  assertEquals(w.calls, ["claim:clubkonnect<-[]", "ck"]);
});

Deno.test("buy: a ClubKonnect network failure is thrown as before — the retry comes back to ClubKonnect", async () => {
  const w = world({ ck: [new Error("connection reset")] });
  await assertRejects(() => run(BOTH, w), Error, "connection reset");
  assert(!w.calls.includes("vtPay"));
  assertEquals(w.row, ["clubkonnect"]);
});

// ── Buying: VTpass first ─────────────────────────────────────────────────────────────────────────────────────────

Deno.test("buy: VTpass delivers → ClubKonnect never touched", async () => {
  const w = world({ pay: [VT.delivered] });
  const out = await run(VT_FIRST, w);
  assertEquals(out, { via: "vtpass", state: "delivered", data: VT.delivered, message: "TRANSACTION SUCCESSFUL" });
  assertEquals(w.calls, ["claim:vtpass<-[]", "vtPay"]);
});

Deno.test("buy: VTpass pending → held (the app confirms later), not moved, not refunded", async () => {
  const w = world({ pay: [VT.pending] });
  const out = await run(VT_FIRST, w);
  assertEquals(out, { via: "vtpass", state: "pending", data: VT.pending, message: PENDING_STATUS });
  assertEquals(w.calls, ["claim:vtpass<-[]", "vtPay"]);
});

Deno.test("buy: VTpass says the order failed → final; the customer is refunded, nothing sent to ClubKonnect", async () => {
  const w = world({ pay: [VT.failed] });
  const out = await run(VT_FIRST, w);
  assertEquals(out, { via: "vtpass", state: "failed", data: VT.failed, message: "Transaction failed" });
  assert(!w.calls.includes("ck"));
});

Deno.test("buy: VTpass system error (HTTP 500 / 083) + requery 'no such order' → moved to ClubKonnect", async () => {
  const w = world({ pay: [VT.sysError], requery: [VT.notFound], ck: [CK.ok] });
  const out = await run(VT_FIRST, w);
  assertEquals(out, { via: "clubkonnect", data: CK.ok });
  assertEquals(w.calls, ["claim:vtpass<-[]", "vtPay", "vtRequery", "claim:clubkonnect<-[vtpass]", "ck"]);
  assertEquals(w.alerts.map((a) => a.outcome), ["provider-refused", "failover"]);
});

Deno.test("buy: VTpass error page / no answer, but the requery finds the order delivered → delivered, not bought twice", async () => {
  for (const pay of [VT.sysError, VT.page, VT.dead]) {
    const w = world({ pay: [pay], requery: [VT.delivered] });
    const out = await run(VT_FIRST, w);
    assertEquals((out as { state: string }).state, "delivered");
    assert(!w.calls.includes("ck"));
  }
});

Deno.test("buy: VTpass error page, requery says the order FAILED → final failure (refund), not held, not moved", async () => {
  const w = world({ pay: [VT.page], requery: [VT.failed] });
  const out = await run(VT_FIRST, w);
  assertEquals(out, { via: "vtpass", state: "failed", data: VT.failed, message: "Transaction failed" });
  assert(!w.calls.includes("ck"));
});

Deno.test("buy: VTpass error and the requery can't tell either → held, never moved", async () => {
  for (const rq of [VT.page, VT.dead, VT.sysError, VT.badCreds]) {
    const w = world({ pay: [VT.sysError], requery: [rq] });
    const out = await run(VT_FIRST, w);
    assertEquals((out as { state: string }).state, "pending");
    assert(!w.calls.includes("ck"));
  }
});

Deno.test("buy: a repeated request_id is never treated as 'nothing there' — the requery decides, and a contradiction holds", async () => {
  let w = world({ pay: [VT.dup], requery: [VT.delivered] });
  assertEquals(((await run(VT_FIRST, w)) as { state: string }).state, "delivered");
  w = world({ pay: [VT.dup], requery: [VT.pending] });
  assertEquals(((await run(VT_FIRST, w)) as { state: string }).state, "pending");
  w = world({ pay: [VT.dup], requery: [VT.notFound] });
  assertEquals(((await run(VT_FIRST, w)) as { state: string }).state, "pending");
  assert(!w.calls.includes("ck"));
});

Deno.test("buy: VTpass refuses our credentials / IP → moved on at once (a requery would be refused too)", async () => {
  const w = world({ pay: [VT.badCreds], ck: [CK.ok] });
  const out = await run(VT_FIRST, w);
  assertEquals(out.via, "clubkonnect");
  assertEquals(w.calls, ["claim:vtpass<-[]", "vtPay", "claim:clubkonnect<-[vtpass]", "ck"]);
});

Deno.test("buy: VTpass wallet empty + requery 'no such order' → moved to ClubKonnect", async () => {
  const w = world({ pay: [VT.lowWallet], requery: [VT.notFound], ck: [CK.ok] });
  assertEquals((await run(VT_FIRST, w)).via, "clubkonnect");
});

Deno.test("buy: VTpass 'likely duplicate' (019, a DIFFERENT order that looks like a recent one) → requery confirms nothing → ClubKonnect", async () => {
  const w = world({ pay: [VT.lookalike], requery: [VT.notFound], ck: [CK.ok] });
  const out = await run(VT_FIRST, w);
  assertEquals(out, { via: "clubkonnect", data: CK.ok });
  assertEquals(w.calls, ["claim:vtpass<-[]", "vtPay", "vtRequery", "claim:clubkonnect<-[vtpass]", "ck"]);
});

Deno.test("buy: 019 with nowhere else to go → a clear 'wait a minute' message (nothing charged), not VTpass's wording", async () => {
  const w = world({ pay: [VT.lookalike], requery: [VT.notFound] });
  const out = await buyAcrossProviders("data", ["vtpass"], deps(w));
  assertEquals((out as { state: string }).state, "failed");
  assertEquals((out as { message: string }).message, LOOKALIKE_MSG);
});

Deno.test("buy: VTpass refuses the ORDER (below minimum) → customer told, ClubKonnect not tried", async () => {
  const w = world({ pay: [VT.belowMin], requery: [VT.notFound] });
  const out = await run(VT_FIRST, w);
  assertEquals(out, { via: "vtpass", state: "failed", data: VT.belowMin, message: "Below minimum amount allowed" });
  assert(!w.calls.includes("ck"));
});

Deno.test("buy: a VTpass-only order (a VTpass data plan) that VTpass can't take → clean 'unavailable', nothing else tried", async () => {
  const w = world({ pay: [VT.lowWallet], requery: [VT.notFound] });
  const out = await buyAcrossProviders("data", ["vtpass"], deps(w));
  assertEquals(out.via, "vtpass");
  assertEquals((out as { message: string }).message, UNAVAILABLE_MSG);
  assert(!w.calls.includes("ck"));
});

// ── Claims: retries stick to where the order went ────────────────────────────────────────────────────────────────

Deno.test("claim: a retry of an order already sent to VTpass goes back to VTpass, even though ClubKonnect is now first", async () => {
  const w = world({ row: ["vtpass"], pay: [VT.dup], requery: [VT.delivered] });
  const out = await run(BOTH, w);
  assertEquals((out as { state: string }).state, "delivered");
  assertEquals(w.calls, ["claim:clubkonnect<-[]", "vtPay", "vtRequery"]);
  assertEquals(w.row, ["vtpass"]);
});

Deno.test("claim: a retry of an order already sent to ClubKonnect goes back to ClubKonnect, even when it is 'down' now", async () => {
  const w = world({ row: ["clubkonnect"], ck: [CK.ok] });
  const out = await run(["vtpass"], w);
  assertEquals(out.via, "clubkonnect");
  assertEquals(w.calls, ["claim:vtpass<-[]", "ck"]);
});

Deno.test("claim: an order already moved once is never moved back", async () => {
  const w = world({ row: ["clubkonnect", "vtpass"], pay: [VT.sysError], requery: [VT.notFound] });
  const out = await run(BOTH, w);
  assertEquals(out.via, "vtpass");
  assertEquals(w.calls, ["claim:clubkonnect<-[]", "vtPay", "vtRequery"]);
});

Deno.test("claim: can't be recorded → ClubKonnect alone (as before any of this); never VTpass, never moved", async () => {
  let w = world({ claimDown: true, ck: [CK.crash], lookup: [{ kind: "not-found" }] });
  let out = await run(BOTH, w);
  assertEquals(out, { via: "clubkonnect", data: CK.crash });
  assert(!w.calls.includes("vtPay"));
  w = world({ claimDown: true });
  out = await run(VT_FIRST, w);
  assertEquals(out, { via: "none", message: RETRY_MSG });
  assertEquals(w.calls, ["claim:vtpass<-[]"]);
});

Deno.test("claim: the move to the backup can't be recorded → not made; nothing was placed, so the customer is refunded", async () => {
  const w = world({ ck: [CK.crash], lookup: [{ kind: "not-found" }] });
  const d = deps(w);
  let n = 0;
  const claim = d.claim;
  d.claim = (p, e) => (n++ === 0 ? claim(p, e) : Promise.resolve(null));
  const out = await buyAcrossProviders("airtime", BOTH, d);
  assertEquals(out, { via: "clubkonnect", data: CK.crash });
  assert(!w.calls.includes("vtPay"));
});

Deno.test("claim: someone else moved the order meanwhile → go where it is now, don't claim over them", async () => {
  // ClubKonnect crashes; before we claim VTpass, another request already did.
  const w = world({ ck: [CK.crash], lookup: [{ kind: "not-found" }], pay: [VT.dup], requery: [VT.pending] });
  const d = deps(w);
  const claim = d.claim;
  let n = 0;
  d.claim = async (p, e) => { if (n++ === 1) w.row = ["clubkonnect", "vtpass"]; return claim(p, e); };
  const out = await buyAcrossProviders("airtime", BOTH, d);
  assertEquals((out as { state: string }).state, "pending");
  assertEquals(w.row, ["clubkonnect", "vtpass"]);
  // VTpass already had it (014) — asked, not bought again
  assertEquals(w.calls, ["claim:clubkonnect<-[]", "ck", "ckLookup", "claim:vtpass<-[clubkonnect]", "vtPay", "vtRequery"]);
});

Deno.test("claim: someone else moved the order to a provider we didn't expect → go there, don't loop", async () => {
  const w = world({ ck: [CK.crash, CK.ok], lookup: [{ kind: "not-found" }] });
  const d = deps(w);
  const claim = d.claim;
  let n = 0;
  // our view is [clubkonnect]; meanwhile the row became [vtpass, clubkonnect] (only possible if someone else wrote it)
  d.claim = async (p, e) => { if (n++ === 1) { w.row = ["vtpass", "clubkonnect"]; } return claim(p, e); };
  const out = await buyAcrossProviders("airtime", BOTH, d);
  // the row says the order lives at ClubKonnect now → the same order is re-sent there (ClubKonnect won't place it twice)
  assertEquals(out, { via: "clubkonnect", data: CK.ok });
  assertEquals(w.calls, ["claim:clubkonnect<-[]", "ck", "ckLookup", "claim:vtpass<-[clubkonnect]", "ck"]);
});

Deno.test("buy: an empty provider list places nothing", async () => {
  const w = world({});
  assertEquals(await run([], w), { via: "none", message: UNAVAILABLE_MSG });
  assertEquals(w.calls, []);
});

// ── Verify ───────────────────────────────────────────────────────────────────────────────────────────────────────

Deno.test("combineVerdicts: the last provider decides; delivered or pending anywhere wins", () => {
  const v = (provider: Provider, state: "SUCCESS" | "PENDING" | "FAILED" | "NOT_FOUND" | "UNKNOWN") => ({ provider, state, body: {} });
  assertEquals(combineVerdicts([v("clubkonnect", "NOT_FOUND"), v("vtpass", "FAILED")])?.state, "FAILED");
  assertEquals(combineVerdicts([v("clubkonnect", "UNKNOWN"), v("vtpass", "NOT_FOUND")])?.state, "NOT_FOUND");
  assertEquals(combineVerdicts([v("clubkonnect", "SUCCESS"), v("vtpass", "NOT_FOUND")])?.provider, "clubkonnect");
  assertEquals(combineVerdicts([v("clubkonnect", "PENDING"), v("vtpass", "FAILED")])?.state, "PENDING");
  assertEquals(combineVerdicts([v("vtpass", "UNKNOWN")])?.state, "UNKNOWN");
  assertEquals(combineVerdicts([]), null);
});

Deno.test("vtVerify: requery answers map to the states the app and webhooks already understand", () => {
  assertEquals(vtVerify(VT.delivered), "SUCCESS");
  assertEquals(vtVerify(VT.pending), "PENDING");
  assertEquals(vtVerify(VT.failed), "FAILED");
  assertEquals(vtVerify(VT.notFound), "NOT_FOUND");
  assertEquals(vtVerify(VT.page), "UNKNOWN");
  assertEquals(vtVerify(VT.badCreds), "UNKNOWN");
});

Deno.test("vtCostKobo: VTpass's own 'total_amount' (what it took from our wallet)", () => {
  assertEquals(vtCostKobo(VT.delivered), 9650);
  assertEquals(vtCostKobo(VT.notFound), null);
  assertEquals(vtCostKobo({ content: { transactions: { total_amount: "abc" } } }), null);
  assertEquals(vtCostKobo({ content: { transactions: { total_amount: 99_999_999 } } }), null);
});

Deno.test("vtProbeVerdict: 'no such order' = up; our account refused or an error page = down; no answer = unknown", () => {
  assertEquals(vtProbeVerdict(VT.notFound), "up");
  assertEquals(vtProbeVerdict(VT.badCreds), "down");
  assertEquals(vtProbeVerdict(VT.lowWallet), "down");
  assertEquals(vtProbeVerdict(VT.page), "down");
  assertEquals(vtProbeVerdict(VT.sysError), "down");
  assertEquals(vtProbeVerdict(VT.dead), "unknown");
  assertEquals(vtProbeVerdict({ _raw: "hmm", _http: 200 }), "unknown");
});
