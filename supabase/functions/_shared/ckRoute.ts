// ClubKonnect purchase routing with an automatic V3 fallback.
//
// Why: on 2026-09-28 ClubKonnect's documented purchase scripts (API*V1.asp, and V2) crashed with an IIS "500 -
// Internal server error" page for every service for ~3 hours, while their V3 purchase scripts and the order lookup
// (APIQueryV1.asp) kept answering normally. Every customer purchase in that window failed and was refunded.
//
// What this does: when the main (V1) route answers with a crash page — never on a real answer such as "insufficient
// balance" or "invalid number" — it confirms through the order lookup that the crashed call created no order, then
// places the same order on V3 with the SAME RequestID. ClubKonnect ties an order to its RequestID, and the lookup is
// the tie-breaker at every step, so a customer can never be charged twice. Anything we can't confirm falls back to
// exactly what happened before this existed (a clean error → the customer is refunded), except where an order may
// really exist — then it's held for confirmation instead of refunded.
//
// Pure decision logic with its dependencies passed in (like idCheck.ts), so every branch is unit-tested in
// ckRoute.test.ts; clubkonnect/index.ts supplies the real ClubKonnect calls, the config and the admin alerts.

export type CkResult = Record<string, unknown>;
export type LookupKind = "not-found" | "found-ok" | "found-failed" | "found-pending" | "unknown";
export interface Lookup { kind: LookupKind; q?: CkResult }
export interface RouteConfig {
  fallbackOn: boolean;               // master switch (platform_config.ck_v3_fallback_enabled)
  fallbackServices: Set<string>;     // services allowed to fall back (ck_v3_fallback_services)
  forceV3: Set<string>;              // services sent straight to V3 — for a supervised test purchase only (ck_v3_force_services)
}
export type RouteOutcome = "v3-ok" | "v3-rejected" | "v3-failed" | "v1-recovered" | "v3-recovered" | "pending";
export interface RouteEvent { svc: string; outcome: RouteOutcome; detail?: string }
export interface RouteDeps {
  ck: (path: string, params: Record<string, string>) => Promise<CkResult>;   // may throw on a network failure
  lookup: (apiKey: string, requestId: string) => Promise<Lookup>;           // never throws ("unknown" instead)
  config: () => Promise<RouteConfig>;                                        // never throws; fail-safe = fallback off
  isOk: (d: CkResult) => boolean;
  alert: (e: RouteEvent) => void;                                            // fire-and-forget
}

// Every purchase script we call, and its V3 twin. (Lookups, catalogues and verifications aren't routed — they
// stayed up throughout; only purchases broke.)
export const V3_PATH: Readonly<Record<string, string>> = {
  "APIAirtimeV1.asp":        "APIAirtimeV3.asp",
  "APIDatabundleV1.asp":     "APIDatabundleV3.asp",
  "APICableTVV1.asp":        "APICableTVV3.asp",
  "APIElectricityV1.asp":    "APIElectricityV3.asp",
  "APIBettingV1.asp":        "APIBettingV3.asp",
  "APIWAECV1.asp":           "APIWAECV3.asp",
  "APIJAMBV1.asp":           "APIJAMBV3.asp",
  "APISpectranetV1.asp":     "APISpectranetV3.asp",
  "APISmileV1.asp":          "APISmileV3.asp",
  "APIEPINV1.asp":           "APIEPINV3.asp",
  "APIDatabundleEPINV1.asp": "APIDatabundleEPINV3.asp",
};

/** A crash page (IIS / proxy HTML) rather than a real answer from ClubKonnect: a non-JSON body with a 5xx status. */
export function isProviderCrash(d: CkResult | null | undefined): boolean {
  return !!d && typeof d._raw === "string" && Number(d._http) >= 500;
}

// Returned when an order may really exist but isn't confirmed finished. The wording deliberately matches the app's
// network-error pattern (BillPayments.jsx CK_NET_ERR: "gateway", "timeout"), so the app takes its existing "confirm
// with the provider — hold, don't refund" path rather than refunding an order that may still deliver.
export const PENDING_STATUS = "Provider gateway timeout — confirming your order";
const pending = (via: string): CkResult => ({ status: PENDING_STATUS, _pending: true, _via: via });

/**
 * Buy through the main route; if it crashes, confirm no order was created and buy through V3 instead.
 * Returns what the purchase handler should treat as ClubKonnect's answer (same shape as a direct ck() result).
 */
export async function buyWithFallback(
  svc: string, path: string, params: Record<string, string>, deps: RouteDeps,
): Promise<CkResult> {
  const cfg = await deps.config();
  const v3 = V3_PATH[path];

  // Supervised test mode: this service goes straight to V3 (used once, to prove V3 end-to-end with a real purchase).
  if (v3 && cfg.forceV3.has(svc)) return { ...(await deps.ck(v3, params)), _via: "V3" };

  const first = await deps.ck(path, params);   // a network failure throws, exactly as before (the app has its own retry + confirm)
  if (!isProviderCrash(first) || !v3 || !cfg.fallbackOn || !cfg.fallbackServices.has(svc)) return first;
  const rid = params.RequestID, key = params.APIKey;
  if (!rid || !key) return first;

  // 1. The crashed call may still have created the order. Only an explicit "no such order" makes a second attempt safe.
  const before = await deps.lookup(key, rid);
  if (before.kind === "found-ok") { deps.alert({ svc, outcome: "v1-recovered" }); return { ...before.q, _via: "V1-recovered" }; }
  if (before.kind === "found-pending") { deps.alert({ svc, outcome: "pending", detail: "main route" }); return pending("V1"); }
  if (before.kind !== "not-found") return first;   // failed / unrecognised / lookup down → no second attempt; same as before this existed

  // 2. The same order on V3, with the SAME RequestID.
  let second: CkResult | null = null;
  try { second = await deps.ck(v3, params); } catch { second = null; }
  if (second && deps.isOk(second)) { deps.alert({ svc, outcome: "v3-ok" }); return { ...second, _via: "V3" }; }
  const v3Answered = !!second && !isProviderCrash(second);   // a real (JSON) rejection — V3 is up, it just refused

  // 3. Whatever V3 said, the lookup is the ground truth: did an order get created after all?
  const after = await deps.lookup(key, rid);
  if (after.kind === "found-ok") { deps.alert({ svc, outcome: "v3-recovered" }); return { ...after.q, _via: "V3-recovered" }; }
  if (after.kind === "found-pending") { deps.alert({ svc, outcome: "pending", detail: "backup route" }); return pending("V3"); }
  if (after.kind === "not-found" || after.kind === "found-failed" || v3Answered) {
    const why = second ? String(second.status ?? second.Status ?? (isProviderCrash(second) ? "crash page" : "no status")) : "unreachable";
    deps.alert({ svc, outcome: v3Answered ? "v3-rejected" : "v3-failed", detail: why });
    return first;   // nothing was placed → the customer gets the clean "temporarily unavailable" error and is refunded
  }
  // V3 crashed or was unreachable AND we can't confirm either way — an order may exist: hold, don't refund.
  deps.alert({ svc, outcome: "pending", detail: "backup route unconfirmed" });
  return pending("V3");
}

export type Health = "up" | "down" | "unknown";

/**
 * Combine two probes of ClubKonnect's purchase service (with OUR account, orders it must refuse, on two different
 * scripts). "down" only when BOTH scripts return an error page — so one script mishandling a bad input can never pause
 * every sale. Any real (JSON) answer from either means the service is working. Anything else can't tell → never block.
 */
export function purchaseServiceState(a: Health, b: Health): Health {
  if (a === "down" && b === "down") return "down";
  if (a === "up" || b === "up") return "up";
  return "unknown";
}

/** One probe's verdict from ClubKonnect's reply: a JSON answer = up; a 5xx error page = down; anything else = unknown. */
export function probeVerdict(d: CkResult | null | undefined): Health {
  if (!d) return "unknown";
  if (typeof d._raw === "string") return Number(d._http) >= 500 ? "down" : "unknown";
  return "up";
}

/** Parse the comma-separated service list stored in platform_config ("airtime, data" → Set{"airtime","data"}). */
export function parseServiceList(v: string | null | undefined): Set<string> {
  return new Set(String(v ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
}
