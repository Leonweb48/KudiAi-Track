// Bigisub (RIF Technotronics Ltd, RC 9855543) — the third bill provider, a BACKUP for airtime and data only (owner's
// decision 2026-10-21). API v2.2.0: https://rif.africa/technotronics/api/bigisub (spec /api-specs/bigisub-v2.json).
//
// What makes it different from ClubKonnect and VTpass, and how we stay safe with it:
//   • It takes NO reference from us and has no duplicate protection. Its own transaction id comes back in the purchase
//     reply — we store it on the order's claim row (bill_provider_attempts.bg_tranx_id) and look the order up with it.
//   • When that reply is lost, its transaction history (filtered by the number, the service and the date) is the only
//     way to find the order (its docs say so). `matchHistory` picks the one order that fits; anything unclear is HELD.
//   • A requery that finds a failed order refunds Bigisub's wallet by itself.
//   • Every purchase needs our account's 4-digit transaction PIN in the body (BIGISUB_PIN), on top of the token.
// Pure helpers with the network call passed in (like vtpass.ts), unit-tested in bigisub.test.ts.

export const BG_BASE = "https://api.bigisub.ng/api/v2";
export interface BgCreds { token: string; pin: string; base?: string }
export type BgFetch = (url: string, init: RequestInit) => Promise<Response>;
export type BgResult = Record<string, unknown>;

export const bgConfigured = (c: Partial<BgCreds> | null | undefined) =>
  !!c && /^[A-Za-z0-9]{20,80}$/.test(String(c.token ?? "")) && /^\d{4}$/.test(String(c.pin ?? ""));

/**
 * Bigisub network ids as its LIVE system uses them: 1 MTN, 2 Glo, 3 Airtel, 4 9mobile. Its API docs say 2 = Airtel and
 * 3 = Glo — wrong: every live plan with network 2 is network_name "glo" (52 plans) and 3 is "airtel" (49), and a purchase
 * of network 2 + a Glo plan is accepted as matching. Following the docs swapped Airtel and Glo (2026-10-22: Airtel numbers
 * were sold Glo plans and refused as "not a valid GLO number").
 */
const NET: Record<string, number> = { MTN: 1, GLO: 2, AIRTEL: 3, "9MOBILE": 4, ETISALAT: 4, T2: 4, T2MOBILE: 4 };
const NET_NAME: Record<number, string> = { 1: "mtn", 2: "glo", 3: "airtel", 4: "9mobile" };
export const bgNetwork = (network: string): number | null => NET[String(network ?? "").trim().toUpperCase().replace(/\s+/g, "")] ?? null;

/** One Bigisub call. Never throws: no answer → { _unreachable }, a non-JSON body → { _raw, _http }. */
export async function bgCall(
  fetchFn: BgFetch, creds: BgCreds, method: "GET" | "POST", path: string, body?: Record<string, unknown>, timeoutMs = 60_000,
): Promise<BgResult> {
  const base = (creds.base || BG_BASE).replace(/\/+$/, "");
  const headers: Record<string, string> = { Authorization: `Token ${creds.token}`, Accept: "application/json" };
  if (method === "POST") headers["Content-Type"] = "application/json";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      return j && typeof j === "object" && !Array.isArray(j) ? { ...(j as BgResult), _http: res.status } : { _raw: text.slice(0, 2000), _http: res.status };
    } catch { return { _raw: text.slice(0, 2000), _http: res.status }; }
  } catch (e) {
    return { _unreachable: true, _error: (e as Error).message.slice(0, 200) };
  } finally { clearTimeout(timer); }
}

export const bgAirtimeBody = (network: number, phone: string, amount: number, pin: string) =>
  ({ network, phone_number: phone, amount: String(amount), airtime_type: "vtu", pin });
export const bgDataBody = (network: number, planId: number, phone: string, pin: string) =>
  ({ network, plan: planId, phone_number: phone, pin, ported_number: false });

// ── Cable TV, betting, Smile — Bigisub as ClubKonnect's BACKUP only (owner, 2026-10-23) ──────────────────────────────
/** Bigisub's cable plans for one provider: [{ code (= ClubKonnect's package id), amount, name }]. */
export function bgCablePlans(d: BgResult | null | undefined, provider: string): { code: string; amount: number; name: string }[] {
  const list = (Array.isArray(d?.data) ? d!.data : (data(d).plans ?? [])) as Record<string, unknown>[];
  return (Array.isArray(list) ? list : [])
    .filter((p) => String(p.cable_name ?? "").toLowerCase() === provider.toLowerCase())
    .map((p) => ({ code: String(p.variation_code ?? ""), amount: Number(p.amount) || 0, name: String(p.product_name ?? "") }))
    .filter((p) => p.code && p.amount > 0);
}
/**
 * The amount to pay Bigisub for a ClubKonnect cable package — Bigisub's purchase names the package by AMOUNT only, so the
 * package must exist there and be the ONLY one of that provider at that amount; null otherwise (no backup for it).
 */
export function bgCableAmountFor(plans: { code: string; amount: number }[], packageId: string): number | null {
  const p = plans.find((x) => x.code === packageId);
  if (!p) return null;
  return plans.filter((x) => x.amount === p.amount).length === 1 ? p.amount : null;
}
export const bgCableVerifyBody = (provider: string, cardNo: string) => ({ cable_name: provider.toLowerCase(), card_no: cardNo });
export const bgCableBody = (provider: string, cardNo: string, phone: string, amount: number, customer: string, pin: string) =>
  ({ cable_type: provider.toLowerCase(), card_no: cardNo, phone_number: phone, amount, Customer: customer, pin });

/** Our betting company codes ("product-bet-king", "prd-sporty-bet") → Bigisub biller codes ("biller-bet-king"). */
export const bgBettingBiller = (company: string): string | null => {
  const m = /^(?:product|prd)-(.+)$/i.exec(String(company ?? "").trim());
  return m ? `biller-${m[1].toLowerCase()}` : null;
};
export const bgBettingValidateBody = (biller: string, customerId: string) => ({ biller_code: biller, customer_id: customerId });
export const bgBettingFundBody = (biller: string, customerId: string, customerName: string, amount: number, validationRef: string, pin: string) =>
  ({ biller_code: biller, customer_id: customerId, customer_name: customerName, amount, ...(validationRef ? { validation_reference: validationRef } : {}), pin_code: pin });
/** A betting validation: the customer's name and the reference some billers need for funding; null = not valid / no answer. */
export function bgBettingValidated(d: BgResult | null | undefined): { name: string; ref: string } | null {
  if (!d || d.success !== true || data(d).valid === false) return null;
  const name = String(data(d).customer_name ?? "").trim();
  return name ? { name, ref: String(data(d).validation_reference ?? "").trim() } : null;
}

/** Bigisub's Smile plan id for a ClubKonnect Smile plan (both use the same plan codes, e.g. "858"); null if none. */
export function bgSmilePlanId(d: BgResult | null | undefined, ckPlan: string): number | null {
  const list = (Array.isArray(d?.data) ? d!.data : []) as Record<string, unknown>[];
  const hit = list.find((p) => String(p.variation_code ?? "") === String(ckPlan) && String(ckPlan) !== "airtime");
  const id = Number(hit?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}
export const bgSmileBody = (planId: number, phone: string, email: string, accountId: string, pin: string) =>
  ({ plan: planId, phone_number: phone, email, account_id: accountId, pin });

// ── Exam result checker PINs (WAEC, NECO, NABTEB) ────────────────────────────────────────────────────────────────
/** Our exam type codes (the app's) → Bigisub's exam code. WAEC REGISTRATION isn't sold by Bigisub. */
export const BG_EXAMS: Readonly<Record<string, string>> = { waecdirect: "WAEC", neco: "NECO", nabteb: "NABTEB" };
export const bgExamBody = (exam: string, pin: string, quantity: 1 | 2 | 5 = 1) => ({ exam, quantity, pin_code: pin });
/** The PINs from an exam purchase reply, as the receipt's card details ("PIN: …"); "" when none came back. */
export function bgExamPins(d: BgResult | null | undefined): string {
  const pins = data(d).pins;
  const list = (Array.isArray(pins) ? pins : []).map((x) => String(typeof x === "object" && x ? (x as Record<string, unknown>).pin ?? JSON.stringify(x) : x).trim()).filter(Boolean);
  return list.map((p) => `PIN: ${p}`).join(" | ");
}
/** Bigisub's exam prices (education services): { WAEC: { regular, corporate }, … }. */
export function bgExamPrices(d: BgResult | null | undefined): Record<string, { regular: number; corporate: number; name: string }> {
  const list = ((data(d).services ?? []) as Record<string, unknown>[]);
  const out: Record<string, { regular: number; corporate: number; name: string }> = {};
  for (const s of Array.isArray(list) ? list : []) {
    const id = String(s.id ?? s.type ?? "").toUpperCase();
    const regular = Number(s.regular_price), corporate = Number(s.corporate_price ?? s.regular_price);
    if (id && regular > 0) out[id] = { regular, corporate: corporate > 0 ? corporate : regular, name: String(s.name ?? id) };
  }
  return out;
}

// ── Electricity (owner, 2026-10-21) ──────────────────────────────────────────────────────────────────────────────
// Bigisub's disco codes are the same words as VTpass's serviceIDs (VT_ELECTRIC). It adds a fixed service charge to every
// payment (₦100 on 2026-10-21, `service_charge` in its providers list), charged to US — the customer pays the face amount.
export const BG_ELEC_FEE_DEFAULT = 100;
export const bgElecVerifyBody = (company: string, meterNo: string, meterType: "prepaid" | "postpaid") =>
  ({ company, meter_no: meterNo, meter_type: meterType });
export const bgElecBody = (company: string, meterNo: string, meterType: "prepaid" | "postpaid", phone: string, amount: number, name: string, pin: string) =>
  ({ company, meter_no: meterNo, meter_type: meterType, phone_number: phone, amount, Customer_name: name, pin });
/** Bigisub's discos: code → minimum amounts and its service charge. */
export function bgElecProviders(d: BgResult | null | undefined): Record<string, { minPrepaid: number; minPostpaid: number; fee: number }> {
  const list = (data(d).providers ?? []) as Record<string, unknown>[];
  const out: Record<string, { minPrepaid: number; minPostpaid: number; fee: number }> = {};
  for (const p of Array.isArray(list) ? list : []) {
    const code = String(p.code ?? "").trim();
    if (!code) continue;
    const fee = Number(p.service_charge);
    out[code] = { minPrepaid: Number(p.min_amount_prepaid) || 0, minPostpaid: Number(p.min_amount_postpaid) || 0, fee: Number.isFinite(fee) && fee >= 0 ? fee : BG_ELEC_FEE_DEFAULT };
  }
  return out;
}
/** A meter check: the name to pay with, a clear "no such meter", or no answer. */
export function bgElecCustomer(d: BgResult | null | undefined): { kind: "ok"; name: string; address: string } | { kind: "invalid" } | { kind: "unavailable" } {
  if (!d || d._unreachable || typeof d._raw === "string") return { kind: "unavailable" };
  const http = Number(d._http) || 0;
  const name = String(data(d).customer_name ?? "").trim();
  if (d.success === true && name.length >= 3 && !/invalid/i.test(name)) return { kind: "ok", name, address: String(data(d).customer_address ?? "").trim() };
  if (http === 404 || (http === 400 && !ACCOUNT_WORDS.test(`${d.message ?? ""} ${JSON.stringify(d.errors ?? "")}`))) return { kind: "invalid" };
  return { kind: "unavailable" };
}
/** The token and units in a pay reply or a requery answer ("" when none; postpaid has none by nature). */
export function bgElecToken(d: BgResult | null | undefined): { token: string; units: string } {
  const blank = (v: unknown) => { const s = String(v ?? "").trim(); return !s || /^(n\/?a|null|undefined|none)$/i.test(s) ? "" : s; };
  return { token: blank(data(d).token), units: blank(data(d).units) };
}

const data = (d: BgResult | null | undefined) => ((d?.data ?? {}) as Record<string, unknown>);
/** Bigisub's own id for an order (purchase reply `transaction_id`, history/status `tranx_id`). */
export const bgTxnId = (d: BgResult | null | undefined): string =>
  String(data(d).transaction_id ?? data(d).tranx_id ?? data(d).tran_id ?? "").trim();

export type BgState = "delivered" | "pending" | "failed";
/** An order status word from Bigisub (purchase reply, status read, requery `new_status`, history row). */
export function bgStatus(s: unknown): BgState | null {
  const v = String(s ?? "").trim().toLowerCase();
  if (v === "successful" || v === "success" || v === "delivered" || v === "completed") return "delivered";
  if (v === "failed" || v === "reversed" || v === "refunded" || v === "cancelled") return "failed";
  if (v === "processing" || v === "pending" || v === "initiated" || v === "queued") return "pending";
  return null;
}

export type BgOutcome = BgState | "account" | "order" | "unknown";
const ACCOUNT_WORDS = /pin|token|credential|unauthori[sz]ed|insufficient|balance|suspend|disabled|not verified|kyc|permission|throttl|too many/i;

/**
 * One purchase answer:
 *   delivered / pending / failed — the order exists (failed ones are refunded on Bigisub's side);
 *   account — refused for a reason that is OURS (token, PIN, wallet, rate limit): nothing was placed, another provider may take it;
 *   order   — refused because the order itself is wrong (number, plan): nothing placed, and the customer should see why;
 *   unknown — no clear answer (unreachable, error page, server error): the history decides, or the order is held.
 */
export function classifyBgPurchase(d: BgResult | null | undefined): BgOutcome {
  if (!d || d._unreachable || typeof d._raw === "string") return "unknown";
  const http = Number(d._http) || 0;
  if (http >= 500) return "unknown";
  if (http === 401 || http === 403 || http === 402 || http === 429) return "account";
  if (d.success === true) return bgStatus(data(d).status) ?? "pending";   // it exists; an unfamiliar status isn't final
  if (d.success === false && (http === 400 || http === 422 || http === 404)) {
    return ACCOUNT_WORDS.test(`${d.message ?? ""} ${JSON.stringify(d.errors ?? "")}`) ? "account" : "order";
  }
  return "unknown";
}

export const BG_UNAVAILABLE = "This service is temporarily unavailable. Please try again shortly.";
/** A short, customer-safe reason for an order Bigisub refused or failed. Account problems never reach the customer. */
export function bgMessage(d: BgResult | null | undefined, outcome: BgOutcome): string {
  if (outcome !== "order" && outcome !== "failed") return BG_UNAVAILABLE;
  const errs = d?.errors && typeof d.errors === "object" ? Object.values(d.errors as Record<string, unknown>).flat() : [];
  const first = String(errs[0] ?? data(d).message ?? d?.message ?? "").trim();
  if (!first || first.length > 140 || /<[a-z!]/i.test(first) || ACCOUNT_WORDS.test(first)) {
    return outcome === "failed" ? "The network could not complete this purchase. You have not been charged." : BG_UNAVAILABLE;
  }
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/** A status read (GET /anubis/transactions/{id}/) or requery answer as delivered / pending / failed / not-found / unknown. */
export function classifyBgLookup(d: BgResult | null | undefined): BgState | "not-found" | "unknown" {
  if (!d || d._unreachable || typeof d._raw === "string") return "unknown";
  const http = Number(d._http) || 0;
  if (http === 404) return "not-found";
  if (http >= 400 || d.success !== true) return "unknown";
  return bgStatus(data(d).new_status ?? data(d).status) ?? "unknown";
}

// ── Finding an order in the history when its purchase reply was lost ───────────────────────────────────────────────
export interface BgHistoryRow { tranx_id: string; unique_element: string; status: string; service_type: string; date_created: string; transaction_amount?: string; transaction_type?: string }
/** `phone`: the number the order went to — for electricity, the meter number (its history's unique_element). */
export interface BgOrderKey { phone: string; service: "airtime" | "data" | "exam" | "electricity" | "cable" | "betting" | "smile"; sentAtMs: number; amount?: number; planLabel?: string }
export type BgFind = { kind: "found"; tranxId: string; state: BgState | null } | { kind: "none" } | { kind: "ambiguous" } | { kind: "unknown" };

/** History timestamps are Africa/Lagos wall time with no zone ("2026-10-13T17:04:11"). */
export function lagosToMs(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(String(s ?? ""));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 1, +m[5], +m[6]) : NaN;
}
export function lagosDate(ms: number): string { return new Date(ms + 3600_000).toISOString().slice(0, 10); }
export const digits = (s: string) => String(s ?? "").replace(/\D/g, "").replace(/^234/, "0");

/**
 * The history row that is THIS order: same number, same service, created from 1 minute before we sent it to 15 minutes
 * after, and not already the stored id of another of our orders (`taken`). Exactly one → found; none → none; more → ambiguous.
 */
export function matchHistory(rows: BgHistoryRow[], key: BgOrderKey, taken: ReadonlySet<string> = new Set()): BgFind {
  const phone = digits(key.phone);
  const fits = rows.filter((r) => {
    if (taken.has(r.tranx_id)) return false;
    if (key.service === "exam") {
      // an exam order carries no phone number: same kind of service and the same amount instead
      if (!/edu|exam|result|checker|waec|neco|nabteb/i.test(`${r.service_type ?? ""} ${r.transaction_type ?? ""}`)) return false;
      if (key.amount && Math.abs(Number(r.transaction_amount) - key.amount) > 1) return false;
    } else {
      if (digits(r.unique_element) !== phone) return false;
      if (String(r.service_type ?? "").toLowerCase() !== key.service) return false;
    }
    const t = lagosToMs(r.date_created);
    return Number.isFinite(t) && t >= key.sentAtMs - 60_000 && t <= key.sentAtMs + 15 * 60_000;
  });
  if (!fits.length) return { kind: "none" };
  if (fits.length > 1) return { kind: "ambiguous" };
  return { kind: "found", tranxId: fits[0].tranx_id, state: bgStatus(fits[0].status) };
}
/** The history page's rows (an unreadable page → null). */
export function bgHistoryRows(d: BgResult | null | undefined): BgHistoryRow[] | null {
  if (!d || d._unreachable || typeof d._raw === "string" || (Number(d._http) || 0) >= 400) return null;
  const rows = (d.results ?? data(d).results) as unknown;
  return Array.isArray(rows) ? (rows as BgHistoryRow[]) : null;
}

// ── Data plans in the app's plan shape (ids tagged "bg:") ────────────────────────────────────────────────────────────
export const BG_PLAN_PREFIX = "bg:";
export const isBgPlan = (planId: unknown) => String(planId ?? "").startsWith(BG_PLAN_PREFIX);
export const bgPlanId = (planId: string) => Number(String(planId).slice(BG_PLAN_PREFIX.length));

/**
 * Bigisub's plan list → [{ plan_id: "bg:<id>", plan_name, plan_amount, retail_amount }]: plan_amount is OUR cost (the
 * corporate price when given), retail_amount Bigisub's own public price — what we sell at when the owner set no price.
 */
export function parseBgPlans(d: BgResult | null | undefined, network: number): { plan_id: string; plan_name: string; plan_amount: number; retail_amount: number }[] {
  const raw = (data(d).plans ?? d?.data ?? d?.results ?? []) as unknown;
  const list = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  return list
    // the network NAME must agree too when Bigisub sends one — a guard against its ids ever moving again
    .filter((p) => Number(p.network) === network && (p.network_name == null || String(p.network_name).toLowerCase() === NET_NAME[network])
      && p.plan_disabled !== true && p.is_active !== false)
    .map((p) => {
      const cost = Number(p.corporate_amount ?? p.plan_amount ?? p.amount) || 0;
      const size = `${p.size ?? ""}${p.plan_volume ?? ""}`.trim();
      const type = String(p.plantype ?? "").trim();
      const validity = String(p.validity ?? "").replace(/\s+/g, " ").trim();
      return {
        plan_id: BG_PLAN_PREFIX + String(p.id ?? ""),
        plan_name: [size, type && `(${type})`, validity && `- ${validity}`].filter(Boolean).join(" "),
        plan_amount: Math.round(cost * 100) / 100,
        retail_amount: Math.round(Math.max(Number(p.amount ?? p.plan_amount) || 0, cost) * 100) / 100,
      };
    })
    .filter((p) => /^bg:\d+$/.test(p.plan_id) && p.plan_amount > 0);
}

/** Bigisub health from a wallet read: up (with its balance), down (our token refused / server error), unknown (no answer). */
export function bgWalletHealth(d: BgResult | null | undefined): { health: "up" | "down" | "unknown"; balance: number | null } {
  if (!d || d._unreachable) return { health: "unknown", balance: null };
  const http = Number(d._http) || 0;
  if (typeof d._raw === "string") return { health: http >= 500 ? "down" : "unknown", balance: null };
  if (http === 401 || http === 403 || http >= 500) return { health: "down", balance: null };
  if (d.success === true) {
    const b = Number(data(d).balance);
    return { health: "up", balance: Number.isFinite(b) ? b : null };
  }
  return { health: "unknown", balance: null };
}
