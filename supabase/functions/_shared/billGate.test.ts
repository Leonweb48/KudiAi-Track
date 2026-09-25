// Run: deno test supabase/functions/_shared/billGate.test.ts
import {
  checkBillGate, couponAllowance, DEFAULT_CONFIG, faceKobo, parseRequestRef, paramsHash,
  type CouponRow, type GateConfig, type GateDeps,
} from "./billGate.ts";

function assert(cond: unknown, msg: string) { if (!cond) throw new Error("ASSERT: " + msg); }
function eq(a: unknown, b: unknown, msg: string) { if (a !== b) throw new Error(`ASSERT ${msg}: got ${String(a)}, expected ${String(b)}`); }

Deno.test("parseRequestRef accepts the real reference shapes and rejects the rest", () => {
  eq(parseRequestRef("KDT-BILL-1758812345678")?.baseRef, "KDT-BILL-1758812345678", "plain ref");
  const sub = parseRequestRef("KDT-BILL-1758812345678-MTN");
  eq(sub?.baseRef, "KDT-BILL-1758812345678", "bundle sub-order maps to its payment");
  eq(sub?.requestId, "KDT-BILL-1758812345678-MTN", "keeps the full order id");
  for (const s of ["AIR", "9MB", "GLO"]) assert(parseRequestRef(`KDT-BILL-1758812345678-${s}`), s);
  for (const bad of [null, undefined, "", "abc", "KDT-BILL-", "KDT-BILL-12", "KDT-BILL-1758812345678-XYZ", "kdt-bill-1758812345678", "KDT-BILL-1758812345678; drop", "KDT-BILL-" + "1".repeat(80)])
    assert(parseRequestRef(bad) === null, `should reject ${String(bad)}`);
});

Deno.test("faceKobo reads the amount from the request where it states one", () => {
  eq(faceKobo("airtime", { amount: "1000" }), 100000, "airtime");
  eq(faceKobo("electricity", { amount: 2500.5 }), 250050, "electricity");
  eq(faceKobo("betting", { amount: "500" }), 50000, "betting");
  eq(faceKobo("print-airtime", { value: "200", quantity: "5" }), 100000, "print airtime = value x quantity");
  eq(faceKobo("print-airtime", { value: "100", quantity: "5000" }), 1000000, "quantity is capped at 100 (100 x NGN100)");
  eq(faceKobo("data", { planId: "x" }), 0, "plan-priced items are unknown");
  eq(faceKobo("airtime", { amount: "-5" }), 0, "negative");
  eq(faceKobo("airtime", { amount: "abc" }), 0, "garbage");
});

Deno.test("paramsHash is stable, order-independent, and ignores reference / coupon fields", async () => {
  const a = await paramsHash("airtime", { phone: "0803", network: "MTN", amount: "100", requestId: "KDT-BILL-1", couponCode: "X" });
  const b = await paramsHash("airtime", { amount: "100", network: "MTN", phone: "0803", requestId: "KDT-BILL-2" });
  eq(a, b, "same goods -> same hash");
  assert(a !== await paramsHash("airtime", { phone: "0804", network: "MTN", amount: "100" }), "different phone");
  assert(a !== await paramsHash("airtime", { phone: "0803", network: "MTN", amount: "5000" }), "different amount");
  assert(a !== await paramsHash("data", { phone: "0803", network: "MTN", amount: "100" }), "different action");
});

const coupon = (o: Partial<CouponRow> = {}): CouponRow => ({ code: "C", type: "percentage", value: 100, applies_to: [], min_amount: 0, valid_from: null, valid_until: null, is_active: true, max_uses: null, used_count: 0, one_per_user: true, ...o });

Deno.test("couponAllowance mirrors the app's coupon rules", () => {
  const face = 100000;
  eq(couponAllowance(coupon(), face).full, true, "100% coupon covers everything");
  eq(couponAllowance(coupon({ value: 20 }), face).allowanceKobo, 20000, "20%");
  eq(couponAllowance(coupon({ type: "fixed", value: 300 }), face).allowanceKobo, 30000, "fixed NGN300");
  eq(couponAllowance(coupon({ type: "fixed", value: 99999 }), face).allowanceKobo, face, "fixed is capped at the order");
  eq(couponAllowance(coupon({ applies_to: ["subscriptions"] }), face).allowanceKobo, 0, "wrong scope");
  eq(couponAllowance(coupon({ applies_to: ["bills", "subscriptions"] }), face).full, true, "scope includes bills");
  eq(couponAllowance(coupon({ min_amount: 5000 }), face).allowanceKobo, 0, "below the minimum order");
  eq(couponAllowance(coupon({ is_active: false }), face).allowanceKobo, 0, "inactive");
  eq(couponAllowance(coupon({ valid_until: "2020-01-01T00:00:00Z" }), face).allowanceKobo, 0, "expired");
  eq(couponAllowance(coupon({ valid_from: "2999-01-01T00:00:00Z" }), face).allowanceKobo, 0, "not yet valid");
  eq(couponAllowance(coupon({ max_uses: 5, used_count: 5 }), face).allowanceKobo, 0, "used up");
  eq(couponAllowance(null, face).allowanceKobo, 0, "unknown code");
  eq(couponAllowance(coupon(), 0).allowanceKobo, 0, "no known face value");
});

// ── the gate, with fake dependencies ───────────────────────────────────────────
interface Fake { walletPaid?: number; paystack?: { success: boolean; amountKobo: number; isBill: boolean } | null; coupon?: CouponRow | null; claim?: Record<string, unknown>; claimError?: string; config?: Partial<GateConfig>; configThrows?: boolean }
function deps(f: Fake) {
  const calls = { rpc: [] as [string, Record<string, unknown>][], logs: [] as Record<string, unknown>[], paystack: 0 };
  const d: GateDeps = {
    config: () => f.configThrows ? Promise.reject(new Error("x")) : Promise.resolve({ ...DEFAULT_CONFIG, ...(f.config ?? {}) }),
    rpc: (name, args) => {
      calls.rpc.push([name, args]);
      if (name === "bill_gate_wallet_paid") return Promise.resolve({ data: f.walletPaid ?? 0, error: null });
      if (f.claimError) return Promise.resolve({ data: null, error: { message: f.claimError } });
      return Promise.resolve({ data: f.claim ?? { ok: true, verdict: "ok" }, error: null });
    },
    coupon: () => Promise.resolve(f.coupon ?? null),
    paystack: () => { calls.paystack++; return Promise.resolve(f.paystack ?? null); },
    log: (row) => { calls.logs.push(row); return Promise.resolve(); },
  };
  return { d, calls };
}
const U = { id: "user-1" };
const body = { requestId: "KDT-BILL-1758812345678", phone: "0803", network: "MTN", amount: "1000" };

Deno.test("gate: lookups and other non-purchase actions are never gated", async () => {
  const { d, calls } = deps({});
  for (const a of ["verify", "electricity-verify", "data-plans", "bill-success-email", "electricity-query"]) {
    const r = await checkBillGate(d, U, a, {});
    assert(r.ok, a);
  }
  eq(calls.rpc.length, 0, "no database work for non-purchases");
});

Deno.test("gate: a wallet-paid order passes and the Paystack API is not even asked", async () => {
  const { d, calls } = deps({ walletPaid: 100000 });
  const r = await checkBillGate(d, U, "airtime", body);
  assert(r.ok, "wallet proof");
  eq(calls.paystack, 0, "no paystack call");
  const claim = calls.rpc.find((c) => c[0] === "bill_gate_claim")!;
  eq(claim[1].p_paid_kobo, 100000, "paid amount from the wallet ledger");
  eq(claim[1].p_base_ref, "KDT-BILL-1758812345678", "base ref");
  eq(claim[1].p_face_kobo, 100000, "face value");
});

Deno.test("gate: a Paystack-verified order passes; an unverified/other-purpose charge does not", async () => {
  let r = await checkBillGate(deps({ paystack: { success: true, amountKobo: 100000, isBill: true } }).d, U, "airtime", body);
  assert(r.ok, "verified paystack charge");
  r = await checkBillGate(deps({ paystack: { success: true, amountKobo: 100000, isBill: false } }).d, U, "airtime", body);
  assert(!r.ok && r.reason === "no_payment", "a subscription/other charge is not proof for a bill");
  r = await checkBillGate(deps({ paystack: { success: false, amountKobo: 0, isBill: true } }).d, U, "airtime", body);
  assert(!r.ok && r.reason === "no_payment", "abandoned/failed charge");
  r = await checkBillGate(deps({ paystack: null }).d, U, "airtime", body);
  assert(!r.ok && r.reason === "no_payment", "paystack could not verify it");
});

Deno.test("gate: NO payment at all is refused, and the refusal is logged (the free-airtime exploit)", async () => {
  const { d, calls } = deps({});
  const r = await checkBillGate(d, U, "airtime", body);
  assert(!r.ok && r.reason === "no_payment", "refused");
  assert(calls.logs.some((l) => l.reason === "no_payment" && l.user_id === "user-1" && l.enforced === true), "logged");
  assert(!calls.rpc.some((c) => c[0] === "bill_gate_claim"), "nothing was claimed");
});

Deno.test("gate: a request with no valid reference is refused", async () => {
  for (const requestId of [undefined, "", "not-a-ref", "KDT-BILL-1; drop table"]) {
    const r = await checkBillGate(deps({ walletPaid: 1e9 }).d, U, "airtime", { ...body, requestId });
    assert(!r.ok && r.reason === "bad_ref", String(requestId));
  }
});

Deno.test("gate: a free order needs a coupon that covers all of it", async () => {
  const free = { ...body, couponCode: "free100" };
  let r = await checkBillGate(deps({ coupon: coupon() }).d, U, "airtime", free);
  assert(r.ok, "100% coupon is the payment");
  r = await checkBillGate(deps({ coupon: coupon({ value: 20 }) }).d, U, "airtime", free);
  assert(!r.ok && r.reason === "no_payment", "a 20% coupon is not a payment");
  r = await checkBillGate(deps({ coupon: null }).d, U, "airtime", free);
  assert(!r.ok && r.reason === "no_payment", "unknown coupon code");
  r = await checkBillGate(deps({ coupon: coupon({ is_active: false }) }).d, U, "airtime", free);
  assert(!r.ok, "inactive coupon");
  const { d, calls } = deps({ coupon: coupon() });
  await checkBillGate(d, U, "airtime", free);
  const claim = calls.rpc.find((c) => c[0] === "bill_gate_claim")!;
  eq(claim[1].p_coupon, "FREE100", "coupon code upper-cased for the once-per-user check");
  eq(claim[1].p_paid_kobo, 0, "paid nothing");
});

Deno.test("gate: a partial coupon lowers the floor by exactly its discount (and only when the wallet/Paystack paid)", async () => {
  const { d, calls } = deps({ walletPaid: 80000, coupon: coupon({ value: 20 }) });
  await checkBillGate(d, U, "airtime", { ...body, couponCode: "TWENTY" });
  const claim = calls.rpc.find((c) => c[0] === "bill_gate_claim")!;
  eq(claim[1].p_allowance_kobo, 20000, "20% of NGN1,000");
  eq(claim[1].p_coupon, null, "a partial coupon is not recorded as a free order");
});

Deno.test("gate: the database's verdict is honoured (enforce blocks, log mode only records)", async () => {
  const under = { ok: false, reason: "underpaid", required_kobo: 60000 };
  let r = await checkBillGate(deps({ walletPaid: 100, claim: under, config: { floorMode: "enforce" } }).d, U, "airtime", body);
  assert(!r.ok && r.reason === "underpaid", "enforce -> refused");
  const { d, calls } = deps({ walletPaid: 100, claim: { ok: true, verdict: "would_block_floor" } });
  r = await checkBillGate(d, U, "airtime", body);
  assert(r.ok && r.verdict === "would_block_floor", "log mode -> passes with the flag");
  eq(calls.rpc.find((c) => c[0] === "bill_gate_claim")![1].p_enforce_floor, false, "floor is log-only by default");
  r = await checkBillGate(deps({ walletPaid: 100000, claim: { ok: false, reason: "ref_reused" } }).d, U, "airtime", body);
  assert(!r.ok && r.reason === "ref_reused", "a reused payment is refused");
  r = await checkBillGate(deps({ walletPaid: 100000, claim: { ok: false, reason: "ref_owned_by_other" } }).d, U, "airtime", body);
  assert(!r.ok && r.reason === "ref_owned_by_other", "someone else's payment is refused");
});

Deno.test("gate: mode 'off' disables it, mode 'log' never blocks", async () => {
  let r = await checkBillGate(deps({ config: { mode: "off" } }).d, U, "airtime", body);
  assert(r.ok && r.verdict === "off", "off");
  const { d, calls } = deps({ config: { mode: "log" } });
  r = await checkBillGate(d, U, "airtime", body);
  assert(r.ok && r.verdict === "log_no_payment", "log mode lets an unpaid order through but records it");
  assert(calls.logs.some((l) => l.reason === "no_payment" && l.enforced === false), "and logs it as not enforced");
});

Deno.test("gate: an outage of the gate itself is a retryable refusal in enforce mode, never a free purchase", async () => {
  const { d, calls } = deps({ walletPaid: 100000, claimError: "db down" });
  const r = await checkBillGate(d, U, "airtime", body);
  assert(!r.ok && r.reason === "gate_error", "refused");
  // the message must be worded so the app treats it as a temporary connection problem and retries the same order
  assert(/connection/i.test((r as { message: string }).message), "reads as a connection problem");
  assert(calls.logs.some((l) => l.reason === "gate_error"), "logged");
  const r2 = await checkBillGate(deps({ configThrows: true, walletPaid: 100000 }).d, U, "airtime", body);
  assert(r2.ok, "an unreadable config falls back to the safe defaults and still works");
});

Deno.test("gate: if its database objects are missing (deployed before the migration) purchases are NOT refused", async () => {
  const missing = { data: null, error: { message: "Could not find the function public.bill_gate_wallet_paid(p_ref, p_user) in the schema cache" } };
  const base = deps({});
  const d: GateDeps = { ...base.d, rpc: () => Promise.resolve(missing) };
  const r = await checkBillGate(d, U, "airtime", body);
  assert(r.ok && r.verdict === "gate_unavailable", "allowed while the migration catches up");
  // ...but any OTHER database error is a retryable refusal, not a free pass
  const d2: GateDeps = { ...base.d, rpc: () => Promise.resolve({ data: null, error: { message: "connection reset by peer" } }) };
  const r2 = await checkBillGate(d2, U, "airtime", body);
  assert(!r2.ok && r2.reason === "gate_error", "other errors refuse and retry");
});

Deno.test("refusal messages never look like network errors the app would retry blindly (except the outage one)", () => {
  const NET = /network|timeout|timed ?out|failed to fetch|failed to send a request|load failed|connection|aborted|ECONNRESET|socket|gateway|502|503|504|non-2xx|FunctionsFetchError|FunctionsRelayError|edge function/i;
  // exercised through the gate so the real strings are used
  return (async () => {
    for (const [reason, f] of [
      ["no_payment", deps({})], ["ref_reused", deps({ walletPaid: 1, claim: { ok: false, reason: "ref_reused" } })],
      ["underpaid", deps({ walletPaid: 1, claim: { ok: false, reason: "underpaid" }, config: { floorMode: "enforce" } })],
    ] as [string, ReturnType<typeof deps>][]) {
      const r = await checkBillGate(f.d, U, "airtime", body);
      assert(!r.ok, reason);
      assert(!NET.test((r as { message: string }).message), `${reason} message must not trigger the app's network retry: ${(r as { message: string }).message}`);
    }
  })();
});
