// VTpass — the second bill provider (ClubKonnect is the first). Pure helpers with the network passed in, so every
// branch is unit-tested in vtpass.test.ts; clubkonnect/index.ts supplies the real fetch, the keys and the routing.
//
// The rules that make it safe to use with real money (each one is checked against VTpass's sandbox by the service-only
// `vtpass-probe` action before it is relied on):
//   • VTpass ties an order to its request_id and refuses a second /pay with the same one, so the request_id is derived
//     from OUR order reference (never random): a retry, or a lookup days later, always names the same order.
//   • VTpass wants the request_id to START with the order's date and time in Lagos (YYYYMMDDHHII). The app's references
//     are "KDT-BILL-<epoch ms>", so the date comes from the reference itself, not from "now".
//   • An answer that doesn't settle whether an order exists (an error page, "system error", an unknown code, no answer at
//     all) is "unknown" — the caller then asks /requery before it refunds, retries or tries the other provider.

export type VtEnv = "sandbox" | "live";
export const VT_BASE: Readonly<Record<VtEnv, string>> = {
  sandbox: "https://sandbox.vtpass.com/api",
  live: "https://vtpass.com/api",
};

export interface VtCreds { apiKey: string; secretKey: string; publicKey?: string; env: VtEnv; base?: string }
export type VtFetch = (url: string, init: RequestInit) => Promise<Response>;
export type VtResult = Record<string, unknown>;

/** The environment named by the VTPASS_ENV secret. Anything but exactly "live" is the sandbox (play money). */
export function vtEnv(raw: string | null | undefined): VtEnv {
  return String(raw ?? "").trim().toLowerCase() === "live" ? "live" : "sandbox";
}

/** Keys present at all (not whether VTpass accepts them — the probe and the health check find that out). */
export function vtConfigured(c: Partial<VtCreds> | null | undefined): boolean {
  return !!c && !!c.apiKey && !!c.secretKey;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** "YYYYMMDDHHII" in Africa/Lagos (UTC+1 all year — Nigeria has no daylight saving). */
export function lagosStamp(ms: number): string {
  const d = new Date(ms + 60 * 60 * 1000);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

// A 13-digit epoch-ms timestamp (2017–2099) — the app's references are KDT-BILL-<Date.now()>.
const EPOCH_MS = /(?:^|\D)(1[5-9]\d{11}|[2-3]\d{12}|40\d{11})(?:\D|$)/;

/**
 * VTpass request_id for our order reference: the Lagos date+time the order was created, then the reference itself
 * (letters and digits only). Deterministic, so retries and lookups always name the same VTpass order. `nowMs` is used
 * only when the reference carries no timestamp (health probes, test orders).
 */
export function vtRequestId(ourRef: string, nowMs: number): string {
  const ref = String(ourRef ?? "");
  const m = EPOCH_MS.exec(ref);
  const ms = m ? Number(m[1]) : nowMs;
  const body = ref.replace(/[^A-Za-z0-9]/g, "").slice(0, 40);
  return lagosStamp(ms) + (body || "KDT");
}

// VTpass service IDs
const NET_KEY = (n: string) => String(n ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const AIRTIME_SID: Record<string, string> = { mtn: "mtn", airtel: "airtel", glo: "glo", "9mobile": "etisalat", etisalat: "etisalat", t2mobile: "etisalat" };
export function airtimeServiceId(network: string): string | null { return AIRTIME_SID[NET_KEY(network)] ?? null; }
export function dataServiceId(network: string): string | null {
  const a = airtimeServiceId(network);
  return a ? `${a}-data` : null;
}

// ── Cable TV, electricity, WAEC, Smile (codes verified against VTpass's sandbox by vtpass-explore, 2026-09-28) ──

/** Cable providers VTpass carries for us (the app's codes are VTpass's serviceIDs). Showmax isn't on VTpass's access form → ClubKonnect only. */
export const VT_CABLE: ReadonlySet<string> = new Set(["dstv", "gotv", "startimes"]);
/** DStv and GOtv sell a chosen bouquet as a "change" subscription; StarTimes takes the bouquet alone. */
export const vtCableNeedsChange = (provider: string) => provider === "dstv" || provider === "gotv";

/** The app's electricity company codes (ClubKonnect's) → VTpass serviceIDs. */
export const VT_ELECTRIC: Readonly<Record<string, string>> = {
  "01": "eko-electric", "02": "ikeja-electric", "03": "abuja-electric", "04": "kano-electric", "05": "portharcourt-electric",
  "06": "jos-electric", "07": "ibadan-electric", "08": "kaduna-electric", "09": "enugu-electric", "10": "benin-electric",
  "11": "yola-electric", "12": "aba-electric",
};
/** The app's meter type ("01" prepaid, "02" postpaid) → VTpass's variation. */
export const vtMeterType = (t: string): "prepaid" | "postpaid" | null => (t === "01" ? "prepaid" : t === "02" ? "postpaid" : null);

/** The app's WAEC exam types → VTpass service + variation (VTpass spells the registration variation "waec-registraion"). */
export const VT_WAEC: Readonly<Record<string, { serviceID: string; variation: string }>> = {
  waecdirect: { serviceID: "waec", variation: "waecdirect" },
  "waec-registration": { serviceID: "waec-registration", variation: "waec-registraion" },
};
export const VT_SMILE = "smile-direct";

// Discos differ in field names and casing (Ikeja: token/units; Jos: Token/Units; Kano: "Token":"null") — sandbox, 2026-09-28.
const blank = (v: unknown) => { const s = String(v ?? "").trim(); return !s || /^(n\/?a|null|undefined)$/i.test(s) ? "" : s; };

/** A prepaid electricity token: VTpass sends "Token : 2636 2054 …" (or "3737-6908-…") in token / Token / purchased_code / mainToken. */
export function vtElectricToken(d: VtResult | null | undefined): string {
  for (const k of ["token", "Token", "mainToken", "purchased_code"]) {
    const v = blank(String(d?.[k] ?? "").replace(/^\s*token\s*:?\s*/i, ""));
    if (/\d{4}/.test(v)) return v;
  }
  return "";
}
export const vtElectricUnits = (d: VtResult | null | undefined) => blank(d?.units ?? d?.Units ?? d?.mainTokenUnits);

/** WAEC PINs as one line for the receipt: "Serial No: X, PIN: Y | …" (result checker) or "Token: X" (registration). */
export function vtCardDetails(d: VtResult | null | undefined): string {
  const parse = (v: unknown): unknown => { if (typeof v !== "string") return v; try { return JSON.parse(v); } catch { return null; } };
  const cards = parse(d?.cards);
  if (Array.isArray(cards) && cards.length) {
    return cards.map((c: Record<string, unknown>) => `Serial No: ${c.Serial ?? c.serial ?? "-"}, PIN: ${c.Pin ?? c.pin ?? "-"}`).join(" | ");
  }
  const tokens = parse(d?.tokens);
  if (Array.isArray(tokens) && tokens.length) return tokens.map((t) => `Token: ${t}`).join(" | ");
  return String(d?.purchased_code ?? "").replace(/\|\|/g, " | ").trim();
}

/**
 * A /merchant-verify answer. VTpass answers code 000 either way — a bad number comes back as content.error
 * (with WrongBillersCode "true"), a good one with Customer_Name (+ Address for electricity).
 */
export const NAMELESS_CUSTOMER = "Verified (no name on record)";
export function vtCustomer(d: VtResult | null | undefined):
  { kind: "ok"; name: string; address: string } | { kind: "invalid"; message: string } | { kind: "unavailable" } {
  if (!d || d._unreachable || typeof d._raw === "string" || vtCode(d) !== "000") return { kind: "unavailable" };
  const c = (d.content ?? {}) as Record<string, unknown>;
  const name = blank(c.Customer_Name);
  if (c.error || String(c.WrongBillersCode ?? "") === "true") {
    const msg = String(c.error ?? "").trim();
    return { kind: "invalid", message: msg && msg.length < 200 ? msg : "The number you entered could not be verified. Please check it and try again." };
  }
  // Some discos confirm the meter but hold no name for it (Jos in the sandbox: empty name, the meter number echoed back).
  // A matched account with no name is still a match; an answer with neither can't tell us anything.
  const matched = ["MeterNumber", "Meter_Number", "Customer_Number", "Smartcard_Number", "Account_Number", "AccountList"].some((k) => blank(c[k] as unknown) || (c[k] && typeof c[k] === "object"));
  if (!name) return matched ? { kind: "ok", name: NAMELESS_CUSTOMER, address: blank(c.Address) } : { kind: "unavailable" };
  return { kind: "ok", name, address: blank(c.Address) };
}

// The /pay bodies (without request_id). Real orders and the sandbox proof both build them here, so what VTpass
// approved in the sandbox is exactly what goes live.
export const vtAirtimeBody = (serviceID: string, amount: number, phone: string) => ({ serviceID, amount, phone });
export const vtDataBody = (serviceID: string, variationCode: string, phone: string) =>
  ({ serviceID, billersCode: phone, variation_code: variationCode, phone });
export const vtCableBody = (provider: string, smartcard: string, variationCode: string, phone: string) =>
  ({ serviceID: provider, billersCode: smartcard, variation_code: variationCode, phone, ...(vtCableNeedsChange(provider) ? { subscription_type: "change", quantity: 1 } : {}) });
export const vtElectricBody = (serviceID: string, meterNo: string, meterType: "prepaid" | "postpaid", amount: number, phone: string) =>
  ({ serviceID, billersCode: meterNo, variation_code: meterType, amount, phone });
export const vtWaecBody = (examType: string, phone: string) => {
  const w = VT_WAEC[examType];
  return w ? { serviceID: w.serviceID, variation_code: w.variation, quantity: 1, phone } : null;
};
export const vtSmileBody = (accountId: string, variationCode: string, phone: string) =>
  ({ serviceID: VT_SMILE, billersCode: accountId, variation_code: variationCode, phone });

// A plan id the app got from a VTpass catalogue — lets the data purchase go to the provider that listed the plan.
export const VT_PLAN_PREFIX = "vt:";
export const isVtPlan = (planId: unknown) => String(planId ?? "").startsWith(VT_PLAN_PREFIX);
export const vtPlanCode = (planId: string) => planId.slice(VT_PLAN_PREFIX.length);

/** GET /service-variations → the app's plan shape (plan_id tagged "vt:"). VTpass spells the list "varations". */
export function parseVariations(d: VtResult | null | undefined): { plan_id: string; plan_name: string; plan_amount: number }[] {
  const c = (d?.content ?? {}) as Record<string, unknown>;
  const list = (c.varations ?? c.variations ?? []) as Record<string, unknown>[];
  if (!Array.isArray(list)) return [];
  return list
    .map((v) => ({
      plan_id: VT_PLAN_PREFIX + String(v?.variation_code ?? ""),
      plan_name: String(v?.name ?? "").trim(),
      plan_amount: Math.round((Number(v?.variation_amount) || 0) * 100) / 100,
    }))
    .filter((p) => p.plan_id.length > VT_PLAN_PREFIX.length && p.plan_amount > 0);
}

/** One VTpass call. Never throws: no answer → { _unreachable }, a non-JSON body → { _raw, _http }. */
export async function vtCall(
  fetchFn: VtFetch, creds: VtCreds, method: "GET" | "POST", path: string, body?: Record<string, unknown>, timeoutMs = 60_000,
): Promise<VtResult> {
  const base = creds.base || VT_BASE[creds.env];
  const headers: Record<string, string> = { "api-key": creds.apiKey, "secret-key": creds.secretKey, Accept: "application/json" };
  if (creds.publicKey) headers["public-key"] = creds.publicKey;
  if (method === "POST") headers["Content-Type"] = "application/json";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      return j && typeof j === "object" && !Array.isArray(j) ? { ...(j as VtResult), _http: res.status } : { _raw: text.slice(0, 2000), _http: res.status };
    } catch { return { _raw: text.slice(0, 2000), _http: res.status }; }
  } catch (e) {
    return { _unreachable: true, _error: String((e as Error)?.message ?? e).slice(0, 200) };
  } finally { clearTimeout(timer); }
}

export const vtCode = (d: VtResult | null | undefined) => String(d?.code ?? "").trim();
export const vtTxn = (d: VtResult | null | undefined) =>
  (((d?.content ?? {}) as Record<string, unknown>).transactions ?? {}) as Record<string, unknown>;
export const vtTxnStatus = (d: VtResult | null | undefined) => String(vtTxn(d).status ?? "").trim().toLowerCase();

// ── Setting VTpass up from the admin portal (2026-10-26) ──────────────────────────────────────────────────────────
// The admin enters the keys (kept in Supabase Vault) and presses "Test connection": a lookup of an order that can't exist
// (POST, proves the api + secret keys) and a balance read (GET, proves the public key). These turn VTpass's answer codes
// into what the admin has to do. Codes from VTpass's documentation.

const SETUP_PROBLEM: Readonly<Record<string, string>> = {
  "087": "VTpass doesn't recognise these keys. Copy them again from vtpass.com → Settings → API Keys (live keys for Live, sandbox keys for Sandbox).",
  "021": "VTpass has locked this account. Contact VTpass support.",
  "022": "VTpass has suspended this account. Contact VTpass support.",
  "023": "API access isn't switched on for this VTpass account yet. Ask VTpass to enable API access (live go-live approval).",
  "024": "This VTpass account isn't active yet. Finish VTpass's account activation (KYC / go-live approval).",
  "027": "VTpass refused our server's IP address. Turn on \"Send VTpass calls from our fixed IP\" below and whitelist 209.71.82.233 on vtpass.com → Settings → API.",
  "028": "This product isn't enabled on the VTpass account. Ask VTpass to enable it for API use.",
  "034": "VTpass has suspended this service right now.",
  "035": "This service is inactive on VTpass.",
};

/** A setup check's answer → { ok, problem }. The POST check sends a request id that can't exist, so "no such order" (015) = keys accepted. */
export function vtSetupVerdict(d: VtResult | null | undefined, kind: "post" | "get"): { ok: boolean; code: string; problem: string | null } {
  if (!d || d._unreachable) return { ok: false, code: "", problem: `VTpass couldn't be reached${d?._error ? ` (${String(d._error).slice(0, 80)})` : ""}. Try again in a minute.` };
  const code = vtCode(d);
  if (SETUP_PROBLEM[code]) return { ok: false, code, problem: SETUP_PROBLEM[code] };
  const desc = String(d.response_description ?? d.message ?? d.error ?? "").trim();
  if (/ip/i.test(desc) && /whitelist|not allowed|unauthori[sz]ed ip/i.test(desc)) return { ok: false, code, problem: SETUP_PROBLEM["027"] };
  if (kind === "post") {
    if (code === "015" || code === "000" || code === "016") return { ok: true, code, problem: null };
  } else if (vtBalance(d) !== null) return { ok: true, code, problem: null };
  const http = Number(d._http ?? 0);
  if (http === 401 || http === 403 || /invalid credentials|unauthori[sz]ed|invalid api|invalid key/i.test(desc)) return { ok: false, code, problem: SETUP_PROBLEM["087"] };
  if (kind === "get" && !code && !desc) return { ok: false, code, problem: "VTpass didn't return the wallet balance — check the PUBLIC key (it's needed for balance and price lists)." };
  return { ok: false, code, problem: `VTpass answered ${code ? `code ${code}` : `HTTP ${http || "?"}`}${desc ? `: ${desc.slice(0, 120)}` : ""}.` };
}

/** The wallet balance from GET /balance ({ code: 1, contents: { balance } }), in naira; null when absent. */
export function vtBalance(d: VtResult | null | undefined): number | null {
  const c = (d?.contents ?? d?.content ?? null) as Record<string, unknown> | null;
  const v = c && typeof c === "object" ? c.balance : undefined;
  const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : Number(v);
  return v !== undefined && v !== null && v !== "" && Number.isFinite(n) ? n : null;
}

/** Keys as VTpass issues them: letters, digits, "_" and "-", 8–200 characters. */
export const vtKeyLooksValid = (k: unknown) => typeof k === "string" && /^[A-Za-z0-9_-]{8,200}$/.test(k.trim());
