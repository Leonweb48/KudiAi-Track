// Which bill provider serves an order — ClubKonnect or VTpass — and moving an order to the other one when a provider
// is down. The admin picks the main provider (platform_config.bill_provider) and whether an order may move to the other
// one automatically (bill_provider_failover). Pure decision logic with its dependencies passed in (like ckRoute.ts), so
// every branch is unit-tested in billProvider.test.ts; clubkonnect/index.ts supplies the real calls.
//
// The rules that keep a customer from being charged twice or refunded for something they received:
//   1. Every order is CLAIMED for a provider (bill_provider_claim, one row per order reference) BEFORE it is sent there.
//      A retry of the same order — the app's own retry, a webhook, a second tap — always goes back to the provider the
//      order was last sent to (which recognises the reference and won't place it twice), never to a new one.
//   2. An order only moves to the other provider when the first one has CONFIRMED it holds no order for that reference:
//      ClubKonnect's lookup says "no such order" after an error page, or a provider refused it for an account-level reason
//      (our wallet is empty, our credentials were refused …), which places nothing.
//   3. Anything that can't be confirmed either way is HELD for confirmation (the app's existing "confirming your order"
//      path), never refunded and never sent elsewhere.
//   4. VTpass only ever serves customers with LIVE keys — its sandbox is play money (see vtUsable).
// The `verify` action uses the same claim row to know which provider(s) to ask about an order.

import { isProviderCrash, PENDING_STATUS, type CkResult, type Health, type Lookup } from "./ckRoute.ts";
import { vtCode, vtTxn, vtTxnStatus, type VtResult } from "./vtpass.ts";

export type Provider = "clubkonnect" | "vtpass";
export const PROVIDERS: readonly Provider[] = ["clubkonnect", "vtpass"];
export const PROVIDER_LABEL: Readonly<Record<Provider, string>> = { clubkonnect: "ClubKonnect", vtpass: "VTpass" };

/**
 * Services VTpass can take. Betting, JAMB, Spectranet and printed PINs stay on ClubKonnect (not on VTpass's access
 * form), as do Showmax (cable) — each purchase handler checks the specific product too.
 */
export const VT_SERVICES: ReadonlySet<string> = new Set(["airtime", "data", "cable", "electricity", "waec", "smile"]);

export interface ProviderConfig { primary: Provider; failover: boolean }
export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = { primary: "clubkonnect", failover: true };

/** platform_config rows → config. Anything unrecognised keeps the default (ClubKonnect, failover on). */
export function parseProviderConfig(m: Record<string, string | null | undefined>): ProviderConfig {
  const p = String(m.bill_provider ?? "").trim().toLowerCase();
  const f = String(m.bill_provider_failover ?? "").trim().toLowerCase();
  return {
    primary: p === "vtpass" ? "vtpass" : "clubkonnect",
    failover: f === "false" ? false : DEFAULT_PROVIDER_CONFIG.failover,
  };
}

export interface ProviderState {
  vtUsable: boolean;                    // VTpass keys present AND live (never the sandbox)
  health: Record<Provider, Health>;     // "down" = known broken right now; "unknown" never counts against a provider
}

/**
 * The providers to try for a NEW order of this service, in order. The main provider comes first unless it is known to
 * be down and the other one isn't — then the order goes straight to the other one (no point waiting for an error page).
 */
export function providerOrder(svc: string, cfg: ProviderConfig, st: ProviderState): Provider[] {
  const vtOk = st.vtUsable && VT_SERVICES.has(svc);
  const primary: Provider = cfg.primary === "vtpass" && vtOk ? "vtpass" : "clubkonnect";
  const other: Provider | null = primary === "vtpass" ? "clubkonnect" : vtOk ? "vtpass" : null;
  if (!other || !cfg.failover) return [primary];
  if (st.health[primary] === "down" && st.health[other] !== "down") return [other];
  return [primary, other];
}

// ── How to read each provider's answer ──────────────────────────────────────────────────────────────────────────

export type VtOutcome = "delivered" | "pending" | "failed" | "not-found" | "duplicate" | "refused" | "unknown";

// Codes where VTpass refused the request up front for a reason that is OURS, not the customer's (so the other provider
// may well succeed): wallet empty (018), account locked/suspended/API off/inactive (021-024), IP not whitelisted (027),
// product not enabled for us (028), biller unreachable (030), service suspended/inactive (034/035), not processed (091),
// bad request id (015/085 on a purchase), bad credentials (087), and "likely duplicate" (019): VTpass refuses an order
// that looks like a recent one (same number + amount within a short window — seen in the sandbox proof, 2026-09-28).
// Our genuine repeats reuse the request_id and get 014, so a 019 is always a DIFFERENT order that merely looks alike —
// safe to send to the other provider once VTpass confirms it holds nothing for it.
export const VT_PROVIDER_CODES: ReadonlySet<string> = new Set(["015", "018", "019", "021", "022", "023", "024", "027", "028", "030", "034", "035", "085", "087", "091"]);
// Codes where the ORDER itself is wrong — the other provider would refuse it too: no such plan/product (010, 012), bad
// arguments (011), amount or quantity out of range (013, 017, 031, 032).
export const VT_CUSTOMER_CODES: ReadonlySet<string> = new Set(["010", "011", "012", "013", "017", "031", "032"]);
// Refused at VTpass's front door — our account or credentials — before any order can exist. A lookup would be refused
// the same way, so these move on without one.
export const VT_AUTH_CODES: ReadonlySet<string> = new Set(["021", "022", "023", "024", "027", "087"]);

/**
 * One VTpass answer (to /pay or /requery). Verified against VTpass's sandbox (vtpass-probe, 2026-09-28): 000 + status
 * delivered / pending, 016 + failed, 014 for a repeated request_id, 015 for a request_id it has no order for, and an
 * HTTP 500 with code 083 for an internal error that created no order.
 */
export function classifyVt(d: VtResult | null | undefined): VtOutcome {
  if (!d || d._unreachable || typeof d._raw === "string") return "unknown";
  const code = vtCode(d), st = vtTxnStatus(d);
  if (code === "000") {
    if (st === "delivered" || st === "successful" || st === "success") return "delivered";
    if (st === "failed" || st === "reversed") return "failed";
    return "pending";   // pending / initiated / processing / anything new: it exists and isn't final
  }
  if (code === "099" || code === "089") return "pending";
  if (code === "016" || code === "040") return "failed";
  if (code === "014") return "duplicate";
  if (code === "015") return "not-found";
  if (VT_PROVIDER_CODES.has(code) || VT_CUSTOMER_CODES.has(code)) return "refused";
  return "unknown";   // 083 system error and anything unrecognised: ask /requery
}

/** A VTpass refusal that is about the ORDER (the customer should see it and the other provider would refuse it too). */
export const vtCustomerRefusal = (d: VtResult | null | undefined) => VT_CUSTOMER_CODES.has(vtCode(d));

// ClubKonnect refusing for a reason that is ours (its answer is a real JSON refusal, so nothing was placed).
const CK_ACCOUNT = /INSUFFICIENT|LOW_WALLET|LOW WALLET|LOW BALANCE|NO BALANCE|INVALID_CREDENTIALS|INVALID_APICREDENTIALS|MISSING_CREDENTIALS|INVALID_KEY|INVALID KEY|INVALID USER|UNAUTHORIZED|SERVICE UNAVAILABLE|SERVICE_UNAVAILABLE/;
export function ckAccountRefusal(d: CkResult | null | undefined): boolean {
  if (!d || typeof d._raw === "string") return false;
  return CK_ACCOUNT.test(String(d.status ?? d.Status ?? "").toUpperCase());
}

/** A short, customer-safe message for a VTpass answer. Account-level problems never reach the customer by name. */
export const UNAVAILABLE_MSG = "This service is temporarily unavailable. Please try again shortly.";
export const LOOKALIKE_MSG = "A purchase just like this one was made to the same number moments ago, so this one was stopped in case it was a repeat. You have not been charged — please wait a minute and try again.";
export function vtMessage(d: VtResult | null | undefined): string {
  if (vtCode(d) === "019") return LOOKALIKE_MSG;
  if (!vtCustomerRefusal(d) && vtCode(d) !== "016" && vtCode(d) !== "040") return UNAVAILABLE_MSG;
  const s = String(d?.response_description ?? "").trim();
  if (!s || s.length > 120 || /<[a-z!]/i.test(s)) return UNAVAILABLE_MSG;
  return s.charAt(0) + s.slice(1).toLowerCase();
}

// ── Buying across providers ─────────────────────────────────────────────────────────────────────────────────────

export type BuyOutcome =
  | { via: "clubkonnect"; data: CkResult }                                                    // handled exactly as before
  | { via: "vtpass"; state: "delivered" | "pending" | "failed"; data: VtResult; message: string }
  | { via: "none"; message: string };                                                         // nothing sent anywhere

export type SwitchEvent =
  | { svc: string; outcome: "failover"; from: Provider; to: Provider; detail: string }
  | { svc: string; outcome: "provider-refused"; provider: Provider; detail: string };

export interface BuyDeps {
  /**
   * Claim the order for `provider`, believing it has so far been sent to `expect`. Returns every provider the order has
   * been claimed for, in order (the last one is where it lives now), or null when the claim can't be recorded.
   */
  claim: (provider: Provider, expect: Provider[]) => Promise<Provider[] | null>;
  ck: () => Promise<CkResult>;            // the ClubKonnect purchase (ckBuy); a network failure throws, as before
  ckLookup: () => Promise<Lookup>;        // never throws
  vtPay: () => Promise<VtResult>;         // never throws (vtCall)
  vtRequery: () => Promise<VtResult>;     // never throws
  isOk: (d: CkResult) => boolean;
  alert: (e: SwitchEvent) => void;        // fire-and-forget
}

// "The order definitely isn't there and it's the provider's problem" → the next provider may take it.
type Attempt = { settled: BuyOutcome } | { moveOn: BuyOutcome; detail: string };

export const RETRY_MSG = "A temporary connection problem stopped us placing this order. Please try again.";
const held = (data: VtResult): BuyOutcome => ({ via: "vtpass", state: "pending", data, message: PENDING_STATUS });

// `canMove`: is there another provider this order could still go to? When there isn't, ClubKonnect's answer is handled
// exactly as it was before the provider switch existed (no extra lookup).
async function tryClubKonnect(deps: BuyDeps, canMove: boolean): Promise<Attempt> {
  const d = await deps.ck();   // throws on a network failure: the app/webhook retry the SAME order, which stays here
  const out: BuyOutcome = { via: "clubkonnect", data: d };
  if (deps.isOk(d) || d._pending || !canMove) return { settled: out };
  if (isProviderCrash(d)) {
    const lk = await deps.ckLookup();
    if (lk.kind === "found-ok") return { settled: { via: "clubkonnect", data: { ...lk.q, _via: "lookup-recovered" } } };
    if (lk.kind === "found-pending") return { settled: { via: "clubkonnect", data: { status: PENDING_STATUS, _pending: true } } };
    if (lk.kind === "not-found") return { moveOn: out, detail: "error page, no order created" };
    return { settled: out };   // can't confirm there is no order → never send it elsewhere (same as before: clean error)
  }
  if (ckAccountRefusal(d)) return { moveOn: out, detail: String(d.status ?? d.Status ?? "refused") };
  return { settled: out };     // a refusal about the order itself (bad number, …) — the other provider would refuse it too
}

async function tryVtpass(deps: BuyDeps): Promise<Attempt> {
  const pay = await deps.vtPay();
  const p = classifyVt(pay);
  if (p === "delivered") return { settled: { via: "vtpass", state: "delivered", data: pay, message: String(pay.response_description ?? "TRANSACTION SUCCESSFUL") } };
  if (p === "pending") return { settled: held(pay) };
  if (p === "failed") return { settled: { via: "vtpass", state: "failed", data: pay, message: vtMessage(pay) } };
  const detail = () => vtCode(pay) ? `code ${vtCode(pay)}${pay.response_description ? ` ${String(pay.response_description).slice(0, 60)}` : ""}` : pay._unreachable ? "unreachable" : "error page";
  if (VT_AUTH_CODES.has(vtCode(pay))) return { moveOn: { via: "vtpass", state: "failed", data: pay, message: UNAVAILABLE_MSG }, detail: detail() };

  // Anything else: VTpass's own record of this request_id is the ground truth.
  const rq = await deps.vtRequery();
  const r = classifyVt(rq);
  if (r === "delivered") return { settled: { via: "vtpass", state: "delivered", data: rq, message: String(rq.response_description ?? "TRANSACTION SUCCESSFUL") } };
  if (r === "pending") return { settled: held(rq) };
  if (r === "failed") return { settled: { via: "vtpass", state: "failed", data: rq, message: vtMessage(rq) } };
  // A requery that repeats the purchase's own refusal (seen for 019 in the sandbox: pay 019 → requery 019) is VTpass's
  // record of a REFUSED request — no order exists, same as "no such order".
  const refusalOnRecord = r === "refused" && !!vtCode(pay) && vtCode(rq) === vtCode(pay);
  if ((r !== "not-found" && !refusalOnRecord) || p === "duplicate") return { settled: held(r === "not-found" ? pay : rq) };   // can't confirm → hold

  // VTpass confirms it holds no order for this reference.
  const failed: BuyOutcome = { via: "vtpass", state: "failed", data: pay, message: vtMessage(pay) };
  if (vtCustomerRefusal(pay)) return { settled: failed };
  return { moveOn: failed, detail: detail() };
}

/**
 * Buy through `order` (from providerOrder, or a single provider for a plan that belongs to one), claiming the order for
 * each provider before sending it there. See the rules at the top of this file.
 */
export async function buyAcrossProviders(svc: string, order: Provider[], deps: BuyDeps): Promise<BuyOutcome> {
  if (!order.length) return { via: "none", message: UNAVAILABLE_MSG };
  let claimed = await deps.claim(order[0], []);
  if (!claimed) {
    // Can't record the claim. ClubKonnect was the only provider before any of this existed (no record = ClubKonnect,
    // which `verify` also assumes), so it may still go there alone — but never to VTpass, and never onward.
    if (order[0] !== "clubkonnect") return { via: "none", message: RETRY_MSG };
    const a = await tryClubKonnect(deps, false);
    return "settled" in a ? a.settled : a.moveOn;
  }
  // A retry of an order that was already sent somewhere goes back there — whatever order the providers are in now.
  // Each pass either settles or claims a provider the order has never had, so with two providers this ends quickly;
  // the cap is only a guard.
  for (let pass = 0; pass < 2 * PROVIDERS.length; pass++) {
    const current = claimed[claimed.length - 1];
    const canMove = order.some((p) => !claimed!.includes(p));
    const a = current === "vtpass" ? await tryVtpass(deps) : await tryClubKonnect(deps, canMove);
    if ("settled" in a) return a.settled;
    deps.alert({ svc, outcome: "provider-refused", provider: current, detail: a.detail });
    const next = order.find((p) => !claimed!.includes(p));
    if (!next) return a.moveOn;
    const after = await deps.claim(next, claimed);
    if (!after) return a.moveOn;   // couldn't record the move → don't make it; nothing was placed, so the customer is refunded
    if (after[after.length - 1] === next && after.length === claimed.length + 1) deps.alert({ svc, outcome: "failover", from: current, to: next, detail: a.detail });
    else if (after.length === claimed.length) return a.moveOn;   // the claim didn't move (nothing new) → stop here
    claimed = after;
  }
  return { via: "none", message: UNAVAILABLE_MSG };
}

// ── Verify: which provider has the order, and in what state ──────────────────────────────────────────────────────

export type VerifyState = "SUCCESS" | "PENDING" | "FAILED" | "NOT_FOUND" | "UNKNOWN";
export interface ProviderVerdict { provider: Provider; state: VerifyState; body: Record<string, unknown> }

/**
 * Combine each claimed provider's answer. The order lives with the LAST provider it was claimed for (it only moved on
 * after the earlier one confirmed it had nothing), so that one decides — except that a delivered order anywhere is
 * delivered, and one still pending anywhere is held.
 */
export function combineVerdicts(verdicts: ProviderVerdict[]): ProviderVerdict | null {
  if (!verdicts.length) return null;
  const win = verdicts.find((v) => v.state === "SUCCESS") ?? verdicts.find((v) => v.state === "PENDING");
  return win ?? verdicts[verdicts.length - 1];
}

/** A VTpass /requery answer as a verify verdict. */
export function vtVerify(rq: VtResult): VerifyState {
  if (vtCode(rq) === "019") return "FAILED";   // the request was refused as a look-alike (its record says so) — nothing placed
  switch (classifyVt(rq)) {
    case "delivered": return "SUCCESS";
    case "pending": return "PENDING";
    case "failed": return "FAILED";
    case "not-found": return "NOT_FOUND";
    default: return "UNKNOWN";
  }
}

/** What VTpass says it took from our wallet for an order (for the finance ledger), in kobo; null if it didn't say. */
export function vtCostKobo(d: VtResult): number | null {
  const n = Number(vtTxn(d).total_amount);
  return Number.isFinite(n) && n > 0 && n < 5_000_000 ? Math.round(n * 100) : null;
}

/** VTpass health from a lookup of an order that can't exist: "no such order" = up; our account refused or an error page = down. */
export function vtProbeVerdict(d: VtResult | null | undefined): Health {
  if (!d || d._unreachable) return "unknown";
  if (typeof d._raw === "string") return Number(d._http) >= 500 ? "down" : "unknown";
  const code = vtCode(d);
  if (code === "015") return "up";
  if (VT_PROVIDER_CODES.has(code)) return "down";
  return Number(d._http) >= 500 ? "down" : "unknown";
}
