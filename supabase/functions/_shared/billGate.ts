// Server-side gate for bill purchases (2026-09-25 security work).
//
// THE PROBLEM: the app decided what a bill costs, took the payment, and then asked the `clubkonnect` function to buy the
// service — and the function trusted the app. Anyone with a login could call the purchase actions directly (no payment at
// all) or "pay" a token amount. The gate below makes the SERVER confirm that an order is actually paid before the provider
// wallet is spent:
//
//   1. proof of payment — a wallet debit (bill_spend) for this order, OR a Paystack charge for it, verified with Paystack
//      itself, OR a coupon that covers the whole order and has not been used up;
//   2. one payment ↔ one order — the same payment cannot be reused for a different order or by another user;
//   3. a price floor — the payment must cover ~80 % of the order's face value (less any valid coupon and a small tolerance).
//      Ships in LOG mode: it records what it would block, and only enforces once real traffic shows no false positives.
//
// Callers with the service-role key (webhooks) are not gated here; they run their own checks.

export const PURCHASE_ACTIONS = new Set([
  "airtime", "data", "cable", "electricity", "betting", "waec", "jamb", "spectranet", "smile", "print-airtime", "print-data",
]);

export type GateMode = "off" | "log" | "enforce";
export interface GateConfig { mode: GateMode; floorMode: GateMode; tolerance_kobo: number; floor_pct: number }
export const DEFAULT_CONFIG: GateConfig = { mode: "enforce", floorMode: "log", tolerance_kobo: 20_000, floor_pct: 80 };

export type Body = Record<string, unknown>;

// "KDT-BILL-1758812345678" (one payment) or "KDT-BILL-1758812345678-MTN" (one of the four sub-orders of an airtime bundle)
export function parseRequestRef(requestId: unknown): { requestId: string; baseRef: string } | null {
  const id = String(requestId ?? "").trim();
  if (!id || id.length > 64) return null;
  const m = /^(KDT-BILL-[A-Za-z0-9]{6,40})(?:-(?:MTN|AIR|9MB|GLO))?$/.exec(id);
  return m ? { requestId: id, baseRef: m[1] } : null;
}

const posNumber = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };

// The order's face value in kobo where the request itself states it; 0 = "unknown" (plan-priced items are only proof-checked).
export function faceKobo(action: string, body: Body): number {
  if (action === "airtime" || action === "electricity" || action === "betting") return Math.round(posNumber(body.amount) * 100);
  if (action === "print-airtime") return Math.round(posNumber(body.value) * Math.min(posNumber(body.quantity), 100) * 100);
  return 0;
}

// Canonical description of WHAT is being bought — the same payment may be retried for it, but not reused for something else.
export async function paramsHash(action: string, body: Body): Promise<string> {
  const skip = new Set(["action", "requestId", "couponCode"]);
  const keys = Object.keys(body).filter((k) => !skip.has(k)).sort();
  const canon = action + "|" + keys.map((k) => `${k}=${String(body[k] ?? "")}`).join("&");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canon));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface CouponRow {
  code: string; type: "percentage" | "fixed"; value: number; applies_to: string[] | null; min_amount: number | null;
  valid_from: string | null; valid_until: string | null; is_active: boolean; max_uses: number | null; used_count: number | null;
  one_per_user: boolean | null;
}

// Mirrors src/utils/billCalc.js calcCouponDiscount, plus the validity checks the app leaves to check_coupon.
export function couponAllowance(c: CouponRow | null, faceKobo: number, now = new Date()): { allowanceKobo: number; full: boolean } {
  if (!c || !c.is_active || faceKobo <= 0) return { allowanceKobo: 0, full: false };
  if (c.valid_from && new Date(c.valid_from) > now) return { allowanceKobo: 0, full: false };
  if (c.valid_until && new Date(c.valid_until) < now) return { allowanceKobo: 0, full: false };
  if (c.max_uses != null && (c.used_count ?? 0) >= c.max_uses) return { allowanceKobo: 0, full: false };
  const scope = c.applies_to ?? [];
  if (scope.length > 0 && !scope.includes("bills")) return { allowanceKobo: 0, full: false };
  if (faceKobo < Math.round((c.min_amount ?? 0) * 100)) return { allowanceKobo: 0, full: false };
  const raw = c.type === "percentage" ? Math.round(faceKobo * Number(c.value) / 100) : Math.round(Number(c.value) * 100);
  const allowanceKobo = Math.min(Math.max(raw, 0), faceKobo);
  return { allowanceKobo, full: allowanceKobo >= faceKobo };
}

export interface GateDeps {
  config(): Promise<GateConfig>;
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
  coupon(code: string): Promise<CouponRow | null>;
  // Paystack's own answer for a reference: null when it cannot be verified at all
  paystack(reference: string): Promise<{ success: boolean; amountKobo: number; isBill: boolean } | null>;
  log(row: Record<string, unknown>): Promise<void>;
}

export type GateResult = { ok: true; verdict: string } | { ok: false; reason: string; message: string };

const MSG: Record<string, string> = {
  bad_ref: "This order has no valid reference. Please start the purchase again.",
  no_payment: "We could not match a payment to this order, so nothing was bought. If you were charged, it is refunded automatically.",
  ref_owned_by_other: "This payment belongs to a different order, so nothing was bought.",
  ref_reused: "This payment was already used for a different order, so nothing was bought.",
  coupon_used: "This coupon has already been used, so nothing was bought.",
  underpaid: "The amount paid does not cover this order, so nothing was bought. If you were charged, it is refunded automatically.",
  // (worded to be treated as a temporary connection problem by the app, which then retries the same order automatically)
  gate_error: "A temporary connection problem stopped us confirming this order. Please try again.",
};
// The gate's own database objects are not there yet (this function deployed before its migration ran). That is a deployment
// ordering artefact, not something a caller can cause, and it must not turn every legitimate purchase into a refusal.
const isMissingObject = (e: { message: string } | null | undefined) =>
  !!e && /could not find the function|does not exist|PGRST202|42883|schema cache/i.test(e.message);
const fail = (reason: string): GateResult => ({ ok: false, reason, message: MSG[reason] ?? MSG.gate_error });

export async function checkBillGate(deps: GateDeps, user: { id: string }, action: string, body: Body): Promise<GateResult> {
  if (!PURCHASE_ACTIONS.has(action)) return { ok: true, verdict: "not_a_purchase" };
  let cfg: GateConfig;
  try { cfg = await deps.config(); } catch { cfg = DEFAULT_CONFIG; }
  if (cfg.mode === "off") return { ok: true, verdict: "off" };
  const enforce = cfg.mode === "enforce";

  const base = { user_id: user.id, cat: action };
  const ref = parseRequestRef(body.requestId);
  if (!ref) { await deps.log({ ...base, request_id: String(body.requestId ?? "").slice(0, 64), reason: "bad_ref", enforced: enforce }); return enforce ? fail("bad_ref") : { ok: true, verdict: "log_bad_ref" }; }

  const face = faceKobo(action, body);
  const couponCode = typeof body.couponCode === "string" ? body.couponCode.trim().slice(0, 40) : "";

  try {
    // 1. proof of payment
    let paid = 0, source = "";
    const w = await deps.rpc("bill_gate_wallet_paid", { p_user: user.id, p_ref: ref.baseRef });
    if (w.error) {
      if (isMissingObject(w.error)) return { ok: true, verdict: "gate_unavailable" };
      throw new Error(w.error.message);
    }
    if (Number(w.data) > 0) { paid = Number(w.data); source = "wallet"; }
    if (!source) {
      const ps = await deps.paystack(ref.baseRef);
      if (ps && ps.success && ps.isBill && ps.amountKobo > 0) { paid = ps.amountKobo; source = "paystack"; }
    }
    let coupon: CouponRow | null = null;
    let allowance = 0;
    if (couponCode) {
      coupon = await deps.coupon(couponCode);
      allowance = couponAllowance(coupon, face).allowanceKobo;
      // a coupon that covers the whole order is itself the "payment"
      if (!source && coupon && face > 0 && couponAllowance(coupon, face).full) { paid = 0; source = "coupon"; }
    }
    if (!source) { await deps.log({ ...base, request_id: ref.requestId, reason: "no_payment", face_kobo: face, enforced: enforce }); return enforce ? fail("no_payment") : { ok: true, verdict: "log_no_payment" }; }

    // 2 + 3. bind payment ↔ order, and check the price floor
    const c = await deps.rpc("bill_gate_claim", {
      p_request_id: ref.requestId, p_base_ref: ref.baseRef, p_user: user.id, p_cat: action, p_hash: await paramsHash(action, body),
      p_face_kobo: face, p_paid_kobo: paid, p_allowance_kobo: allowance, p_coupon: source === "coupon" ? couponCode.toUpperCase() : null,
      p_coupon_one_per_user: coupon?.one_per_user ?? true, p_floor_pct: cfg.floor_pct, p_tolerance_kobo: cfg.tolerance_kobo,
      p_enforce_floor: cfg.floorMode === "enforce",
    });
    if (c.error) {
      if (isMissingObject(c.error)) return { ok: true, verdict: "gate_unavailable" };
      throw new Error(c.error.message);
    }
    const r = c.data as { ok: boolean; reason?: string; verdict?: string; required_kobo?: number };
    if (!r.ok) {
      await deps.log({ ...base, request_id: ref.requestId, reason: r.reason, face_kobo: face, paid_kobo: paid, required_kobo: r.required_kobo ?? null, enforced: enforce });
      return enforce ? fail(r.reason ?? "gate_error") : { ok: true, verdict: `log_${r.reason}` };
    }
    return { ok: true, verdict: r.verdict ?? "ok" };
  } catch (e) {
    // The gate itself failed (database / Paystack unreachable). Never turn an outage into "free"—or into a lost sale:
    // enforce mode refuses with a retry message; the client retries the same order safely (same reference, same params).
    await deps.log({ ...base, request_id: ref.requestId, reason: "gate_error", detail: String((e as Error).message ?? e).slice(0, 200), enforced: enforce }).catch(() => {});
    return enforce ? fail("gate_error") : { ok: true, verdict: "log_gate_error" };
  }
}
