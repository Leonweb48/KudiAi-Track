import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6";
import { bankEmail, esc, cleanSubject, naira, appLink, htmlToText, type EmailRow } from "../_shared/bankEmail.ts";
import { parseCkAmount } from "../_shared/ckAmount.ts";
import { applyDataPrices, parseDiscountPct, parseSellingPrices, type SellingPrices } from "../_shared/dataPricing.ts";
import { findExamProduct, parseCkExamCatalogue, providerExamCode, type ExamProduct } from "../_shared/examCatalogue.ts";
import { checkBillGate, DEFAULT_CONFIG, PURCHASE_ACTIONS, type CouponRow, type GateConfig, type GateDeps, type GateMode } from "../_shared/billGate.ts";
import { airtimeCost, dataCost, findPlanPrice, networkName, parseDiscounts, printAirtimeCost, type Cost, type Discounts } from "../_shared/billCost.ts";
import { buyWithFallback, parseServiceList, probeVerdict, purchaseServiceState, V3_PATH, type CkResult, type Health, type Lookup, type RouteConfig, type RouteEvent } from "../_shared/ckRoute.ts";
import {
  airtimeServiceId, dataServiceId, isVtPlan, parseVariations, VT_CABLE, VT_ELECTRIC, VT_SMILE, VT_WAEC, vtAirtimeBody, vtCableBody, vtCall, vtCardDetails, vtCode,
  vtConfigured, vtCustomer, vtDataBody, vtElectricBody, vtElectricToken, vtElectricUnits, vtEnv, vtMeterType, vtPlanCode, vtRequestId, vtSmileBody, vtTxn,
  vtTxnStatus, vtWaecBody, type VtCreds, type VtFetch, type VtResult,
} from "../_shared/vtpass.ts";
import {
  buyAcrossProviders, classifyVt, combineVerdicts, DEFAULT_PROVIDER_CONFIG, parseProviderConfig, PROVIDER_LABEL, providerOrder, vtCostKobo, vtMessage, vtProbeVerdict, vtVerify,
  VT_SERVICES, type BuyDeps, type BuyOutcome, type Provider, type ProviderConfig, type ProviderVerdict, type SwitchEvent,
} from "../_shared/billProvider.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (d: unknown) =>
  new Response(JSON.stringify(d), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });

const BASE           = Deno.env.get("CK_BASE") || "https://www.nellobytesystems.com/";   // overridable for testing only — never set in prod
const USER_ID        = Deno.env.get("CK_USER_ID")           ?? "";
const AIRTIME_K      = Deno.env.get("CK_AIRTIME_KEY")       ?? "";
const DATA_K         = Deno.env.get("CK_DATA_KEY")          ?? "";
const CABLETV_K      = Deno.env.get("CK_CABLETV_KEY")       ?? "";
const ELECTRICITY_K  = Deno.env.get("CK_ELECTRICITY_KEY")   ?? "";
const BETTING_K      = Deno.env.get("CK_BETTING_KEY")       ?? "";
const WAEC_K         = Deno.env.get("CK_WAEC_KEY")          ?? "";
const JAMB_K         = Deno.env.get("CK_JAMB_KEY")          ?? "";
const SPECTRANET_K   = Deno.env.get("CK_SPECTRANET_KEY")    ?? "";
const SMILE_K        = Deno.env.get("CK_SMILE_KEY")         ?? "";
const PRINT_AIRTIME_K = Deno.env.get("CK_PRINT_AIRTIME_KEY") ?? "";
const PRINT_DATA_K   = Deno.env.get("CK_PRINT_DATA_KEY")    ?? "";

// VTpass — the second provider (see _shared/vtpass.ts). VTPASS_ENV is set together with the keys, so the environment always
// matches them; anything but "live" is the sandbox (play money), which must never serve a real customer.
const VT: VtCreds = {
  apiKey: Deno.env.get("VTPASS_API_KEY") ?? "", secretKey: Deno.env.get("VTPASS_SECRET_KEY") ?? "",
  publicKey: Deno.env.get("VTPASS_PUBLIC_KEY") ?? "", env: vtEnv(Deno.env.get("VTPASS_ENV")),
  base: Deno.env.get("VTPASS_BASE") || undefined,   // overridable for testing only — never set in prod
};

const NET_ID: Record<string, string> = {
  MTN: "01", Glo: "02", "t2mobile": "03", "9mobile": "03", Airtel: "04",
};

const reqId = () => `KDT${Date.now()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

// A network failure mid-request does NOT mean the order failed — ClubKonnect may
// have already fulfilled it. We therefore (a) bound each call with a timeout and
// (b) retry on network/timeout errors reusing the SAME url, which means the same
// RequestID. CK is idempotent on RequestID: a retry after a lost-but-successful
// response returns the existing order instead of charging again.
async function ck(
  path: string,
  params: Record<string, string>,
  opts: { timeoutMs?: number; retries?: number } = {},
): Promise<Record<string, unknown>> {
  const { timeoutMs = 45000, retries = 2 } = opts;
  const qs  = new URLSearchParams({ UserID: USER_ID, ...params });
  const url = `${BASE}${path}?${qs}`;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 1500 * attempt));
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res  = await fetch(url, { headers: { "Accept": "application/json" }, signal: ctrl.signal });
      clearTimeout(timer);
      const text = await res.text();
      console.log(`CK ${path} try=${attempt} status=${res.status} body=${text.slice(0, 400)}`);
      let parsed: Record<string, unknown>;
      try { parsed = JSON.parse(text) as Record<string, unknown>; }
      catch { parsed = { _raw: text, _http: res.status }; }
      // A 5xx with a body that isn't even JSON reads as a transient upstream blip (an IIS/proxy error page —
      // not a real "your request was rejected" answer from ClubKonnect itself) — worth one more try, the same
      // as a network failure, before we give up and report it. A 5xx that DID parse as JSON is a real answer
      // and is returned as-is, not retried.
      if (res.status >= 500 && "_raw" in parsed && attempt < retries) {
        lastErr = new Error(`CK ${path} HTTP ${res.status} with no JSON body`);
        console.warn(`CK ${path} try=${attempt} got HTTP ${res.status} with no JSON body — retrying`);
        continue;
      }
      return parsed;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      console.warn(`CK ${path} try=${attempt} network error: ${(e as Error).message}`);
    }
  }
  throw lastErr ?? new Error(`CK ${path} unreachable`);
}

// Statuses that always mean failure regardless of statuscode
const FAIL_PATTERNS = [
  "INSUFFICIENT", "LOW_WALLET", "LOW WALLET", "LOW BALANCE", "NO BALANCE",
  "FAILED", "FAILURE", "TRANSACTION FAILED", "ORDER FAILED", "ORDER_FAILED",
  "NETWORK ERROR", "SERVICE UNAVAILABLE", "DUPLICATE", "INVALID_CREDENTIALS",
  "INVALID_KEY", "INVALID KEY", "INVALID USER", "UNAUTHORIZED",
];

function isOk(data: Record<string, unknown>): boolean {
  const code = String(data?.statuscode ?? data?.StatusCode ?? "").trim();
  const stat = String(data?.status ?? data?.Status ?? "").toUpperCase().trim();

  // Explicit failure — override any good statuscode
  if (FAIL_PATTERNS.some(p => stat.includes(p))) return false;

  return code === "100" || code === "200" ||
         stat === "ORDER_RECEIVED" || stat === "ORDER_COMPLETED" ||
         stat === "SUCCESSFUL" || stat === "SUCCESS";
}

// A provider outage (e.g. an IIS 500 page, a CDN error page, a WAF block page) never comes back as JSON —
// ck()'s JSON.parse fails and the whole raw page ends up in data._raw. Customers were seeing that verbatim
// (a full <!DOCTYPE html>…</html> dump as their "error message"): errMsg()'s fallback chain used to end in
// data?._raw, and every real-world non-JSON response tripped it. _raw/_http stay on the response for admin/log
// diagnosis (still attached via `_raw: data` at every call site) — they just never become the CUSTOMER-facing string.
const LOOKS_LIKE_RAW_DUMP = /<!DOCTYPE|<html[\s>]|<body[\s>]/i;
function looksLikeRawProviderJunk(s: string): boolean {
  const t = s.trim();
  return t.length > 300 || LOOKS_LIKE_RAW_DUMP.test(t);
}

function errMsg(data: Record<string, unknown>, fallback: string): string {
  if (typeof data?._raw === "string") return "The bill payment service is temporarily unavailable. Please try again shortly.";
  const raw = data?.status ?? data?.Status ?? data?.message ?? data?.Message ??
              data?.description ?? data?.Description ?? data?.Response ?? data?.response ??
              data?.StatusMessage ?? data?.statusmessage ?? data?.error ?? data?.Error ??
              fallback;
  const msg = String(raw);
  // Defense in depth: whichever field this actually came from, never forward something that looks like a raw
  // HTML page or an unreasonably long dump — fall back to the clean, generic message instead.
  return looksLikeRawProviderJunk(msg) ? fallback : msg;
}

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")              ?? "";
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY      = Deno.env.get("SUPABASE_ANON_KEY")         ?? "";

// ── Selling prices (logic + tests live in _shared/dataPricing.ts) ─────────────────────────────────────────
// The owner sets what customers pay for data in platform_config (data_selling_prices, print_data_discount_pct); the data-plans action swaps them in for
// the provider price. Cached for a minute so a plan-list request is not a database round trip every time.
let priceCfgCache: { at: number; selling: SellingPrices; printPct: number } | null = null;
async function priceConfig(): Promise<{ selling: SellingPrices; printPct: number }> {
  if (priceCfgCache && Date.now() - priceCfgCache.at < 60_000) return priceCfgCache;
  try {
    const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data } = await db.from("platform_config").select("key, value").in("key", ["data_selling_prices", "print_data_discount_pct"]);
    const m: Record<string, string> = {};
    for (const r of (data ?? []) as { key: string; value: string }[]) m[r.key] = r.value;
    priceCfgCache = { at: Date.now(), selling: parseSellingPrices(m.data_selling_prices), printPct: parseDiscountPct(m.print_data_discount_pct) };
    return priceCfgCache;
  } catch (e) {
    console.warn("[data-plans] price config unavailable, using provider prices:", (e as Error).message);
    return { selling: {}, printPct: 0 };
  }
}

// ── Bill purchase gate wiring (logic + tests live in _shared/billGate.ts) ─────────────────────────────────────────
let gateConfigCache: { at: number; cfg: GateConfig } | null = null;
function makeGateDeps(): GateDeps {
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const asMode = (v: unknown, d: GateMode): GateMode => (v === "off" || v === "log" || v === "enforce" ? v : d);
  return {
    async config() {
      if (gateConfigCache && Date.now() - gateConfigCache.at < 60_000) return gateConfigCache.cfg;
      const { data } = await db.from("platform_config").select("key, value")
        .in("key", ["bills_gate_mode", "bills_gate_floor_mode", "bills_gate_floor_pct", "bills_gate_tolerance_kobo"]);
      const m: Record<string, string> = {};
      (data ?? []).forEach((r: { key: string; value: string }) => { m[r.key] = r.value; });
      const cfg: GateConfig = {
        mode: asMode(m.bills_gate_mode, DEFAULT_CONFIG.mode),
        floorMode: asMode(m.bills_gate_floor_mode, DEFAULT_CONFIG.floorMode),
        floor_pct: Number.isFinite(Number(m.bills_gate_floor_pct)) && Number(m.bills_gate_floor_pct) > 0 ? Number(m.bills_gate_floor_pct) : DEFAULT_CONFIG.floor_pct,
        tolerance_kobo: Number.isFinite(Number(m.bills_gate_tolerance_kobo)) && Number(m.bills_gate_tolerance_kobo) >= 0 ? Number(m.bills_gate_tolerance_kobo) : DEFAULT_CONFIG.tolerance_kobo,
      };
      gateConfigCache = { at: Date.now(), cfg };
      return cfg;
    },
    rpc: (name, args) => db.rpc(name, args) as unknown as Promise<{ data: unknown; error: { message: string } | null }>,
    async coupon(code) {
      // exact match ignoring case; % and _ are escaped so a code can never act as a wildcard
      const esc = code.replace(/[\\%_]/g, (c) => "\\" + c);
      const { data } = await db.from("coupons")
        .select("code, type, value, applies_to, min_amount, valid_from, valid_until, is_active, max_uses, used_count, one_per_user")
        .ilike("code", esc).limit(2);
      return (data && data.length === 1 ? data[0] : null) as CouponRow | null;
    },
    async paystack(reference) {
      const key = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
      if (!key) return null;
      const r = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${key}` } });
      const j = await r.json().catch(() => null) as { status?: boolean; data?: { status?: string; amount?: number; metadata?: { payment_type?: string } } } | null;
      if (!r.ok || !j?.data) return null;
      return { success: j.data.status === "success", amountKobo: Number(j.data.amount ?? 0), isBill: j.data.metadata?.payment_type === "bill" };
    },
    async log(row) { await db.from("bill_gate_log").insert(row); },
  };
}

// ── What this order cost US (logic + tests live in _shared/billCost.ts) ───────────────────────────────────────────
// Written to the platform finance ledger the moment an airtime / data / print order is accepted, so the admin profit report can show the real
// margin per order. It is best-effort by design: it runs after the response is on its way, never throws into a purchase, and a failure only
// means that one order has no recorded cost (the report shows how much of the period is covered).
let costDiscCache: { at: number; d: Discounts } | null = null;
async function costDiscounts(): Promise<Discounts> {
  if (costDiscCache && Date.now() - costDiscCache.at < 5 * 60_000) return costDiscCache.d;
  const { data } = await createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } }).from("platform_config").select("value").eq("key", "ck_discounts").maybeSingle();
  costDiscCache = { at: Date.now(), d: parseDiscounts((data as { value?: string } | null)?.value) };
  return costDiscCache.d;
}
const planListCache = new Map<string, { at: number; resp: unknown }>();   // "<key label>:<network id>" -> the provider's plan list
async function providerPlanPrice(label: string, apiKey: string, netId: string, network: string, planId: string): Promise<number | null> {
  const ck_ = `${label}:${netId}`;
  let hit = planListCache.get(ck_);
  if (!hit || Date.now() - hit.at > 10 * 60_000) {
    const resp = await ck("APIDatabundlePlansV2.asp", { APIKey: apiKey, MobileNetwork: netId }, { retries: 0, timeoutMs: 8000 });
    hit = { at: Date.now(), resp };
    planListCache.set(ck_, hit);
  }
  return findPlanPrice(hit.resp, network, planId);
}
async function recordBillCost(cat: string, rid: string, userId: string | null, resp: Record<string, unknown>, work: (d: Discounts) => Promise<Cost | null>, meta: Record<string, unknown> = {}) {
  try {
    if (!rid || !SUPABASE_URL || !SERVICE_KEY) return;
    const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const cost = await work(await costDiscounts());
    if (!cost) { console.warn(`[finance] no cost worked out for ${cat} order ${rid}`); return; }
    const { error } = await db.rpc("finance_record_bill_cost", {
      p_request_id: rid, p_cat: cat, p_cost_kobo: cost.costKobo, p_face_kobo: cost.faceKobo, p_basis: cost.basis, p_estimated: cost.estimated, p_user: userId,
      // field NAMES only (never values) of the provider's response: shows whether it reports its own charge, so the estimate can be replaced by it
      p_meta: { ck_fields: Object.keys(resp ?? {}).slice(0, 30), ...meta },
    });
    if (error) console.warn(`[finance] cost not recorded for ${rid}: ${error.message}`);
  } catch (e) { console.warn(`[finance] cost not recorded for ${rid}: ${(e as Error).message}`); }
}
// Let the runtime finish the work after the customer already has their answer; where that is not available, it simply runs alongside.
function afterResponse(p: Promise<unknown>) {
  const er = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (er?.waitUntil) er.waitUntil(p);
}

// Constant-time string comparison for secrets (avoids leaking a match prefix through timing).
function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

// Is this bearer token the project's service-role key? The key injected into this function as SUPABASE_SERVICE_ROLE_KEY
// is NOT necessarily the same string as the legacy service_role JWT that other callers (the admin portal) hold, so a
// plain string match would lock them out. Anything else that claims service_role is PROVED by asking PostgREST to run a
// service-only function with it — PostgREST verifies the signature, and only a genuine service_role token may execute
// email_relay_quota (a harmless read-only lookup). A forged or user token cannot pass.
const serviceProofCache = new Map<string, number>();   // token -> expiry ms (positive results only)
async function isServiceCall(token: string): Promise<boolean> {
  if (!token) return false;
  if (SERVICE_KEY && timingSafeEqual(token, SERVICE_KEY)) return true;
  if (!SUPABASE_URL || token.split(".").length !== 3) return false;
  const cached = serviceProofCache.get(token);
  if (cached && cached > Date.now()) return true;
  try {
    const payload = JSON.parse(atob((token.split(".")[1] || "").replace(/-/g, "+").replace(/_/g, "/")));
    if (payload?.role !== "service_role") return false;   // ordinary user / anon tokens never reach the probe
  } catch { return false; }
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/email_relay_quota`, {
      method: "POST",
      headers: { apikey: token, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_user: "00000000-0000-0000-0000-000000000000" }),
    });
    if (r.ok) serviceProofCache.set(token, Date.now() + 5 * 60_000);
    return r.ok;
  } catch { return false; }
}

function unauthorized() {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ── Shared email helper ───────────────────────────────────────────────────────
const sendEmail = async (
  sb: ReturnType<typeof createClient>,
  opts: { to: string; subject: string; html: string }
) => {
  const { data: smtp } = await sb.from("smtp_config").select("*").limit(1).maybeSingle();
  if (!smtp) { console.error("sendEmail: no SMTP config found"); return; }
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.encryption === "ssl",
    auth: { user: smtp.username, pass: smtp.password },
  });
  await transport.sendMail({
    from: `"${smtp.from_name}" <${smtp.from_email}>`,
    to:   opts.to,
    subject: cleanSubject(opts.subject),
    html: opts.html,
    text: htmlToText(opts.html),
  });
};

// ── Branded email layout helper (shared by all bill email templates) ──────
const billEmailHtml = (opts: { accentColor: string; icon?: string; title: string; subtitle?: string; body: string }) =>
  `<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:16px;">
    <div style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
      <div style="background:linear-gradient(135deg,#0F1D42 0%,#1B2A5E 100%);padding:24px;text-align:center;">
        <img src="https://kudiai.app/logo.png" alt="KudiAI Track" width="52" style="display:block;margin:0 auto 12px;border-radius:10px;box-shadow:0 4px 14px rgba(0,0,0,0.3);"/>
        <h1 style="color:#fff;margin:0 0 2px;font-size:20px;font-weight:900;letter-spacing:-0.3px;">KudiAI Track</h1>
        <p style="color:rgba(255,255,255,0.45);margin:0;font-size:10px;letter-spacing:2px;text-transform:uppercase;">Business Management Platform</p>
      </div>
      <div style="background:${opts.accentColor};padding:16px 24px;text-align:center;">
        ${opts.icon ? `<p style="margin:0 0 6px;font-size:26px;">${opts.icon}</p>` : ""}
        <h2 style="color:#fff;margin:0 0 3px;font-size:19px;font-weight:800;">${opts.title}</h2>
        ${opts.subtitle ? `<p style="color:rgba(255,255,255,0.85);margin:0;font-size:13px;">${opts.subtitle}</p>` : ""}
      </div>
      <div style="padding:26px 24px;background:#fff;">${opts.body}</div>
      <div style="background:#f8fafc;padding:18px 24px;text-align:center;border-top:1px solid #e2e8f0;">
        <p style="margin:0 0 5px;color:#64748b;font-size:11px;line-height:1.5;">For support reach out to: <a href="mailto:support@kudiai.app" style="color:#4f46e5;text-decoration:none;font-weight:600;">support@kudiai.app</a></p>
        <p style="margin:0 0 3px;color:#94a3b8;font-size:11px;line-height:1.5;">A product of AMAYA &amp; Co. Technologies — all rights reserved &copy; ${new Date().getFullYear()}</p>
        <p style="margin:0;color:#cbd5e1;font-size:10px;line-height:1.5;">This is an automated message — please do not reply directly to this email.</p>
      </div>
    </div>
  </div>`;

// ── Purchase routing: ClubKonnect's main route (V1) with an automatic V3 fallback ─────────────────────────────────
// The decision logic and its tests live in _shared/ckRoute.ts; this wires in the real ClubKonnect calls, the switches
// (platform_config, cached 60s, fail-safe = off) and the admin alerts. Every purchase call site goes through ckBuy().

// ClubKonnect's "there is no order with this RequestID" answer (shared with the `verify` action).
function queryNotFound(q: Record<string, unknown>): boolean {
  const stat = String(q?.status ?? q?.Status ?? q?.transactionstatus ?? q?.TransactionStatus ?? "").toUpperCase().trim();
  const rawU = JSON.stringify(q).toUpperCase();
  return stat.includes("INVALID_REQUESTID") || stat.includes("INVALID_ORDERID") ||
         stat.includes("ORDER_NOT_FOUND")   || stat.includes("NOT_FOUND") ||
         rawU.includes("INVALID REQUESTID") || rawU.includes("NO TRANSACTION") ||
         rawU.includes("INVALID_REQUESTID");
}

// Ground truth for the fallback: does an order exist for this RequestID, and in what state? Never throws.
async function lookupOrder(apiKey: string, requestId: string): Promise<Lookup> {
  let q: Record<string, unknown>;
  try { q = await ck("APIQueryV1.asp", { APIKey: apiKey, RequestID: requestId }, { retries: 1, timeoutMs: 15000 }); }
  catch { return { kind: "unknown" }; }
  if (typeof q?._raw === "string") return { kind: "unknown", q };
  if (queryNotFound(q)) return { kind: "not-found", q };
  const code = String(q?.statuscode ?? q?.StatusCode ?? "").trim();
  const stat = String(q?.status ?? q?.Status ?? q?.transactionstatus ?? q?.TransactionStatus ?? "").toUpperCase().trim();
  // a lookup we couldn't make (credentials etc.) says nothing about the order
  if (/INVALID_CREDENTIALS|MISSING_CREDENTIALS|INVALID_KEY|INVALID KEY|INVALID USER|UNAUTHORIZED/.test(stat)) return { kind: "unknown", q };
  if (FAIL_PATTERNS.some((p) => stat.includes(p)) || stat.includes("CANCEL") || code.startsWith("5")) return { kind: "found-failed", q };
  const pins = q?.TXN_EPIN ?? q?.TXN_EPIN_DATABUNDLE;
  if (isOk(q) || q?.carddetails || q?.CardDetails || (Array.isArray(pins) && pins.length)) return { kind: "found-ok", q };
  return { kind: (q?.orderid ?? q?.OrderID ?? q?.transactionid ?? q?.TransactionID) ? "found-pending" : "unknown", q };
}

type FullRouteConfig = RouteConfig & { healthcheckOn: boolean };
const ROUTE_OFF: FullRouteConfig = { fallbackOn: false, fallbackServices: new Set(), forceV3: new Set(), healthcheckOn: false };
let routeCfgCache: { at: number; cfg: FullRouteConfig } | null = null;
async function routeConfig(): Promise<FullRouteConfig> {
  if (routeCfgCache && Date.now() - routeCfgCache.at < 60_000) return routeCfgCache.cfg;
  try {
    const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data, error } = await db.from("platform_config").select("key, value")
      .in("key", ["ck_v3_fallback_enabled", "ck_v3_fallback_services", "ck_v3_force_services", "ck_route_healthcheck_enabled"]);
    if (error) throw error;
    const m: Record<string, string> = {};
    for (const r of (data ?? []) as { key: string; value: string }[]) m[r.key] = r.value;
    const cfg: FullRouteConfig = {
      fallbackOn: m.ck_v3_fallback_enabled === "true",
      fallbackServices: parseServiceList(m.ck_v3_fallback_services),
      forceV3: parseServiceList(m.ck_v3_force_services),
      healthcheckOn: m.ck_route_healthcheck_enabled === "true",
    };
    routeCfgCache = { at: Date.now(), cfg };
    return cfg;
  } catch (e) {
    console.warn("[route] config unavailable — fallback and health check off:", (e as Error).message);
    return ROUTE_OFF;   // not cached, so a DB blip doesn't switch the fallback off for a minute
  }
}

// Admins hear about it — in-app + email to super/finance admins, at most once an hour per kind of problem.
type RouteAlert = RouteEvent | { svc: string; outcome: "blocked"; detail?: string };
const ROUTE_ALERT: Record<RouteAlert["outcome"], { type: string; title: string; what: string }> = {
  "v3-ok":        { type: "warning", title: "ClubKonnect main route down — backup route in use", what: "The main purchase route crashed; the order went through on the backup (V3) route." },
  "v3-recovered": { type: "warning", title: "ClubKonnect main route down — backup route in use", what: "The main purchase route crashed; the backup (V3) route delivered the order (confirmed by lookup)." },
  "v1-recovered": { type: "warning", title: "ClubKonnect main route unstable", what: "The main purchase route crashed but the order had gone through (confirmed by lookup) — no second attempt made." },
  "v3-rejected":  { type: "error",   title: "ClubKonnect main route down — backup route refusing orders", what: "The main route crashed and the backup (V3) route refused the order. The customer was refunded." },
  "v3-failed":    { type: "error",   title: "ClubKonnect main AND backup routes down", what: "Both purchase routes failed and no order was created. The customer was refunded." },
  "pending":      { type: "warning", title: "ClubKonnect order held for confirmation", what: "An order may exist but isn't confirmed finished — it's held (not refunded) until reconciled." },
  "blocked":      { type: "error",   title: "ClubKonnect down — bill sales paused", what: "The pre-payment check found the purchase route down (and no working backup), so customers are told to try again later and are NOT charged." },
};
// In-app + email to super/finance admins, at most once an hour per title.
async function sendBillAlert(
  a: { type: string; title: string; what: string; hint: string; emailHint: string },
  e: { svc: string; outcome: string; detail?: string },
) {
  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: recent } = await sb.from("admin_notifications").select("id").eq("title", a.title)
      .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString()).limit(1);
    if (recent && recent.length) return;
    const message = `${a.what} Service: ${e.svc}${e.detail ? ` (${e.detail})` : ""}. ${a.hint}`;
    await sb.from("admin_notifications").insert({ type: a.type, category: "finance", title: a.title, message, metadata: { svc: e.svc, outcome: e.outcome, detail: e.detail ?? null } });
    const { data: admins } = await sb.from("admin_users")
      .select("email").in("role", ["super_admin", "finance_admin"]).eq("is_active", true).not("email", "is", null);
    const html = billEmailHtml({
      accentColor: a.type === "error" ? "linear-gradient(135deg,#dc2626,#b91c1c)" : "linear-gradient(135deg,#d97706,#b45309)",
      icon: "⚠", title: a.title, subtitle: `Service: ${esc(e.svc)}`,
      body: `<p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.6;">${esc(a.what)}</p>
             ${e.detail ? `<p style="margin:0 0 12px;color:#64748b;font-size:13px;">Detail: ${esc(e.detail)}</p>` : ""}
             <p style="margin:0;color:#64748b;font-size:12px;line-height:1.6;">You'll get at most one of these an hour. ${esc(a.emailHint)}</p>`,
    });
    for (const ad of (admins || [])) {
      if (!ad.email) continue;
      try { await sendEmail(sb, { to: ad.email, subject: `[KudiTrack] ${a.title}`, html }); }
      catch (err) { console.error("bill alert email failed:", (err as Error).message); }
    }
  } catch (err) { console.error("sendBillAlert error:", (err as Error).message); }
}
function sendRouteAlert(e: RouteAlert) {
  return sendBillAlert({
    ...ROUTE_ALERT[e.outcome],
    hint: "Check ClubKonnect's status; the switches are ck_v3_fallback_enabled / ck_v3_fallback_services / ck_route_healthcheck_enabled in platform_config.",
    emailHint: "Switches in platform_config: ck_v3_fallback_enabled, ck_v3_fallback_services, ck_route_healthcheck_enabled.",
  }, e);
}

/** Every purchase goes through here: the main route, with the V3 fallback when it crashes (see _shared/ckRoute.ts). */
function ckBuy(svc: string, path: string, params: Record<string, string>) {
  return buyWithFallback(svc, path, params, {
    ck: (p, q) => ck(p, q), lookup: lookupOrder, config: routeConfig, isOk,
    alert: (e) => afterResponse(sendRouteAlert(e)),
  });
}

// Free health probe for a purchase script: a made-up account gets ClubKonnect's "invalid credentials" JSON when the
// script is healthy and the crash page when it's broken. Never touches our account, never places anything.
const healthCache = new Map<string, { at: number; state: "up" | "down" | "unknown" }>();
async function routeHealth(path: string): Promise<"up" | "down" | "unknown"> {
  const hit = healthCache.get(path);
  if (hit && Date.now() - hit.at < 60_000) return hit.state;
  let state: "up" | "down" | "unknown" = "unknown";
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const qs = new URLSearchParams({ UserID: "CK000000", APIKey: "KUDIAI-HEALTHCHECK", RequestID: "KUDIAI-HEALTHCHECK", CallBackURL: "https://kudiai.app/" });
    const res = await fetch(`${BASE}${path}?${qs}`, { headers: { Accept: "application/json" }, signal: ctrl.signal });
    const text = await res.text();
    let isJson = true; try { JSON.parse(text); } catch { isJson = false; }
    state = isJson ? "up" : res.status >= 500 ? "down" : "unknown";
  } catch { state = "unknown"; }   // can't tell → never block on it
  finally { clearTimeout(timer); }
  healthCache.set(path, { at: Date.now(), state });
  return state;
}

// Is ClubKonnect's purchase SERVICE up for OUR account? On 2026-09-28 evening the login check and lookups answered
// normally while every real purchase got IIS 503 "The service is unavailable" — invisible to the made-up-account probe
// above, which stops at the login check. So: two orders ClubKonnect must refuse, with our account, on two different
// scripts — a data plan that doesn't exist, and airtime on a network code that doesn't exist — each also below the ₦50
// minimum and to phone "0", so nothing can ever be placed. Cached 60s; "down" only when BOTH scripts fail.
let svcHealth: { at: number; state: Health } | null = null;
async function purchaseServiceHealth(): Promise<Health> {
  if (svcHealth && Date.now() - svcHealth.at < 60_000) return svcHealth.state;
  if (!USER_ID || !DATA_K || !AIRTIME_K) return "unknown";
  const probe = async (path: string, params: Record<string, string>): Promise<Health> => {
    try {
      const d = await ck(path, { ...params, MobileNumber: "0", RequestID: `KUDIAI-HEALTH-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, CallBackURL: "https://kudiai.app/" }, { retries: 0, timeoutMs: 10000 });
      if (isOk(d)) console.error(`[health] ClubKonnect ACCEPTED an unfulfillable health-probe order on ${path} — investigate`, JSON.stringify(d).slice(0, 200));
      return probeVerdict(d);
    } catch { return "unknown"; }
  };
  const [a, b] = await Promise.all([
    probe("APIDatabundleV1.asp", { APIKey: DATA_K, MobileNetwork: "01", DataPlan: "KUDIAI-NO-SUCH-PLAN", Amount: "1" }),
    probe("APIAirtimeV1.asp",    { APIKey: AIRTIME_K, MobileNetwork: "99", Amount: "1" }),
  ]);
  const state = purchaseServiceState(a, b);
  svcHealth = { at: Date.now(), state };
  return state;
}

// bill-preflight category → [purchase service, main-route script]
const PREFLIGHT_ROUTE: Record<string, [string, string]> = {
  airtime: ["airtime", "APIAirtimeV1.asp"], data: ["data", "APIDatabundleV1.asp"], cable: ["cable", "APICableTVV1.asp"],
  electricity: ["electricity", "APIElectricityV1.asp"], betting: ["betting", "APIBettingV1.asp"],
  waec: ["waec", "APIWAECV1.asp"], jamb: ["jamb", "APIJAMBV1.asp"], spectranet: ["spectranet", "APISpectranetV1.asp"],
  smile: ["smile", "APISmileV1.asp"], "print-airtime": ["print-airtime", "APIEPINV1.asp"],
  "airtime-bundle": ["print-airtime", "APIEPINV1.asp"], "print-data": ["print-data", "APIDatabundleEPINV1.asp"],
};

// ── Bill provider switch: ClubKonnect or VTpass (logic + tests in _shared/billProvider.ts) ─────────────────────────
// The admin picks the main provider for airtime and data (platform_config.bill_provider) and whether an order may move
// to the other one when the main one is down (bill_provider_failover). Admin portal → Bill provider.

/** VTpass may serve customers only with LIVE keys — the sandbox is play money. */
const vtUsable = () => vtConfigured(VT) && VT.env === "live";
const vtFetch: VtFetch = (u, i) => fetch(u, i);

let provCfgCache: { at: number; cfg: ProviderConfig } | null = null;
async function providerConfig(): Promise<ProviderConfig> {
  if (provCfgCache && Date.now() - provCfgCache.at < 60_000) return provCfgCache.cfg;
  try {
    const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data, error } = await db.from("platform_config").select("key, value").in("key", ["bill_provider", "bill_provider_failover"]);
    if (error) throw error;
    const m: Record<string, string> = {};
    for (const r of (data ?? []) as { key: string; value: string }[]) m[r.key] = r.value;
    const cfg = parseProviderConfig(m);
    provCfgCache = { at: Date.now(), cfg };
    return cfg;
  } catch (e) {
    console.warn("[provider] config unavailable — ClubKonnect main, failover on:", (e as Error).message);
    return DEFAULT_PROVIDER_CONFIG;   // not cached, so a DB blip doesn't stick for a minute
  }
}

// VTpass health: a lookup of an order that can't exist — "no such order" = up; our account refused / error page = down.
let vtHealthCache: { at: number; state: Health } | null = null;
async function vtHealth(): Promise<Health> {
  if (!vtConfigured(VT)) return "unknown";
  if (vtHealthCache && Date.now() - vtHealthCache.at < 60_000) return vtHealthCache.state;
  const now = Date.now();
  const d = await vtCall(vtFetch, VT, "POST", "/requery", { request_id: vtRequestId(`KUDIAI-HEALTH-${now}`, now) }, 8000);
  const state = vtProbeVerdict(d);
  vtHealthCache = { at: Date.now(), state };
  return state;
}

// ClubKonnect health for one service: its purchase script (made-up-account probe; a working V3 backup counts as up)
// and the purchase service behind the login (purchaseServiceHealth). Off with the health-check switch → "unknown".
async function ckHealth(svc: string): Promise<Health> {
  const rc = await routeConfig();
  if (!rc.healthcheckOn) return "unknown";
  const route = PREFLIGHT_ROUTE[svc];
  // Only the made-up-account probe decides (see bill-preflight: the must-refuse-order probe gives false "down"s).
  const main = route ? await routeHealth(route[1]) : "unknown";
  let mainDown = main === "down";
  if (mainDown && route && rc.fallbackOn && rc.fallbackServices.has(route[0]) && (await routeHealth(V3_PATH[route[1]])) === "up") mainDown = false;
  if (mainDown) return "down";
  return main === "up" ? "up" : "unknown";
}

/** Providers to try for a NEW order of this service, in order (a retry of an existing order follows its claim instead). */
async function providerOrderFor(svc: string): Promise<Provider[]> {
  const cfg = await providerConfig();
  const usable = vtUsable();
  const needHealth = usable && VT_SERVICES.has(svc) && cfg.failover;
  const [ck_, vt_]: Health[] = needHealth ? await Promise.all([ckHealth(svc), vtHealth()]) : ["unknown", "unknown"];
  return providerOrder(svc, cfg, { vtUsable: usable, health: { clubkonnect: ck_, vtpass: vt_ } });
}

// The claim row (bill_provider_attempts): null when it can't be read or written.
async function claimProvider(rid: string, svc: string, provider: Provider, expect: Provider[], vtRid: string) {
  try {
    const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data, error } = await db.rpc("bill_provider_claim", { p_request_id: rid, p_service: svc, p_provider: provider, p_expect: expect, p_vt_request_id: vtRid });
    if (error) throw error;
    const r = data as { providers?: unknown[]; vt_request_id?: string | null } | null;
    const providers = (r?.providers ?? []).filter((p): p is Provider => p === "clubkonnect" || p === "vtpass");
    return providers.length ? { providers, vtRequestId: r?.vt_request_id ?? null } : null;
  } catch (e) { console.warn(`[provider] claim failed for ${rid}:`, (e as Error).message); return null; }
}
async function readClaim(rid: string): Promise<{ providers: Provider[]; vtRequestId: string | null } | null | "error"> {
  try {
    const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data, error } = await db.from("bill_provider_attempts").select("providers, vt_request_id").eq("request_id", rid).maybeSingle();
    if (error) {
      if (/does not exist|schema cache|PGRST205|42P01/i.test(error.message)) return null;   // table not there yet = no claims yet
      throw error;
    }
    if (!data) return null;
    const providers = ((data as { providers?: unknown[] }).providers ?? []).filter((p): p is Provider => p === "clubkonnect" || p === "vtpass");
    return providers.length ? { providers, vtRequestId: (data as { vt_request_id?: string | null }).vt_request_id ?? null } : null;
  } catch (e) { console.warn(`[provider] claim read failed for ${rid}:`, (e as Error).message); return "error"; }
}

const SWITCH_HINT = "Admin portal → Bill provider shows both providers' health and switches the main one.";
function sendSwitchAlert(e: SwitchEvent) {
  if (e.outcome === "failover") {
    return sendBillAlert({
      type: "warning", title: "Bills moved to the backup provider",
      what: `${PROVIDER_LABEL[e.to]} took a ${e.svc} order because ${PROVIDER_LABEL[e.from]} couldn't (it confirmed it holds no order for it).`,
      hint: SWITCH_HINT, emailHint: SWITCH_HINT,
    }, { svc: e.svc, outcome: e.outcome, detail: e.detail });
  }
  return sendBillAlert({
    type: "error", title: `${PROVIDER_LABEL[e.provider]} is failing bill orders`,
    what: `${PROVIDER_LABEL[e.provider]} couldn't take a ${e.svc} order for a reason on our side (an error page, our wallet, our keys …). No order was created there.`,
    hint: SWITCH_HINT, emailHint: SWITCH_HINT,
  }, { svc: e.svc, outcome: e.outcome, detail: e.detail });
}

/**
 * Wiring for one order: the claim (keeping the STORED VTpass request_id for retries), the ClubKonnect purchase and
 * lookup, and VTpass /pay + /requery. VTpass is refused outright unless it's live — even for an order already claimed
 * for it (then it's held, never sent to the sandbox and never elsewhere).
 */
function providerDeps(svc: string, rid: string, ckKey: string, ckCall: () => Promise<CkResult>, vtBody: Record<string, unknown> | null): BuyDeps & { vtRid: () => string } {
  let vtRid = vtRequestId(rid, Date.now());
  const notLive: VtResult = { _unreachable: true, _error: "VTpass is not live" };
  return {
    claim: async (p, expect) => {
      const r = await claimProvider(rid, svc, p, expect, vtRid);
      if (r?.vtRequestId) vtRid = r.vtRequestId;
      return r ? r.providers : null;
    },
    ck: ckCall,
    ckLookup: () => lookupOrder(ckKey, rid),
    vtPay: async () => (vtUsable() && vtBody ? await vtCall(vtFetch, VT, "POST", "/pay", { request_id: vtRid, ...vtBody }, 60_000) : notLive),
    vtRequery: async () => (vtUsable() ? await vtCall(vtFetch, VT, "POST", "/requery", { request_id: vtRid }, 30_000) : notLive),
    isOk,
    alert: (e) => afterResponse(sendSwitchAlert(e)),
    vtRid: () => vtRid,   // the VTpass request_id this order goes under (the stored one on a retry)
  };
}

/** Where catalogues and customer checks come from right now: the provider new orders of this service go to. */
async function catalogueProvider(svc: string): Promise<Provider> {
  return vtUsable() ? (await providerOrderFor(svc))[0] : "clubkonnect";
}
/** VTpass's catalogue for a service in the app's plan shape (ids tagged "vt:"); [] when it can't be read. */
async function vtCatalogue(sid: string) {
  return parseVariations(await vtCall(vtFetch, VT, "GET", `/service-variations?serviceID=${encodeURIComponent(sid)}`, undefined, 20_000));
}

type CustomerCheck = { kind: "ok"; name: string; address: string } | { kind: "invalid"; message: string } | { kind: "unavailable" };
async function vtCheckCustomer(sid: string, billersCode: string, type?: string): Promise<CustomerCheck> {
  if (!vtUsable()) return { kind: "unavailable" };
  return vtCustomer(await vtCall(vtFetch, VT, "POST", "/merchant-verify", { billersCode, serviceID: sid, ...(type ? { type } : {}) }, 30_000));
}
/** Ask the provider in use first; if it can't answer (down, keys refused), ask the other. A clear "not a valid number" is final. */
async function checkCustomer(svc: string, vtCheck: (() => Promise<CustomerCheck>) | null, ckCheck: () => Promise<CustomerCheck>): Promise<CustomerCheck> {
  const order = !vtCheck ? [ckCheck] : (await catalogueProvider(svc)) === "vtpass" ? [vtCheck, ckCheck] : [ckCheck, vtCheck];
  let last: CustomerCheck = { kind: "unavailable" };
  for (const check of order) {
    last = await check().catch((): CustomerCheck => ({ kind: "unavailable" }));
    if (last.kind !== "unavailable") return last;
  }
  return last;
}
/** ClubKonnect's verify answer as a CustomerCheck: an error page / refused key says nothing about the number. */
function ckCustomer(d: Record<string, unknown>, invalidMessage: string): CustomerCheck {
  if (typeof d?._raw === "string") return { kind: "unavailable" };
  const statusStr = String(d?.status ?? d?.Status ?? "").toUpperCase();
  if (/INVALID_CREDENTIALS|INVALID_APICREDENTIALS|MISSING_CREDENTIALS|INVALID_KEY|UNAUTHORIZED/.test(statusStr)) return { kind: "unavailable" };
  const name = String(d?.customer_name ?? d?.CustomerName ?? d?.CUSTOMER_NAME ?? "").trim();
  if (!name || name.toUpperCase().includes("INVALID")) return { kind: "invalid", message: invalidMessage };
  const address = String(d?.customer_address ?? d?.CustomerAddress ?? d?.CUSTOMER_ADDRESS ?? d?.address ?? d?.Address ?? d?.meter_address ?? "").trim();
  return { kind: "ok", name, address };
}
const CHECK_UNAVAILABLE = "We couldn't check this number right now. Please try again shortly.";

// ClubKonnect's WAEC / JAMB package lists (prices + product codes; logic + tests in _shared/examCatalogue.ts), cached 10
// minutes. `ok` = ClubKonnect actually answered with a list (an empty JAMB list means nothing on sale, not an outage).
const examCatCache = new Map<string, { at: number; ok: boolean; products: ExamProduct[] }>();
async function ckExamCatalogue(exam: "waec" | "jamb"): Promise<{ ok: boolean; products: ExamProduct[] }> {
  const hit = examCatCache.get(exam);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit;
  const raw = await ck(exam === "waec" ? "APIWAECPackagesV2.asp" : "APIJAMBPackagesV2.asp", { APIKey: exam === "waec" ? WAEC_K : JAMB_K },
    { retries: 1, timeoutMs: 15000 }).catch(() => null);
  const ok = !!raw && Array.isArray((raw as Record<string, unknown>).EXAM_TYPE);
  const entry = { at: Date.now(), ok, products: ok ? parseCkExamCatalogue(raw) : [] };
  if (ok) examCatCache.set(exam, entry);   // failures aren't cached, so the next ask tries again
  return entry;
}

// A VTpass order's reference is its VTpass request_id ("<Lagos date+time>KDT…"): what VTpass support searches by, and
// how electricity-query tells a VTpass order from a ClubKonnect one.
const VT_REF = /^\d{12}KDT[A-Za-z0-9]*$/;

/** A VTpass (or nothing-sent) outcome as the purchase answer the app and webhooks already understand. */
function vtAnswer(cat: string, out: Exclude<BuyOutcome, { via: "clubkonnect" }>, rid: string, userId: string | null, vtRid = "") {
  if (out.via === "none") return json({ error: out.message });
  if (out.state === "delivered") {
    const t = vtTxn(out.data);
    const cost = vtCostKobo(out.data);
    const face = Math.round((Number(t.amount ?? out.data.amount) || 0) * 100);
    // (only airtime and data record a per-order cost — every other bill's cost is derived from the sale, as for ClubKonnect)
    if (cost && (cat === "airtime" || cat === "data")) afterResponse(recordBillCost(cat, rid, userId, out.data, async () => ({ costKobo: cost, faceKobo: face || cost, basis: "provider_reported", estimated: false }), { provider: "vtpass" }));
    const reference = String(out.data.requestId ?? vtRid ?? t.transactionId ?? "");
    const extra = cat === "waec" ? { cardDetails: vtCardDetails(out.data) } : {};
    return json({ status: "SUCCESS", reference, ...extra, message: "ORDER_COMPLETED", provider: "vtpass" });
  }
  // pending: the wording matches the app's "confirming your order" pattern (PENDING_STATUS) → it holds and verifies.
  // failed: a clean message → the customer is refunded.
  return json({ error: out.message, _provider: "vtpass", _vt: { code: vtCode(out.data) || null, status: vtTxnStatus(out.data) || null } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Parse body first — action determines auth requirements
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json({ error: "Invalid JSON body" }); }
  const { action } = body as { action: string };

  // Caller-stable idempotency key. The client/webhook pass the pending_bills
  // reference (KDT-BILL-…) so a retry — from ck() below, from the client after a
  // dropped invoke, or from the `verify` action — hits CK with the same RequestID
  // and CK returns the existing order rather than fulfilling twice.
  const rid = String((body as Record<string, unknown>).requestId ?? "").trim().slice(0, 64) || reqId();

  // Operator actions expose the provider account itself (wallet balance, account id + phone, credentials health) or
  // e-mail the admins, and nothing in the app calls them — only the admin portal / server code, always with the
  // service-role key. This function is deployed --no-verify-jwt, so the gateway does NOT check anything for us:
  // these MUST be gated here (they used to be reachable by anyone on the internet with no credentials at all).
  let callerUser: { id: string } | null = null;   // set for ordinary logged-in callers; stays null for server (service-role) calls
  const SERVICE_ONLY = new Set(["wallet-balance", "connectivity-check", "wallet-balance-alert", "health-check", "data-probe", "refresh-ck-prices", "price-list", "route-check", "vtpass-probe", "provider-status", "vtpass-sandbox-proof", "vtpass-explore", "ck-variants"]);
  // Public catalogue lookups (plan lists) stay open; purchase / write actions require the service key OR a user JWT.
  const READ_ONLY = new Set(["data-plans", "cabletv-plans", "waec-packages", "jamb-packages", "exam-price"]);
  if (SERVICE_ONLY.has(action)) {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!(await isServiceCall(token))) return unauthorized();
  } else if (!READ_ONLY.has(action)) {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return unauthorized();

    if (!(SERVICE_KEY && timingSafeEqual(token, SERVICE_KEY))) {
      if (!SUPABASE_URL || !ANON_KEY) return unauthorized();
      const sb = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
      const { data: { user }, error } = await sb.auth.getUser(token);
      if (error || !user) return unauthorized();
      callerUser = { id: user.id };
    }
  }

  // A logged-in user asking to BUY something: the server must be able to see that it is paid for (see _shared/billGate.ts).
  // Server-to-server calls (the payment webhooks) run their own checks and are not gated here.
  if (callerUser && PURCHASE_ACTIONS.has(action)) {
    const gate = await checkBillGate(makeGateDeps(), callerUser, action, body);
    if (!gate.ok) return json({ error: gate.message, _gate: gate.reason });
  }

  try {

    // ── Airtime ───────────────────────────────────────────────────────────────
    if (action === "airtime") {
      const { phone, network, amount } = body as { phone: string; network: string; amount: string };
      if (!phone || !network || !amount) return json({ error: "phone, network and amount required" });
      const netId = NET_ID[network];
      if (!netId) return json({ error: `Unknown network: ${network}` });
      // ClubKonnect or VTpass (the admin's main provider, with failover) — see "Bill provider switch" above
      const digits = phone.replace(/\D/g, "");
      const sid = airtimeServiceId(network);
      const pd = providerDeps("airtime", rid, AIRTIME_K,
        () => ckBuy("airtime", "APIAirtimeV1.asp", {
          APIKey: AIRTIME_K, MobileNetwork: netId, Amount: String(amount),
          MobileNumber: digits, RequestID: rid, CallBackURL: "https://kudiai.app/",
        }),
        sid ? vtAirtimeBody(sid, Number(amount), digits) : null);
      const out = await buyAcrossProviders("airtime", sid ? await providerOrderFor("airtime") : ["clubkonnect"], pd);
      if (out.via !== "clubkonnect") return vtAnswer("airtime", out, rid, callerUser?.id ?? null, pd.vtRid());
      const data = out.data;
      if (!isOk(data)) return json({ error: errMsg(data, "Airtime purchase failed"), _raw: data });
      afterResponse(recordBillCost("airtime", rid, callerUser?.id ?? null, data, async (d) => airtimeCost(amount, networkName(network, netId), d, data)));
      return json({ status: "SUCCESS", reference: String(data.orderid ?? data.requestid ?? ""), message: String(data.status ?? "ORDER_RECEIVED") });
    }

    // ── Data plans ────────────────────────────────────────────────────────────
    if (action === "data-plans") {
      const { network } = body as { network: string };
      const isPrint = (body as { print?: unknown }).print === true || (body as { print?: unknown }).print === "true";
      // The catalogue comes from the provider new data orders go to right now; each plan id says which provider it
      // belongs to, so the purchase goes back there. Print Data (PINs) is ClubKonnect-only.
      if (!isPrint && (await catalogueProvider("data")) === "vtpass") {
        const sid = dataServiceId(network);
        const vtPlans = sid ? await vtCatalogue(sid) : [];
        if (vtPlans.length) {
          const cfg = await priceConfig();
          const priced = applyDataPrices(vtPlans, network, cfg.selling);
          return json({ plans: priced, _count: priced.length, _provider: "vtpass" });
        }
        console.warn(`[data-plans] VTpass catalogue empty for ${network} — showing ClubKonnect's`);   // its plans buy on ClubKonnect
      }
      const netId = NET_ID[network] ?? "01";
      const data = await ck("APIDatabundlePlansV2.asp", { APIKey: DATA_K, MobileNetwork: netId });
      if (data?.status && String(data.status).includes("INVALID")) return json({ error: `Data API key error: ${data.status}`, plans: [] });

      // Response format: { MOBILE_NETWORK: { MTN: [{ ID, PRODUCT: [{PRODUCT_CODE, PRODUCT_NAME, PRODUCT_AMOUNT}] }] } }
      // Key names vary by API version (e.g. "Airtel" vs "AIRTEL"), so match case-insensitively
      const mobileNet = data?.MOBILE_NETWORK as Record<string, Record<string, unknown>[]> | undefined;
      let plans: { plan_id: string; plan_name: string; plan_amount: number }[] = [];

      // 9mobile is sometimes labelled "Etisalat" (former name) in CK responses
      const ALIASES: Record<string, string[]> = {
        "9mobile": ["9mobile","9MOBILE","m_9mobile","M_9MOBILE","etisalat","ETISALAT","Etisalat","emts","EMTS"],
      };

      let _sampleProduct: unknown = null; // for debug logging

      if (mobileNet) {
        const allKeys = Object.keys(mobileNet);
        const matchedKey = allKeys.find(k => k.toUpperCase() === network.toUpperCase())
          ?? allKeys.find(k => k.replace(/\W/g,"").toUpperCase() === network.replace(/\W/g,"").toUpperCase())
          ?? (ALIASES[network] ?? []).reduce<string|undefined>(
               (found, alias) => found ?? allKeys.find(k => k.toLowerCase() === alias.toLowerCase()),
               undefined
             );
        const groups = (matchedKey ? mobileNet[matchedKey] : []) ?? [];
        for (const group of groups) {
          const products = (group?.PRODUCT ?? []) as Record<string, unknown>[];
          for (const p of products) {
            if (!_sampleProduct) _sampleProduct = p; // capture first product for debug
            // PRODUCT_ID is the MB-size value CK's V1 purchase endpoint accepts as DataPlan (e.g. "500", "1000", "2000")
            // PRODUCT_CODE and PRODUCT_SNO are internal indexes rejected by the purchase endpoint
            const pid = String(p.DataPlan ?? p.PRODUCT_ID ?? p.PRODUCT_CODE ?? "");
            if (pid) plans.push({
              plan_id:     pid,
              plan_name:   String(p.PRODUCT_NAME ?? p.DataPlanName ?? ""),
              plan_amount: Math.round(Number(p.PRODUCT_AMOUNT ?? p.Price ?? 0) * 100) / 100,
            });
          }
        }
      } else {
        // Fallback for older / flat response shapes
        const raw: unknown[] = Array.isArray(data) ? data
          : (data?.DataBundlePlans ?? data?.response ?? data?.DataPlans ?? data?.plans ?? data?.data ?? []) as unknown[];
        plans = (raw as Record<string, unknown>[]).map(p => {
          if (!_sampleProduct) _sampleProduct = p;
          return {
            plan_id:     String(p.DataPlan ?? p.PRODUCT_ID ?? p.PRODUCT_CODE ?? p.id ?? ""),
            plan_name:   String(p.DataPlanName ?? p.PRODUCT_NAME ?? p.name ?? ""),
            plan_amount: Math.round(Number(p.Price ?? p.PRODUCT_AMOUNT ?? p.amount ?? 0) * 100) / 100,
          };
        }).filter(p => p.plan_id && p.plan_id !== "undefined");
      }

      console.log(`data-plans [${network}] sample product:`, JSON.stringify(_sampleProduct));
      console.log(`data-plans [${network}] extracted ${plans.length} plans. first:`, JSON.stringify(plans[0]));

      if (!plans.length) {
        const availableKeys = mobileNet ? Object.keys(mobileNet).join(", ") : "none";
        return json({ plans: [], error: `No plans for "${network}". API keys: [${availableKeys}]. Raw: ${JSON.stringify(data).slice(0,200)}` });
      }
      // What customers pay: the owner's selling price (Print Data: minus the print discount), not the provider price. cost_amount keeps the provider price.
      const cfg = await priceConfig();
      const priced = applyDataPrices(plans, network, cfg.selling, { print: isPrint, printDiscountPct: cfg.printPct });
      return json({ plans: priced, _count: priced.length, _sample: _sampleProduct });
    }

    // ── Data purchase ─────────────────────────────────────────────────────────
    if (action === "data") {
      const { phone, network, planId } = body as { phone: string; network: string; planId: string };
      if (!phone || !network || !planId) return json({ error: "phone, network and planId required" });
      const netId = NET_ID[network];
      if (!netId) return json({ error: `Unknown network: ${network}` });
      console.log(`data purchase: net=${netId} plan=${planId} phone=${phone.replace(/\D/g,"").slice(-4)}`);
      // A plan belongs to the provider whose catalogue listed it ("vt:…" = VTpass), so the order goes there and only there.
      const digits = phone.replace(/\D/g, "");
      const vtPlan = isVtPlan(planId);
      const sid = dataServiceId(network);
      if (vtPlan && (!vtUsable() || !sid)) return json({ error: "This data plan is no longer available. Please reload the plans and try again." });
      const pd = providerDeps("data", rid, DATA_K,
        () => ckBuy("data", "APIDatabundleV1.asp", {
          APIKey: DATA_K, MobileNetwork: netId, DataPlan: planId,
          MobileNumber: digits, RequestID: rid, CallBackURL: "https://kudiai.app/",
        }),
        vtPlan && sid ? vtDataBody(sid, vtPlanCode(planId), digits) : null);
      const out = await buyAcrossProviders("data", vtPlan ? ["vtpass"] : ["clubkonnect"], pd);
      if (out.via !== "clubkonnect") return vtAnswer("data", out, rid, callerUser?.id ?? null, pd.vtRid());
      const data = out.data;
      console.log(`data purchase result:`, JSON.stringify(data).slice(0, 500));
      if (!isOk(data)) return json({ error: `${errMsg(data, "Data purchase failed")} [net:${netId} plan:${planId}]`, _raw: data });
      afterResponse(recordBillCost("data", rid, callerUser?.id ?? null, data, async () =>
        dataCost(await providerPlanPrice("data", DATA_K, netId, networkName(network, netId) ?? network, planId).catch(() => null), 1, data)));
      return json({ status: "SUCCESS", reference: String(data.orderid ?? data.requestid ?? ""), message: String(data.status ?? "ORDER_RECEIVED") });
    }

    // ── Data purchase diagnostic (test without real phone to isolate plan ID format) ──
    if (action === "data-probe") {
      const { network, planId } = body as { network: string; planId: string };
      const netId = NET_ID[network] ?? "01";
      const dummy = "08000000000";
      const probeRid = reqId();
      // Try V1 and V3 with the given planId and a dummy phone
      const [v1, v3] = await Promise.all([
        ck("APIDatabundleV1.asp", { APIKey: DATA_K, MobileNetwork: netId, DataPlan: planId, MobileNumber: dummy, RequestID: probeRid + "A", CallBackURL: "https://kudiai.app/" }),
        ck("APIDatabundleV3.asp", { APIKey: DATA_K, MobileNetwork: netId, DataPlan: planId, MobileNumber: dummy, RequestID: probeRid + "B", CallBackURL: "https://kudiai.app/" }),
      ]);
      console.log("data-probe v1:", JSON.stringify(v1));
      console.log("data-probe v3:", JSON.stringify(v3));
      return json({ netId, planId, v1_status: v1.status ?? v1.Status, v1_raw: v1, v3_status: v3.status ?? v3.Status, v3_raw: v3 });
    }

    // ── Cable TV providers ────────────────────────────────────────────────────
    if (action === "cable-providers") {
      const data = await ck("APICableTVTypeV2.asp", { APIKey: CABLETV_K });
      return json({ providers: data });
    }

    // ── Cable TV packages ─────────────────────────────────────────────────────
    if (action === "cable-packages") {
      const { provider } = body as { provider: string };
      if (!provider) return json({ error: "provider required" });
      // From the provider cable orders go to right now (DStv / GOtv / StarTimes can be VTpass; Showmax is ClubKonnect only).
      // A VTpass bouquet's id is tagged "vt:", so the purchase goes back to VTpass.
      if (VT_CABLE.has(provider) && (await catalogueProvider("cable")) === "vtpass") {
        const vtPkgs = await vtCatalogue(provider);
        if (vtPkgs.length) return json({ packages: vtPkgs.map((p) => ({ package_id: p.plan_id, package_name: p.plan_name, package_amount: p.plan_amount })), _provider: "vtpass" });
        console.warn(`[cable-packages] VTpass catalogue empty for ${provider} — showing ClubKonnect's`);
      }
      const data = await ck("APICableTVPackagesV2.asp", { APIKey: CABLETV_K, CableTV: provider });
      if (data?.status && String(data.status).includes("INVALID")) return json({ error: `Cable API key error: ${data.status}`, packages: [] });

      // Response format: { TV_ID: { DStv: [{ ID, PRODUCT: [{PACKAGE_ID, PACKAGE_NAME, PACKAGE_AMOUNT}] }] } }
      const TV_KEY: Record<string, string> = { dstv: "DStv", gotv: "GOtv", startimes: "StarTimes", showmax: "Showmax" };
      const tvId = data?.TV_ID as Record<string, Record<string, unknown>[]> | undefined;
      let packages: { package_id: string; package_name: string; package_amount: number }[] = [];

      if (tvId) {
        const tvKey = TV_KEY[provider] ?? provider;
        const groups = tvId[tvKey] ?? Object.values(tvId)[0] ?? [];
        for (const group of groups) {
          for (const p of ((group?.PRODUCT ?? []) as Record<string, unknown>[])) {
            const pid = String(p.PACKAGE_ID ?? p.PRODUCT_CODE ?? p.id ?? "");
            if (pid) packages.push({
              package_id:     pid,
              package_name:   String(p.PACKAGE_NAME ?? p.PRODUCT_NAME ?? ""),
              package_amount: Number(p.PACKAGE_AMOUNT ?? p.PRODUCT_AMOUNT ?? 0),
            });
          }
        }
      } else {
        const raw: unknown[] = Array.isArray(data) ? data
          : (data?.Packages ?? data?.packages ?? data?.CableTVPackages ?? data?.response ?? data?.data ?? []) as unknown[];
        packages = (raw as Record<string, unknown>[]).map(p => ({
          package_id:     String(p.PACKAGE_ID ?? p.PackageCode ?? p.id ?? ""),
          package_name:   String(p.PACKAGE_NAME ?? p.PackageName ?? p.name ?? ""),
          package_amount: Number(p.PACKAGE_AMOUNT ?? p.Price ?? p.amount ?? 0),
        })).filter(p => p.package_id && p.package_id !== "undefined");
      }

      if (!packages.length) return json({ packages: [], error: `No packages returned: ${JSON.stringify(data).slice(0, 200)}` });
      return json({ packages });
    }

    // ── Cable TV verify smartcard ─────────────────────────────────────────────
    if (action === "cable-verify") {
      const { provider, smartcard } = body as { provider: string; smartcard: string };
      if (!provider || !smartcard) return json({ error: "provider and smartcard required" });
      const r = await checkCustomer("cable",
        VT_CABLE.has(provider) ? () => vtCheckCustomer(provider, smartcard) : null,
        async () => {
          const data = await ck("APIVerifyCableTVV1.asp", { APIKey: CABLETV_K, CableTV: provider, SmartCardNo: smartcard });
          console.log("cable-verify raw:", JSON.stringify(data).slice(0, 400));
          return ckCustomer(data, `Smartcard not found (${smartcard}). Check the number and selected provider.`);
        });
      if (r.kind === "ok") return json({ customer_name: r.name });
      return json({ error: r.kind === "invalid" ? r.message : CHECK_UNAVAILABLE });
    }

    // ── Cable TV purchase ─────────────────────────────────────────────────────
    if (action === "cable") {
      const { provider, packageId, smartcard, phone } = body as { provider: string; packageId: string; smartcard: string; phone: string };
      if (!provider || !packageId || !smartcard || !phone) return json({ error: "provider, packageId, smartcard and phone required" });
      // A bouquet from VTpass's list is bought on VTpass and only there (bouquet codes aren't interchangeable).
      if (isVtPlan(packageId)) {
        if (!vtUsable() || !VT_CABLE.has(provider)) return json({ error: "This package is no longer available. Please reload the packages and try again." });
        const pd = providerDeps("cable", rid, CABLETV_K, () => Promise.reject(new Error("not a ClubKonnect package")),
          vtCableBody(provider, smartcard.trim(), vtPlanCode(packageId), phone.replace(/\D/g, "")));
        const out = await buyAcrossProviders("cable", ["vtpass"], pd);
        if (out.via === "clubkonnect") return json({ error: "This package is no longer available. Please reload the packages and try again." });
        return vtAnswer("cable", out, rid, callerUser?.id ?? null, pd.vtRid());
      }
      const data = await ckBuy("cable", "APICableTVV1.asp", {
        APIKey: CABLETV_K, CableTV: provider, Package: packageId,
        SmartCardNo: smartcard, PhoneNo: phone.replace(/\D/g, ""),
        RequestID: rid, CallBackURL: "https://kudiai.app/",
      });
      if (!isOk(data)) return json({ error: errMsg(data, "Cable TV subscription failed"), _raw: data });
      return json({ status: "SUCCESS", reference: String(data.orderid ?? data.requestid ?? ""), message: String(data.status ?? "ORDER_RECEIVED") });
    }

    // ── Electricity providers ─────────────────────────────────────────────────
    if (action === "electricity-providers") {
      const data = await ck("APIElectricityTypeV2.asp", { APIKey: ELECTRICITY_K });
      return json({ providers: data });
    }

    // ── Electricity verify meter ──────────────────────────────────────────────
    if (action === "electricity-verify") {
      const { company, meterNo, meterType } = body as { company: string; meterNo: string; meterType: string };
      if (!company || !meterNo || !meterType) return json({ error: "company, meterNo and meterType required" });
      const sid = VT_ELECTRIC[company], mt = vtMeterType(meterType);
      const r = await checkCustomer("electricity",
        sid && mt ? () => vtCheckCustomer(sid, meterNo.trim(), mt) : null,
        async () => {
          const data = await ck("APIVerifyElectricityV1.asp", { APIKey: ELECTRICITY_K, ElectricCompany: company, MeterNo: meterNo, MeterType: meterType });
          console.log("electricity-verify raw:", JSON.stringify(data).slice(0, 400));
          return ckCustomer(data, `Meter not found (${meterNo}). Check the number and selected company.`);
        });
      if (r.kind === "ok") return json({ customer_name: r.name, customer_address: r.address || null });
      return json({ error: r.kind === "invalid" ? r.message : CHECK_UNAVAILABLE });
    }

    // ── Electricity purchase ──────────────────────────────────────────────────
    // ── Electricity token extraction helper (shared by purchase + query) ─────────
    function extractElecToken(d: Record<string, unknown>): string {
      // 1. Check all known field names at top level
      const NAMED_KEYS = [
        "token", "Token", "metertoken", "MeterToken", "Metertoken", "meter_token",
        "electricity_token", "ElectricityToken", "tokencode", "TokenCode",
        "ElecToken", "electoken", "Electoken", "METERTOKEN", "METER_TOKEN",
        "vend_token", "VendToken", "recharge_token", "RechargeToken",
        "Rechargetoken", "rechargetoken", "receipt_no", "ReceiptNo",
        "receiptno", "Receiptno", "pin", "Pin", "ELEC_TOKEN", "elec_token",
        "vendtoken", "Vendtoken", "VENDtoken",
      ];
      for (const k of NAMED_KEYS) {
        const v = (d as Record<string, unknown>)[k];
        if (v != null) {
          const s = String(v).trim();
          if (s && s !== "null" && s !== "undefined" && s.length >= 4) return s;
        }
      }
      // 2. Deep-scan every value for EXACTLY 20-digit strings (Nigerian STS token standard)
      // STS tokens are always 20 digits — using 16+ was too broad and caught other IDs
      const SKIP = new Set([
        "statuscode", "StatusCode", "status", "Status", "orderid", "OrderID",
        "requestid", "RequestID", "amount", "Amount", "units", "Units",
        "phoneno", "PhoneNo", "meterno", "MeterNo", "userid", "UserID",
        "electriccompany", "ElectricCompany", "metertype", "MeterType",
        "callbackurl", "CallBackURL", "_http",
      ]);
      function deepScan(obj: Record<string, unknown>, depth: number): string {
        if (depth > 4) return "";
        for (const [k, v] of Object.entries(obj)) {
          if (SKIP.has(k)) continue;
          if (typeof v === "string" || typeof v === "number") {
            // Strip spaces/dashes (tokens often come as "XXXX XXXX XXXX XXXX XXXX")
            const clean = String(v).replace(/[\s\-]/g, "");
            if (/^\d{20}$/.test(clean)) return String(v).trim();
          }
          if (v !== null && typeof v === "object" && !Array.isArray(v)) {
            const found = deepScan(v as Record<string, unknown>, depth + 1);
            if (found) return found;
          }
        }
        return "";
      }
      const scanned = deepScan(d, 0);
      if (scanned) return scanned;
      // 3. Fallback: parse _raw string for exactly 20-digit token if JSON was unparseable
      if (typeof d._raw === "string") {
        const m = d._raw.match(/\b(\d{20})\b/);
        if (m) return m[1];
      }
      return "";
    }

    function elecStatusCode(d: Record<string, unknown>): string {
      return String(d?.statuscode ?? d?.StatusCode ?? "").trim();
    }
    function elecStat(d: Record<string, unknown>): string {
      return String(d?.status ?? d?.Status ?? "").toUpperCase().trim();
    }
    // CK uses "transactionstatus" inside TXN_HISTORY responses for the inner order state
    function elecTxnStat(d: Record<string, unknown>): string {
      return String(d?.transactionstatus ?? d?.TransactionStatus ?? d?.status ?? d?.Status ?? "").toUpperCase().trim();
    }

    if (action === "electricity") {
      const { company, meterType, meterNo, amount, phone } = body as { company: string; meterType: string; meterNo: string; amount: string; phone: string };
      if (!company || !meterType || !meterNo || !amount || !phone) return json({ error: "All electricity fields required" });
      const amt = parseFloat(amount);
      if (amt < 1000) return json({ error: "Minimum electricity amount is ₦1,000" });
      if (amt > 200000) return json({ error: "Maximum electricity amount is ₦200,000" });

      // ClubKonnect or VTpass (the admin's main provider, with failover — an electricity order is amount-based, so it can
      // move either way). ClubKonnect's answer carries on through its own token logic below, exactly as before.
      const sid = VT_ELECTRIC[company], mt = vtMeterType(meterType);
      const pd = providerDeps("electricity", rid, ELECTRICITY_K,
        () => ckBuy("electricity", "APIElectricityV1.asp", {
          APIKey: ELECTRICITY_K, ElectricCompany: company, MeterType: meterType,
          MeterNo: meterNo, Amount: String(amount), PhoneNo: phone.replace(/\D/g, ""),
          RequestID: rid, CallBackURL: "https://kudiai.app/",
        }),
        sid && mt ? vtElectricBody(sid, meterNo.trim(), mt, amt, phone.replace(/\D/g, "")) : null);
      const bought = await buyAcrossProviders("electricity", sid && mt ? await providerOrderFor("electricity") : ["clubkonnect"], pd);
      if (bought.via === "none") return json({ error: bought.message });
      if (bought.via === "vtpass") {
        const ref = String(bought.data.requestId ?? pd.vtRid());
        if (bought.state === "failed") return json({ error: bought.message, _provider: "vtpass", _vt: { code: vtCode(bought.data) || null } });
        // postpaid still processing → the app's usual "confirming your order" path (verify settles it; there's no token to wait for)
        if (bought.state === "pending" && mt === "postpaid") return vtAnswer("electricity", bought, rid, callerUser?.id ?? null, ref);
        // prepaid still processing, or delivered before its token → the app keeps asking electricity-query with this reference
        const token = vtElectricToken(bought.data), units = vtElectricUnits(bought.data);
        if (bought.state === "pending" || (mt === "prepaid" && !token)) {
          return json({ status: "PENDING", reference: ref, token: "", message: bought.state === "pending" ? "ORDER_RECEIVED" : "ORDER_COMPLETED_NO_TOKEN", provider: "vtpass" });
        }
        return json({ status: "SUCCESS", reference: ref, token, units, message: "ORDER_COMPLETED", provider: "vtpass" });   // postpaid: no token, by nature
      }
      const data = bought.data;
      console.log("electricity purchase response:", JSON.stringify(data));

      // CK electricity uses "transactionid" (not "orderid") — must check both
      const orderId = String(
        data.orderid ?? data.OrderID ?? data.OrderId ??
        data.transactionid ?? data.TransactionID ?? data.transactionId ??
        data.requestid ?? data.RequestID ?? ""
      );
      const purchaseStat = elecStat(data);
      const isExplicitFail = FAIL_PATTERNS.some(p => purchaseStat.includes(p)) ||
        purchaseStat === "ORDER_CANCELLED" || purchaseStat === "CANCELLED" ||
        elecStatusCode(data).startsWith("5");

      // ── Priority 1: token present in the purchase response ───────────────
      // CK sometimes returns the token synchronously in the first call.
      // Check this BEFORE any status validation so we don't miss it.
      const immediateToken = extractElecToken(data);
      if (immediateToken && !isExplicitFail) {
        console.log("electricity: token found in purchase response:", immediateToken);
        return json({ status: "SUCCESS", reference: orderId, token: immediateToken, message: purchaseStat || "ORDER_COMPLETED" });
      }

      // ── Priority 2: hard failure ──────────────────────────────────────────
      if (!isOk(data) && !purchaseStat.includes("TXN_HISTORY")) {
        return json({ error: errMsg(data, "Electricity purchase failed"), _raw: data });
      }

      // ── Priority 3: TXN_HISTORY — previous order found, use its transactionid ──
      if (purchaseStat.includes("TXN_HISTORY")) {
        const txnStat = elecTxnStat(data); // inner order status (transactionstatus field)
        console.log("electricity TXN_HISTORY: orderId=%s txnStat=%s raw=%s", orderId, txnStat, JSON.stringify(data));
        if (orderId) {
          // If inner order is already completed, query once to get the token
          if (txnStat === "ORDER_COMPLETED" || txnStat === "SUCCESSFUL" || txnStat === "SUCCESS") {
            const q = await ck("APIQueryV1.asp", { APIKey: ELECTRICITY_K, OrderID: orderId }, { retries: 1, timeoutMs: 15000 });
            console.log("electricity TXN_HISTORY completed query:", JSON.stringify(q));
            const token = extractElecToken(q);
            if (token) return json({ status: "SUCCESS", reference: orderId, token, message: "ORDER_COMPLETED" });
            // Token not in query response — return PENDING so frontend keeps polling
            return json({ status: "PENDING", reference: orderId, token: "", message: "TXN_HISTORY_COMPLETED_NO_TOKEN" });
          }
          // Inner order still pending (ORDER_RECEIVED) — return PENDING so frontend polls
          if (!txnStat.includes("CANCEL") && !txnStat.includes("FAIL")) {
            return json({ status: "PENDING", reference: orderId, token: "", message: "TXN_HISTORY_PENDING" });
          }
        }
        // No usable ID or order failed — show check-meter message
        return json({ status: "TXN_HISTORY", reference: orderId, token: extractElecToken(data), message: "TXN_HISTORY" });
      }

      // ── Priority 4: ORDER_RECEIVED — poll until token arrives (max ~88s) ──
      let polledToken = "";
      let completedButNoToken = 0;
      for (let i = 0; i < 22; i++) {
        await new Promise(r => setTimeout(r, 4000));
        const q = await ck("APIQueryV1.asp", { APIKey: ELECTRICITY_K, OrderID: orderId }, { retries: 0, timeoutMs: 10000 }).catch(() => ({} as Record<string, unknown>));
        const qCode = elecStatusCode(q);
        const qStat = elecStat(q);
        const qToken = extractElecToken(q);
        console.log(`electricity poll #${i + 1}: code=${qCode} status=${qStat} token=${qToken || "(none)"} full=${JSON.stringify(q)}`);

        if (qToken) {
          return json({ status: "SUCCESS", reference: orderId, token: qToken, message: qStat || "ORDER_COMPLETED" });
        }
        if (qCode === "200" || qStat === "ORDER_COMPLETED" || qStat === "SUCCESSFUL" || qStat === "SUCCESS") {
          completedButNoToken++;
          console.log(`electricity poll #${i + 1}: completed status but no token yet (${completedButNoToken}/5)`);
          if (completedButNoToken >= 5) break;
          continue;
        }
        if (qCode.startsWith("5") || qStat === "ORDER_CANCELLED" || qStat === "CANCELLED") {
          return json({ error: errMsg(q, "Electricity order cancelled by provider"), _raw: q });
        }
      }
      return json({ status: "PENDING", reference: orderId, token: "", message: completedButNoToken > 0 ? "ORDER_COMPLETED_NO_TOKEN" : "ORDER_RECEIVED" });
    }

    // ── Electricity status query (frontend polls this when status=PENDING) ────────
    if (action === "electricity-query") {
      const { orderId } = body as { orderId: string };
      if (!orderId) return json({ error: "orderId required" });
      // A VTpass order (its reference is the VTpass request_id): ask VTpass.
      if (VT_REF.test(orderId)) {
        if (!vtUsable()) return json({ status: "PENDING", reference: orderId, token: "", message: "PROVIDER_UNAVAILABLE" });
        const rq = await vtCall(vtFetch, VT, "POST", "/requery", { request_id: orderId }, 20_000);
        const st = classifyVt(rq), token = vtElectricToken(rq);
        if (token) return json({ status: "SUCCESS", reference: orderId, token, units: vtElectricUnits(rq), message: "ORDER_COMPLETED" });
        // Only prepaid orders are polled here (a postpaid one takes the verify path), so delivered-without-token = token still coming.
        if (st === "delivered") return json({ status: "PENDING", reference: orderId, token: "", message: "ORDER_COMPLETED_NO_TOKEN" });
        if (st === "failed" || vtCode(rq) === "019") return json({ status: "CANCELLED", reference: orderId, token: "", message: vtMessage(rq) });
        return json({ status: "PENDING", reference: orderId, token: "", message: st === "pending" ? "ORDER_RECEIVED" : "CHECKING" });
      }
      const q = await ck("APIQueryV1.asp", { APIKey: ELECTRICITY_K, OrderID: orderId }, { retries: 1, timeoutMs: 15000 });
      console.log("electricity-query full response:", JSON.stringify(q));
      const qCode = elecStatusCode(q);
      const qStat = elecStat(q);
      const token = extractElecToken(q);
      // Return SUCCESS as soon as we have a token — regardless of status code
      if (token) {
        return json({ status: "SUCCESS", reference: orderId, token, message: qStat || "ORDER_COMPLETED" });
      }
      if (qCode === "200" || qStat === "ORDER_COMPLETED") {
        // Completed but CK didn't include the token in this poll — keep PENDING so frontend retries
        return json({ status: "PENDING", reference: orderId, token: "", message: "ORDER_COMPLETED_NO_TOKEN" });
      }
      if (qCode.startsWith("5") || qStat === "ORDER_CANCELLED") {
        return json({ status: "CANCELLED", reference: orderId, token: "", message: errMsg(q, "Order cancelled") });
      }
      return json({ status: "PENDING", reference: orderId, token: "", message: qStat });
    }

    // ── Requery a purchase by RequestID (or OrderID) ─────────────────────────────
    // Called by the client / webhook after a network failure to find out whether
    // ClubKonnect actually fulfilled. Fails safe: when CK can't be reached or the
    // answer is ambiguous it returns PENDING/UNKNOWN so the caller HOLDS rather
    // than refunding a delivered order.
    if (action === "verify") {
      const svc     = String((body as Record<string, unknown>).service ?? "").toLowerCase().trim();
      const orderId = String((body as Record<string, unknown>).orderId ?? "").trim();
      // Which provider(s) was this order sent to? No record = ClubKonnect only (every order from before the provider
      // switch, and every bill VTpass doesn't carry). The provider it was sent to LAST decides (see combineVerdicts).
      const claimRow = orderId ? null : await readClaim(rid);
      if (claimRow === "error") return json({ status: "UNKNOWN", requestId: rid, message: "verify unavailable: order record unreadable" });
      const providers: Provider[] = claimRow?.providers ?? ["clubkonnect"];
      const verdicts: ProviderVerdict[] = await Promise.all(providers.map(async (p): Promise<ProviderVerdict> => {
        if (p === "clubkonnect") { const b = await ckVerify(svc, orderId, rid); return { provider: p, state: b.status as ProviderVerdict["state"], body: b }; }
        const rq: VtResult = vtUsable()
          ? await vtCall(vtFetch, VT, "POST", "/requery", { request_id: claimRow?.vtRequestId ?? vtRequestId(rid, Date.now()) }, 30_000)
          : { _unreachable: true, _error: "VTpass is not live" };
        const state = vtVerify(rq);
        const t = vtTxn(rq);
        return {
          provider: p, state,
          body: state === "SUCCESS"
            ? { status: state, requestId: rid, reference: String(rq.requestId ?? t.transactionId ?? ""), token: svc === "electricity" ? vtElectricToken(rq) : "",
                cardDetails: svc === "waec" ? vtCardDetails(rq) : "", message: "ORDER_COMPLETED", provider: p }
            : { status: state, requestId: rid, message: state === "FAILED" ? vtMessage(rq) : state === "UNKNOWN" ? "VTpass unavailable" : state.toLowerCase(), provider: p, _vt: { code: vtCode(rq) || null, status: vtTxnStatus(rq) || null } },
        };
      }));
      return json(combineVerdicts(verdicts)!.body);
    }

    // ClubKonnect's side of `verify`: its lookup of one order (by RequestID, or OrderID when given). Fails safe — can't
    // reach ClubKonnect or can't read the answer → UNKNOWN / PENDING, so the caller HOLDS rather than refunding.
    async function ckVerify(svc: string, orderId: string, rid: string): Promise<Record<string, unknown>> {
      const KEY_BY_SVC: Record<string, string> = {
        airtime: AIRTIME_K, data: DATA_K, cable: CABLETV_K, electricity: ELECTRICITY_K,
        betting: BETTING_K, waec: WAEC_K, jamb: JAMB_K, spectranet: SPECTRANET_K,
        smile: SMILE_K, "print-airtime": PRINT_AIRTIME_K, "print-data": PRINT_DATA_K,
      };
      const apiKey = KEY_BY_SVC[svc] || AIRTIME_K;
      const qp: Record<string, string> = { APIKey: apiKey };
      if (orderId) qp.OrderID = orderId; else qp.RequestID = rid;

      let q: Record<string, unknown>;
      try {
        q = await ck("APIQueryV1.asp", qp, { retries: 2, timeoutMs: 20000 });
      } catch (e) {
        return { status: "UNKNOWN", requestId: rid, message: `verify unavailable: ${(e as Error).message}` };
      }

      const code = String(q?.statuscode ?? q?.StatusCode ?? "").trim();
      const stat = String(
        q?.status ?? q?.Status ?? q?.transactionstatus ?? q?.TransactionStatus ?? "",
      ).toUpperCase().trim();
      const token = extractElecToken(q);
      const cardDetails = String(q?.carddetails ?? q?.CardDetails ?? "");
      const vPins = (q?.TXN_EPIN ?? q?.TXN_EPIN_DATABUNDLE ?? []) as unknown[];

      // No order exists for this id — genuinely nothing was placed (same test the purchase fallback relies on)
      if (queryNotFound(q)) {
        return { status: "NOT_FOUND", requestId: rid, _raw: q };
      }

      // Explicit failure / cancellation
      if (FAIL_PATTERNS.some(p => stat.includes(p)) || stat.includes("CANCEL") || code.startsWith("5")) {
        return { status: "FAILED", requestId: rid, message: errMsg(q, "Order failed"), _raw: q };
      }

      // Delivered
      if (
        token || cardDetails || (Array.isArray(vPins) && vPins.length) ||
        code === "100" || code === "200" ||
        stat === "ORDER_COMPLETED" || stat === "ORDER_RECEIVED" ||
        stat === "SUCCESSFUL" || stat === "SUCCESS"
      ) {
        return {
          status: "SUCCESS", requestId: rid,
          reference: String(q.orderid ?? q.OrderID ?? q.transactionid ?? q.TransactionID ?? orderId ?? ""),
          token: token || "",
          cardDetails: cardDetails || "",
          pins: Array.isArray(vPins) && vPins.length ? vPins : undefined,
          message: stat || "ORDER_COMPLETED",
          _raw: q,
        };
      }

      // Order exists but still working, or shape we don't recognise — hold, don't refund
      return { status: "PENDING", requestId: rid, message: stat || "processing", _raw: q };
    }

    // ── Betting providers ─────────────────────────────────────────────────────
    if (action === "betting-providers") {
      const data = await ck("APIBettingTypeV2.asp", { APIKey: BETTING_K });
      return json({ providers: data });
    }

    // ── Betting verify account ────────────────────────────────────────────────
    if (action === "betting-verify") {
      const { company, customerId } = body as { company: string; customerId: string };
      if (!company || !customerId) return json({ error: "company and customerId required" });
      const data = await ck("APIVerifyBettingV1.asp", { APIKey: BETTING_K, BettingCompany: company, CustomerID: customerId });
      const name = String(data?.customer_name ?? data?.CustomerName ?? "");
      if (!name || name.toLowerCase().includes("invalid") || name.toLowerCase().includes("error"))
        return json({ error: "Invalid customer ID" });
      return json({ customer_name: name });
    }

    // ── Betting purchase ──────────────────────────────────────────────────────
    if (action === "betting") {
      const { company, customerId, amount } = body as { company: string; customerId: string; amount: string };
      if (!company || !customerId || !amount) return json({ error: "company, customerId and amount required" });
      const data = await ckBuy("betting", "APIBettingV1.asp", {
        APIKey: BETTING_K, BettingCompany: company, CustomerID: customerId,
        Amount: String(amount), RequestID: rid, CallBackURL: "https://kudiai.app/",
      });
      if (!isOk(data)) return json({ error: errMsg(data, "Betting wallet funding failed"), _raw: data });
      return json({ status: "SUCCESS", reference: String(data.orderid ?? data.requestid ?? ""), message: String(data.status ?? "ORDER_RECEIVED") });
    }

    // ── WAEC / JAMB price (public catalogue read) ─────────────────────────────
    // The price of an exam PIN from the provider that would sell it right now — the app shows it and charges it (it used
    // to have no price at all, so WAEC/JAMB checkout stopped at "Invalid amount"). JAMB is ClubKonnect only.
    if (action === "exam-price") {
      const exam = String((body as { exam?: unknown }).exam ?? "").toLowerCase().trim();
      const examType = String((body as { examType?: unknown }).examType ?? "").trim();
      if ((exam !== "waec" && exam !== "jamb") || !examType) return json({ error: "exam (waec or jamb) and examType required" });
      if (exam === "waec" && VT_WAEC[examType] && (await catalogueProvider("waec")) === "vtpass") {
        const w = VT_WAEC[examType];
        const hit = (await vtCatalogue(w.serviceID)).find((p) => vtPlanCode(p.plan_id) === w.variation);
        if (hit) return json({ amount: hit.plan_amount, name: hit.plan_name, provider: "vtpass" });
      }
      const cat = await ckExamCatalogue(exam);
      if (!cat.ok) return json({ error: "We couldn't get the price right now. Please try again shortly." });
      const product = findExamProduct(cat.products, examType);
      if (!product) {
        return json({ error: exam === "jamb" ? "JAMB PINs aren't on sale right now. Please check back later." : "This WAEC PIN isn't on sale right now. Please check back later." });
      }
      return json({ amount: product.amount, name: product.name, provider: "clubkonnect" });
    }

    // ── WAEC packages ─────────────────────────────────────────────────────────
    if (action === "waec-packages") {
      const data = await ck("APIWAECPackagesV2.asp", { APIKey: WAEC_K });
      return json({ packages: data });
    }

    // ── WAEC purchase ─────────────────────────────────────────────────────────
    if (action === "waec") {
      const { examType, phone } = body as { examType: string; phone: string };
      if (!examType || !phone) return json({ error: "examType and phone required" });
      // ClubKonnect or VTpass, with failover (the same fixed product on both).
      const vb = vtWaecBody(examType, phone.replace(/\D/g, ""));
      // ClubKonnect's own code for the product (it spells registration "waec-registraion", the app "waec-registration")
      const ckCode = providerExamCode((await ckExamCatalogue("waec")).products, examType);
      const pd = providerDeps("waec", rid, WAEC_K,
        () => ckBuy("waec", "APIWAECV1.asp", {
          APIKey: WAEC_K, ExamType: ckCode,
          PhoneNo: phone.replace(/\D/g, ""), RequestID: rid, CallBackURL: "https://kudiai.app/",
        }), vb);
      const out = await buyAcrossProviders("waec", vb ? await providerOrderFor("waec") : ["clubkonnect"], pd);
      if (out.via !== "clubkonnect") return vtAnswer("waec", out, rid, callerUser?.id ?? null, pd.vtRid());
      const data = out.data;
      if (!isOk(data)) return json({ error: errMsg(data, "WAEC ePin purchase failed"), _raw: data });
      const waecDetails = String(data.carddetails ?? data.CardDetails ?? "");
      if (!waecDetails) return json({ error: "WAEC card details not returned — contact Clubkonnect support", _raw: data });
      return json({ status: "SUCCESS", reference: String(data.orderid ?? data.requestid ?? ""), cardDetails: waecDetails, message: String(data.status ?? "ORDER_RECEIVED") });
    }

    // ── JAMB packages ─────────────────────────────────────────────────────────
    if (action === "jamb-packages") {
      const data = await ck("APIJAMBPackagesV2.asp", { APIKey: JAMB_K });
      return json({ packages: data });
    }

    // ── JAMB verify profile ───────────────────────────────────────────────────
    if (action === "jamb-verify") {
      const { examType, profileId } = body as { examType: string; profileId: string };
      if (!examType || !profileId) return json({ error: "examType and profileId required" });
      const data = await ck("APIVerifyJAMBV1.asp", { APIKey: JAMB_K, ExamType: examType, ProfileID: profileId });
      const name = String(data?.customer_name ?? data?.CustomerName ?? "");
      if (!name || name === "INVALID_ACCOUNTNO" || name.toLowerCase().includes("invalid"))
        return json({ error: "Invalid JAMB profile ID" });
      return json({ customer_name: name });
    }

    // ── JAMB purchase ─────────────────────────────────────────────────────────
    if (action === "jamb") {
      const { examType, phone } = body as { examType: string; phone: string };
      if (!examType || !phone) return json({ error: "examType and phone required" });
      const data = await ckBuy("jamb", "APIJAMBV1.asp", {
        APIKey: JAMB_K, ExamType: examType,
        PhoneNo: phone.replace(/\D/g, ""), RequestID: rid, CallBackURL: "https://kudiai.app/",
      });
      if (!isOk(data)) return json({ error: errMsg(data, "JAMB ePin purchase failed"), _raw: data });
      const jambDetails = String(data.carddetails ?? data.CardDetails ?? "");
      if (!jambDetails) return json({ error: "JAMB card details not returned — contact Clubkonnect support", _raw: data });
      return json({ status: "SUCCESS", reference: String(data.orderid ?? data.requestid ?? ""), cardDetails: jambDetails, message: String(data.status ?? "ORDER_RECEIVED") });
    }

    // ── Spectranet plans ──────────────────────────────────────────────────────
    if (action === "spectranet-plans") {
      const data = await ck("APISpectranetPackagesV2.asp", { APIKey: SPECTRANET_K });
      if (data?.status && String(data.status).includes("INVALID")) return json({ error: `Spectranet API key error: ${data.status}`, plans: [] });
      const mobileNet = data?.MOBILE_NETWORK as Record<string, Record<string, unknown>[]> | undefined;
      let plans: { plan_id: string; plan_name: string; plan_amount: number }[] = [];
      if (mobileNet) {
        const groups = mobileNet["SPECTRANET"] ?? mobileNet["spectranet"] ?? Object.values(mobileNet)[0] ?? [];
        for (const group of groups) {
          for (const p of ((group?.PRODUCT ?? []) as Record<string, unknown>[])) {
            const pid = String(p.PRODUCT_CODE ?? p.PRODUCT_ID ?? "");
            if (pid) plans.push({ plan_id: pid, plan_name: String(p.PRODUCT_NAME ?? ""), plan_amount: Number(p.PRODUCT_AMOUNT ?? 0) });
          }
        }
      } else {
        const raw: unknown[] = Array.isArray(data) ? data : (data?.Packages ?? data?.packages ?? data?.response ?? data?.data ?? []) as unknown[];
        plans = (raw as Record<string, unknown>[]).map(p => ({
          plan_id:     String(p.DataPlan ?? p.PackageCode ?? p.PRODUCT_CODE ?? p.id ?? ""),
          plan_name:   String(p.DataPlanName ?? p.PackageName ?? p.PRODUCT_NAME ?? p.name ?? ""),
          plan_amount: Number(p.Price ?? p.PRODUCT_AMOUNT ?? p.amount ?? 0),
        })).filter(p => p.plan_id && p.plan_id !== "undefined");
      }
      if (!plans.length) return json({ plans: [], error: `No Spectranet plans returned: ${JSON.stringify(data).slice(0, 200)}` });
      return json({ plans });
    }

    // ── Spectranet purchase ───────────────────────────────────────────────────
    if (action === "spectranet") {
      const { accountNo, planId } = body as { accountNo: string; planId: string };
      if (!accountNo || !planId) return json({ error: "accountNo and planId required" });
      const data = await ckBuy("spectranet", "APISpectranetV1.asp", {
        APIKey: SPECTRANET_K, MobileNetwork: "spectranet", DataPlan: planId,
        MobileNumber: accountNo, RequestID: rid, CallBackURL: "https://kudiai.app/",
      });
      if (!isOk(data)) return json({ error: errMsg(data, "Spectranet purchase failed"), _raw: data });
      return json({ status: "SUCCESS", reference: String(data.orderid ?? data.requestid ?? ""), message: String(data.status ?? "ORDER_RECEIVED") });
    }

    // ── Smile plans ───────────────────────────────────────────────────────────
    if (action === "smile-plans") {
      // From the provider Smile orders go to right now; a VTpass plan's id is tagged "vt:" so the purchase goes back there.
      if ((await catalogueProvider("smile")) === "vtpass") {
        const vtPlans = await vtCatalogue(VT_SMILE);
        if (vtPlans.length) return json({ plans: vtPlans, _provider: "vtpass" });
        console.warn("[smile-plans] VTpass catalogue empty — showing ClubKonnect's");
      }
      const data = await ck("APISmilePackagesV2.asp", { APIKey: SMILE_K });
      if (data?.status && String(data.status).includes("INVALID")) return json({ error: `Smile API key error: ${data.status}`, plans: [] });
      const mobileNet = data?.MOBILE_NETWORK as Record<string, Record<string, unknown>[]> | undefined;
      let plans: { plan_id: string; plan_name: string; plan_amount: number }[] = [];
      if (mobileNet) {
        const groups = mobileNet["SMILE"] ?? mobileNet["smile-direct"] ?? Object.values(mobileNet)[0] ?? [];
        for (const group of groups) {
          for (const p of ((group?.PRODUCT ?? []) as Record<string, unknown>[])) {
            const pid = String(p.PRODUCT_CODE ?? p.PRODUCT_ID ?? "");
            if (pid) plans.push({ plan_id: pid, plan_name: String(p.PRODUCT_NAME ?? ""), plan_amount: Number(p.PRODUCT_AMOUNT ?? 0) });
          }
        }
      } else {
        const raw: unknown[] = Array.isArray(data) ? data : (data?.Packages ?? data?.packages ?? data?.response ?? data?.data ?? []) as unknown[];
        plans = (raw as Record<string, unknown>[]).map(p => ({
          plan_id:     String(p.DataPlan ?? p.PackageCode ?? p.PRODUCT_CODE ?? p.id ?? ""),
          plan_name:   String(p.DataPlanName ?? p.PackageName ?? p.PRODUCT_NAME ?? p.name ?? ""),
          plan_amount: Number(p.Price ?? p.PRODUCT_AMOUNT ?? p.amount ?? 0),
        })).filter(p => p.plan_id && p.plan_id !== "undefined");
      }
      if (!plans.length) return json({ plans: [], error: `No Smile plans returned: ${JSON.stringify(data).slice(0, 200)}` });
      return json({ plans });
    }

    // ── Smile verify account ──────────────────────────────────────────────────
    if (action === "smile-verify") {
      const { accountNo } = body as { accountNo: string };
      if (!accountNo) return json({ error: "accountNo required" });
      const r = await checkCustomer("smile",
        () => vtCheckCustomer(VT_SMILE, accountNo.trim()),
        async () => ckCustomer(await ck("APIVerifySmileV1.asp", { APIKey: SMILE_K, MobileNetwork: "smile-direct", MobileNumber: accountNo }), "Invalid Smile account number"));
      if (r.kind === "ok") return json({ customer_name: r.name });
      return json({ error: r.kind === "invalid" ? r.message : CHECK_UNAVAILABLE });
    }

    // ── Smile purchase ────────────────────────────────────────────────────────
    if (action === "smile") {
      const { accountNo, planId } = body as { accountNo: string; planId: string };
      if (!accountNo || !planId) return json({ error: "accountNo and planId required" });
      if (isVtPlan(planId)) {
        if (!vtUsable()) return json({ error: "This plan is no longer available. Please reload the plans and try again." });
        // VTpass wants a phone number for its receipt SMS; the app only collects the Smile account, which is usually the
        // Smile phone number — used when it looks like one.
        const acct = accountNo.trim(), phoneLike = /^0\d{10}$/.test(acct.replace(/\D/g, "")) ? acct.replace(/\D/g, "") : "";
        const pd = providerDeps("smile", rid, SMILE_K, () => Promise.reject(new Error("not a ClubKonnect plan")),
          vtSmileBody(acct, vtPlanCode(planId), phoneLike || "08000000000"));
        const out = await buyAcrossProviders("smile", ["vtpass"], pd);
        if (out.via === "clubkonnect") return json({ error: "This plan is no longer available. Please reload the plans and try again." });
        return vtAnswer("smile", out, rid, callerUser?.id ?? null, pd.vtRid());
      }
      const data = await ckBuy("smile", "APISmileV1.asp", {
        APIKey: SMILE_K, MobileNetwork: "smile-direct", DataPlan: planId,
        MobileNumber: accountNo, RequestID: rid, CallBackURL: "https://kudiai.app/",
      });
      if (!isOk(data)) return json({ error: errMsg(data, "Smile purchase failed"), _raw: data });
      return json({ status: "SUCCESS", reference: String(data.orderid ?? data.requestid ?? ""), message: String(data.status ?? "ORDER_RECEIVED") });
    }

    // ── Print Airtime EPIN (Enterprise only — gated in UI) ────────────────────
    if (action === "print-airtime") {
      if (!PRINT_AIRTIME_K) return json({ error: "Print Airtime API key not configured. Add CK_PRINT_AIRTIME_KEY to your Supabase secrets." });
      const { network, value, quantity } = body as { network: string; value: string; quantity: string };
      if (!network || !value || !quantity) return json({ error: "network, value and quantity required" });
      const netId = NET_ID[network];
      if (!netId) return json({ error: `Unknown network: ${network}` });
      const qty = parseInt(quantity, 10);
      if (qty < 1 || qty > 100) return json({ error: "Quantity must be between 1 and 100" });
      if (!["100", "200", "300", "500", "1000"].includes(String(value))) return json({ error: "Value must be 100, 200, 300, 500 or 1000" });
      const data = await ckBuy("print-airtime", "APIEPINV1.asp", {
        APIKey: PRINT_AIRTIME_K, MobileNetwork: netId, Value: String(value),
        Quantity: String(qty), RequestID: rid, CallBackURL: "https://kudiai.app/",
      });
      const pins = (data?.TXN_EPIN ?? []) as Record<string, unknown>[];
      if (!pins.length) return json({ error: isOk(data) ? "Airtime ePIN not returned — contact Clubkonnect support" : errMsg(data, "Print airtime failed"), _raw: data });
      afterResponse(recordBillCost("print-airtime", rid, callerUser?.id ?? null, data, async (d) => printAirtimeCost(value, qty, networkName(network, netId), d, data)));
      return json({ status: "SUCCESS", reference: String(data?.batchno ?? data?.orderid ?? data?.requestid ?? ""), pins, message: "ORDER_RECEIVED" });
    }

    // ── Print Data EPIN (Enterprise only — gated in UI) ───────────────────────
    if (action === "print-data") {
      if (!PRINT_DATA_K) return json({ error: "Print Data API key not configured. Add CK_PRINT_DATA_KEY to your Supabase secrets." });
      const { network, planId, quantity } = body as { network: string; planId: string; quantity: string };
      if (!network || !planId || !quantity) return json({ error: "network, planId and quantity required" });
      const netId = NET_ID[network];
      if (!netId) return json({ error: `Unknown network: ${network}` });
      const qty = parseInt(quantity, 10);
      if (qty < 1 || qty > 100) return json({ error: "Quantity must be between 1 and 100" });
      const data = await ckBuy("print-data", "APIDatabundleEPINV1.asp", {
        APIKey: PRINT_DATA_K, MobileNetwork: netId, DataPlan: planId,
        Quantity: String(qty), RequestID: rid, CallBackURL: "https://kudiai.app/",
      });
      const pins = (data?.TXN_EPIN_DATABUNDLE ?? []) as Record<string, unknown>[];
      if (!pins.length) return json({ error: isOk(data) ? "Data ePIN not returned — contact Clubkonnect support" : errMsg(data, "Print data failed"), _raw: data });
      afterResponse(recordBillCost("print-data", rid, callerUser?.id ?? null, data, async () =>
        dataCost(await providerPlanPrice("print-data", PRINT_DATA_K, netId, networkName(network, netId) ?? network, planId).catch(() => null), qty, data)));
      return json({ status: "SUCCESS", reference: String(data?.batchno ?? data?.orderid ?? data?.requestid ?? ""), pins, message: "ORDER_RECEIVED" });
    }

    // ── Bill failure alert — create critical support ticket + email admins & user ─
    if (action === "bill-failure-alert") {
      const { user_id, user_email, user_name, service, amount, ps_ref, ck_error, hold } = body as {
        user_id?: string; user_email?: string; user_name?: string;
        service?: string; amount?: number; ps_ref?: string; ck_error?: string;
        // hold = we could NOT confirm the outcome (network disruption). Raise a
        // ticket for a human to reconcile, but do NOT auto-refund — the order may
        // have been delivered.
        hold?: boolean;
      };
      try {
        const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

        // Create a support ticket so admin/finance see it immediately
        const ticketSubject = hold
          ? `BILLING UNCONFIRMED: ${service} — paid, delivery not verified (network)`
          : `BILLING FAILURE: ${service} — Paystack paid, service delivery failed`;
        const description = hold
          ? `A customer paid via Paystack. The provider call was disrupted by a network fault and we could NOT confirm whether the order was delivered.\n\n` +
            `User: ${user_name || "Unknown"} (${user_email || "N/A"})\n` +
            `Service: ${service}\n` +
            `Amount: ₦${amount?.toLocaleString() || "?"}\n` +
            `Paystack Reference: ${ps_ref}\n` +
            `Detail: ${ck_error}\n\n` +
            `ACTION REQUIRED: Requery ClubKonnect for RequestID ${ps_ref}. If delivered — mark the transaction success. If not — refund. DO NOT assume failure.`
          : `A customer paid successfully via Paystack but bill delivery failed.\n\n` +
            `User: ${user_name || "Unknown"} (${user_email || "N/A"})\n` +
            `Service: ${service}\n` +
            `Amount: ₦${amount?.toLocaleString() || "?"}\n` +
            `Paystack Reference: ${ps_ref}\n` +
            `Provider Error: ${ck_error}\n\n` +
            `ACTION REQUIRED: Verify provider wallet balance and manually fulfill or refund.`;

        await sb.from("support_tickets").insert({
          subject:    ticketSubject,
          description,
          type:       "payment",
          priority:   hold ? "high" : "critical",
          status:     "open",
          user_id:    user_id || null,
          user_email: user_email || null,
          user_name:  user_name  || null,
        });

        await sb.from("admin_tasks").insert({
          title:       hold ? `Bill unconfirmed — ${service}` : `Service wallet failure — ${service}`,
          description: hold
            ? `Paystack ref ${ps_ref} was charged ₦${amount?.toLocaleString() || "?"}. Provider call disrupted (${ck_error}) — outcome UNKNOWN. Requery CK RequestID ${ps_ref} and settle (mark success or refund).`
            : `Paystack ref ${ps_ref} was charged ₦${amount?.toLocaleString() || "?"} but provider returned: "${ck_error}". Check wallet balance and fulfill manually.`,
          priority: hold ? "high" : "critical",
          status:   "pending",
        });

        // Email SuperAdmin + Finance admins
        const { data: admins } = await sb
          .from("admin_users")
          .select("email, role")
          .in("role", ["super_admin", "finance_admin"])
          .eq("is_active", true)
          .not("email", "is", null);

        const adminEmailHtml = billEmailHtml({
          accentColor: "linear-gradient(135deg,#dc2626,#b91c1c)",
          icon: "⚠",
          title: "Bill Payment Failure Alert",
          subtitle: "Action Required — Paystack paid, delivery failed",
          body: `<p style="margin:0 0 16px;color:#374151;font-size:14px;">A customer paid successfully via Paystack but <strong>the provider failed to deliver</strong> the service. Immediate action is required.</p>
            <table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 16px;">
              <tr><td style="padding:7px 0;color:#6b7280;width:140px;font-weight:600;">User</td><td style="padding:7px 0;font-weight:700;color:#111827;">${esc(user_name || "Unknown")} (${esc(user_email || "N/A")})</td></tr>
              <tr style="background:#fef2f2;"><td style="padding:7px 8px;color:#6b7280;font-weight:600;">Service</td><td style="padding:7px 8px;font-weight:700;color:#111827;">${esc(service)}</td></tr>
              <tr><td style="padding:7px 0;color:#6b7280;font-weight:600;">Amount Paid</td><td style="padding:7px 0;font-weight:700;color:#111827;">₦${esc(amount?.toLocaleString() || "?")}</td></tr>
              <tr style="background:#fef2f2;"><td style="padding:7px 8px;color:#6b7280;font-weight:600;">Paystack Ref</td><td style="padding:7px 8px;font-family:monospace;color:#111827;">${esc(ps_ref)}</td></tr>
              <tr><td style="padding:7px 0;color:#6b7280;font-weight:600;">Error</td><td style="padding:7px 0;font-weight:700;color:#dc2626;">${esc(ck_error)}</td></tr>
            </table>
            <div style="padding:14px 16px;background:#fef9c3;border:1px solid #fde68a;border-radius:8px;">
              <p style="margin:0;font-weight:700;color:#92400e;font-size:14px;">ACTION REQUIRED</p>
              <p style="margin:8px 0 0;color:#92400e;font-size:13px;">Check provider wallet balance and manually fulfill or refund this customer immediately.</p>
            </div>`,
        });

        for (const admin of (admins || [])) {
          if (admin.email) {
            try { await sendEmail(sb, { to: admin.email, subject: `[KudiTrack] URGENT: Bill delivery failed — ${service}`, html: adminEmailHtml }); }
            catch (e) { console.error("Admin email failed:", admin.email, (e as Error).message); }
          }
        }

        // Email the business user
        if (user_email) {
          const paidAmt = Number(amount);
          const userEmailHtml = bankEmail({
            title: hold ? "Bill Payment Under Review" : "Bill Delivery Issue", tone: "danger", timestamp: new Date(),
            preheader: `Your ${esc(service)} payment was received, but delivery hit a problem — your money is safe`,
            intro: `Dear <strong>${esc(user_name || "Valued Customer")}</strong>, your payment for <strong>${esc(service)}</strong> was received successfully. However, we encountered a temporary issue delivering the service.`,
            amount: Number.isFinite(paidAmt) && paidAmt > 0 ? naira(paidAmt) : undefined,
            amountLabel: "Payment received — delivery pending",
            rows: [
              ["Service", esc(service)],
              ["Payment Ref.", ps_ref ? esc(ps_ref) : "", { mono: true }],
              ["Issue", ck_error ? esc(ck_error) : ""],
              ["Status", hold ? "Under review" : "Being resolved"],
            ],
            note: "<strong>Your money is safe.</strong> Our team has been automatically alerted and will resolve this immediately. If you do not receive your service within 2 hours, please contact our support team with the payment reference above.",
            button: { label: "Open KudiAI Track →", url: appLink({ tab: "bills" }) },
          });
          try { await sendEmail(sb, { to: user_email, subject: `KudiAI Track: Action needed on your ${service} payment`, html: userEmailHtml }); }
          catch (e) { console.error("User failure email failed:", (e as Error).message); }
        }

        // ── Automatic Paystack refund ──────────────────────────────────────
        // Initiating a refund here means every definite fulfillment failure (after
        // the customer was charged) triggers an automatic full refund. Electricity
        // PENDING does not reach this path — that stays as "check meter" polling.
        // `hold` also skips the refund: the outcome is unknown (network disruption)
        // and the order may have been delivered — a human reconciles instead.
        let refundInitiated = false;
        let refundId: string | null = null;
        if (!hold && ps_ref && amount && Number(amount) > 0) {
          try {
            const rfRes = await fetch(`${SUPABASE_URL}/functions/v1/paystack`, {
              method: "POST",
              headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                action:      "refund",
                transaction: ps_ref,
                // Omit amount → full refund. Paystack is idempotent; double calls return same refund.
                reason: `Bill delivery failed: ${String(ck_error || "provider error").slice(0, 100)}`,
              }),
            });
            const rfData = await rfRes.json() as Record<string, unknown>;
            const rfDataInner = rfData?.data as Record<string, unknown> | undefined;
            if (rfData?.status && rfDataInner?.id) {
              refundInitiated = true;
              refundId = String(rfDataInner.id);
              console.log(`Auto-refund initiated: ps_ref=${ps_ref} refund_id=${refundId}`);
            } else {
              console.error(`Auto-refund failed: ps_ref=${ps_ref} response=${JSON.stringify(rfData).slice(0, 200)}`);
            }
          } catch (rfErr) {
            console.error("Auto-refund error:", (rfErr as Error).message);
          }
        }

        // Update the admin task description with refund status
        if (refundInitiated && refundId) {
          await sb.from("admin_tasks").update({
            description: `Paystack ref ${ps_ref} was charged ₦${amount?.toLocaleString() || "?"} but provider returned: "${ck_error}". ✅ Auto-refund initiated (ID: ${refundId}). Verify delivery within 24h.`,
          }).eq("title", `Service wallet failure — ${service}`);
        }

        console.log(`Bill failure alert: ${ps_ref} — ${ck_error} | refund_initiated=${refundInitiated}`);
        return json({ ok: true, refund_initiated: refundInitiated, refund_id: refundId });
      } catch (e) {
        console.error("bill-failure-alert error:", e);
        return json({ ok: false, error: (e as Error).message });
      }
    }

    // ── Shared PIN cards HTML renderer ───────────────────────────────────────
    const renderPinCards = (pins: unknown[]) => {
      if (!pins || !pins.length) return "";
      const networkColors: Record<string, string> = {
        MTN: "#fef3c7", Airtel: "#fee2e2", Glo: "#dcfce7", "9mobile": "#dbeafe",
      };
      const networkBorders: Record<string, string> = {
        MTN: "#fde68a", Airtel: "#fca5a5", Glo: "#86efac", "9mobile": "#93c5fd",
      };
      const cards = (pins as Record<string, unknown>[]).map((pin, i) => {
        const serial  = String(pin.EPIN_SERIAL ?? pin.sno ?? pin.serial ?? "");
        const code    = String(pin.EPIN ?? pin.pin ?? pin.code ?? "");
        const network = String(pin.network ?? "");
        const bg      = networkColors[network] || "#f0fdf4";
        const border  = networkBorders[network] || "#bbf7d0";
        return `<div style="background:${bg};border:1px solid ${border};border-radius:8px;padding:10px 12px;margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
            <span style="font-size:10px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">
              PIN ${i + 1}${network ? " · " + esc(network) : ""}
            </span>
            ${serial ? `<span style="font-size:10px;color:#9ca3af;font-family:monospace;">S/N: ${esc(serial)}</span>` : ""}
          </div>
          <p style="font-family:monospace;font-size:17px;font-weight:900;color:#15803d;margin:0;letter-spacing:2px;word-break:break-all;">${esc(code)}</p>
        </div>`;
      }).join("");
      return `<div style="margin:0 0 16px;">
        <p style="font-size:11px;font-weight:800;color:#064e3b;text-transform:uppercase;letter-spacing:1.5px;margin:0 0 8px;">
          Voucher PIN${pins.length > 1 ? "s" : ""} (${pins.length} total)
        </p>
        ${cards}
        <p style="font-size:11px;color:#6b7280;margin:8px 0 0;">Keep these PINs safe — they cannot be reissued if lost.</p>
      </div>`;
    };

    // ── Bill success email — notify business user their bill was delivered ────────
    // Bank-grade layout (_shared/bankEmail.ts): the transaction's stored reference,
    // WAT time, who actually took the payment, balance after, and a View Transaction
    // button. The app sends receipt_ref / occurred_at / balance_after / paid_via /
    // txn_id from the saved transaction row; any that are missing are simply left off.
    if (action === "bill-success-email") {
      const { user_email, user_name, service, amount, reference, detail, pins, receipt_ref, occurred_at, balance_after, paid_via, txn_id } = body as {
        user_email?: string; user_name?: string; service?: string;
        amount?: number; reference?: string; detail?: string; pins?: unknown[];
        receipt_ref?: string; occurred_at?: string; balance_after?: number; paid_via?: string; txn_id?: string;
      };
      if (!user_email) return json({ ok: false, error: "user_email required" });
      try {
        const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
        const PAID_VIA: Record<string, string> = {
          wallet: "KudiAI Wallet", paystack: "Paystack", flutterwave: "Flutterwave", cashback: "KudiAI cashback", cash: "Cash",
        };
        const via = paid_via ? PAID_VIA[String(paid_via).toLowerCase()] : undefined;
        const amt = Number(amount);
        const detailRows: EmailRow[] = (detail || "").split(" | ").filter(Boolean).map((d): EmailRow => {
          const [k, ...rest] = d.split(": ");
          return rest.length ? [esc(k), esc(rest.join(": "))] : ["Detail", esc(d)];
        });
        const link: Record<string, string> = { tab: "transactions" };
        if (txn_id && /^[0-9a-f-]{36}$/i.test(String(txn_id))) link.id = String(txn_id);
        const html = bankEmail({
          title: "Bill Payment Successful", tone: "success",
          timestamp: occurred_at,
          amount: Number.isFinite(amt) && amt > 0 ? naira(amt) : undefined,
          amountLabel: service ? esc(service) : "Payment Confirmed",
          preheader: `Your ${esc(service || "bill")} payment was processed successfully`,
          intro: `Dear ${esc(user_name || "Valued Customer")}, your ${esc(service || "bill")} payment was processed successfully.`,
          rows: [
            ["Transaction Reference", receipt_ref ? esc(receipt_ref) : "", { mono: true }],
            ["Service", service ? esc(service) : ""],
            ["Payment Method", via ? esc(via) : ""],
            ...detailRows,
            ["Payment Ref.", reference ? esc(reference) : "", { mono: true }],
            ["Balance After", balance_after != null && Number.isFinite(Number(balance_after)) ? naira(Number(balance_after)) : ""],
          ],
          note: pins?.length ? renderPinCards(pins) : undefined,
          button: { label: "View Transaction →", url: appLink(link) },
        });
        await sendEmail(sb, { to: user_email, subject: `KudiAI Track: ${service} payment confirmed ✓`, html });
        return json({ ok: true });
      } catch (e) {
        console.error("bill-success-email error:", e);
        return json({ ok: false, error: (e as Error).message });
      }
    }

    // ── Bill cancelled/disrupted email — payment not completed, user not charged ──
    if (action === "bill-cancelled-email") {
      const { user_email, user_name, service, reference, reason } = body as {
        user_email?: string; user_name?: string; service?: string;
        reference?: string; reason?: string;
      };
      if (!user_email) return json({ ok: false, error: "user_email required" });
      try {
        const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
        const html = bankEmail({
          title: "Payment Not Completed", tone: "warning", timestamp: new Date(),
          preheader: `Your ${esc(service || "bill")} payment was not completed — you were not charged`,
          intro: `Dear <strong>${esc(user_name || "Valued Customer")}</strong>, your <strong>${esc(service || "bill")}</strong> payment was <strong>not completed</strong>. ${reason ? esc(reason) : "The payment session ended before it was confirmed."}`,
          rows: [
            ["Service", service ? esc(service) : ""],
            ["Payment Ref.", reference ? esc(reference) : "", { mono: true }],
            ["Status", "Not charged"],
          ],
          note: "<strong>You were not charged.</strong> No money was deducted from your account, so you can safely retry your payment. If you believe this is an error or need assistance, please contact our support team.",
          button: { label: "Try Again →", url: appLink({ tab: "bills" }) },
        });
        await sendEmail(sb, { to: user_email, subject: `KudiAI Track: ${service || "Bill"} payment not completed`, html });
        return json({ ok: true });
      } catch (e) {
        console.error("bill-cancelled-email error:", e);
        return json({ ok: false, error: (e as Error).message });
      }
    }

    // ── Bill staff notification — notify staff member of bill outcome ──────────
    if (action === "bill-staff-email") {
      const { staff_email, staff_name, business_name, service, amount, reference, detail, outcome, pins, receipt_ref, occurred_at, balance_after, paid_via, txn_id } = body as {
        staff_email?: string; staff_name?: string; business_name?: string;
        service?: string; amount?: number; reference?: string; detail?: string;
        outcome?: "success" | "failed" | "cancelled"; pins?: unknown[];
        receipt_ref?: string; occurred_at?: string; balance_after?: number; paid_via?: string; txn_id?: string;
      };
      if (!staff_email) return json({ ok: false, error: "staff_email required" });
      try {
        const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
        const isSuccess = outcome === "success";
        const isFailed  = outcome === "failed";
        const title     = isSuccess ? "Bill Payment Successful" : isFailed ? "Bill Payment Failed" : "Payment Not Completed";
        const PAID_VIA: Record<string, string> = { wallet: "KudiAI Wallet", paystack: "Paystack", flutterwave: "Flutterwave", cashback: "KudiAI cashback", cash: "Cash" };
        const via = paid_via ? PAID_VIA[String(paid_via).toLowerCase()] : undefined;
        const amt = Number(amount);
        const detailRows: EmailRow[] = (detail || "").split(" | ").filter(Boolean).map((d): EmailRow => {
          const [k, ...rest] = d.split(": ");
          return rest.length ? [esc(k), esc(rest.join(": "))] : ["Detail", esc(d)];
        });
        const link: Record<string, string> = { tab: "transactions" };
        if (txn_id && /^[0-9a-f-]{36}$/i.test(String(txn_id))) link.id = String(txn_id);
        const html = bankEmail({
          title, tone: isSuccess ? "success" : isFailed ? "danger" : "warning", timestamp: occurred_at,
          amount: Number.isFinite(amt) && amt > 0 ? naira(amt) : undefined,
          amountLabel: isSuccess ? "Amount Paid" : isFailed ? "Delivery failed" : "Not charged",
          preheader: `${esc(service || "Bill")} — ${title}`,
          intro: `Hi <strong>${esc(staff_name || "Staff")}</strong>, ${isSuccess
            ? `you successfully processed a <strong>${esc(service)}</strong> bill payment for <strong>${esc(business_name || "the business")}</strong>.`
            : isFailed
              ? `a <strong>${esc(service)}</strong> bill payment you initiated for <strong>${esc(business_name || "the business")}</strong> could not be delivered.`
              : `a <strong>${esc(service)}</strong> bill payment you initiated for <strong>${esc(business_name || "the business")}</strong> was not completed. No charge was made.`}`,
          rows: [
            ["Transaction Reference", receipt_ref ? esc(receipt_ref) : "", { mono: true }],
            ["Service", service ? esc(service) : ""],
            ["Business", business_name ? esc(business_name) : ""],
            ["Payment Method", isSuccess && via ? esc(via) : ""],
            ...detailRows,
            ["Payment Ref.", reference ? esc(reference) : "", { mono: true }],
            ["Balance After", isSuccess && balance_after != null && Number.isFinite(Number(balance_after)) ? naira(Number(balance_after)) : ""],
          ],
          note: isSuccess && pins?.length ? renderPinCards(pins) : undefined,
          button: { label: isSuccess ? "View Transaction →" : "Open Bills →", url: appLink(isSuccess ? link : { tab: "bills" }) },
        });
        await sendEmail(sb, { to: staff_email, subject: `KudiAI Track: ${service} bill ${outcome === "success" ? "delivered ✓" : outcome === "failed" ? "failed ✕" : "not completed"}`, html });
        return json({ ok: true });
      } catch (e) {
        console.error("bill-staff-email error:", e);
        return json({ ok: false, error: (e as Error).message });
      }
    }

    // ── Wallet balance alert — call hourly via pg_cron or manually ───────────
    // Reads the CK wallet balance and emails super_admin + finance_admin if it falls
    // below CK_WALLET_LOW_THRESHOLD (default ₦5 000). Guards against the scenario
    // where a low wallet isn't noticed until a customer pays and fulfilment fails.
    if (action === "wallet-balance-alert") {
      const threshold = Number(Deno.env.get("CK_WALLET_LOW_THRESHOLD") ?? "5000");
      const useKey = AIRTIME_K || DATA_K || ELECTRICITY_K || CABLETV_K;
      if (!USER_ID || !useKey)
        return json({ ok: false, error: "CK credentials not configured", balance: null });

      const wbData = await ck("APIWalletBalanceV1.asp", { APIKey: useKey });
      const parseAmt = parseCkAmount;
      const BALANCE_FIELDS = [
        "WalletBalance","walletbalance","wallet_balance","Balance","balance",
        "AccountBalance","Wallet_Balance","WALLETBALANCE","available_balance","AvailableBalance",
      ];
      let balance: number | null = null;
      for (const f of BALANCE_FIELDS) {
        const v = parseAmt(wbData[f]);
        if (v !== null) { balance = v; break; }
      }

      console.log(`wallet-balance-alert: balance=${balance} threshold=${threshold}`);
      if (balance === null || balance >= threshold) {
        return json({ ok: true, balance, threshold, alerted: false });
      }

      // Below threshold — email admins
      const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
      const { data: admins } = await sb.from("admin_users")
        .select("email, role")
        .in("role", ["super_admin", "finance_admin"])
        .eq("is_active", true)
        .not("email", "is", null);

      const alertHtml = billEmailHtml({
        accentColor: "linear-gradient(135deg,#d97706,#b45309)",
        icon: "⚠",
        title: "Low Bill-Payment Wallet Balance",
        subtitle: "Top up your Clubkonnect wallet immediately",
        body: `<p style="margin:0 0 14px;color:#374151;font-size:14px;">Your Clubkonnect wallet balance has dropped below the alert threshold. If it runs out, customers who pay will not receive their service and automatic refunds will be triggered.</p>
          <table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 16px;">
            <tr><td style="padding:7px 0;color:#6b7280;width:160px;font-weight:600;">Current Balance</td><td style="padding:7px 0;font-weight:800;color:#dc2626;">₦${balance.toLocaleString()}</td></tr>
            <tr style="background:#fef9c3;"><td style="padding:7px 8px;color:#6b7280;font-weight:600;">Alert Threshold</td><td style="padding:7px 8px;font-weight:700;color:#92400e;">₦${threshold.toLocaleString()}</td></tr>
          </table>
          <div style="padding:14px 16px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;">
            <p style="margin:0;font-weight:700;color:#92400e;font-size:14px;">Action Required</p>
            <p style="margin:8px 0 0;color:#92400e;font-size:13px;">Top up your Clubkonnect wallet at <a href="https://www.nellobytesystems.com" style="color:#d97706;font-weight:600;">nellobytesystems.com</a> before the balance reaches zero. New threshold can be set via the <strong>CK_WALLET_LOW_THRESHOLD</strong> Supabase secret.</p>
          </div>`,
      });

      for (const admin of (admins || [])) {
        if (admin.email) {
          try {
            await sendEmail(sb, {
              to: admin.email,
              subject: "[KudiTrack] ALERT: Low Clubkonnect wallet balance",
              html: alertHtml,
            });
          } catch (e) { console.error("Wallet alert email failed:", admin.email, (e as Error).message); }
        }
      }

      return json({ ok: true, balance, threshold, alerted: true, admins_notified: (admins || []).length });
    }

    // ── Read the CK wallet balance (naira), or null if it can't be determined ──
    const readWalletBalance = async (): Promise<number | null> => {
      const useKey = AIRTIME_K || DATA_K || ELECTRICITY_K || CABLETV_K || PRINT_AIRTIME_K;
      if (!USER_ID || !useKey) return null;
      try {
        const d = await ck("APIWalletBalanceV1.asp", { APIKey: useKey }, { retries: 1, timeoutMs: 12000 });
        for (const f of ["WalletBalance","walletbalance","wallet_balance","Balance","balance",
                         "AccountBalance","Wallet_Balance","WALLETBALANCE","available_balance","AvailableBalance"]) {
          const n = parseCkAmount(d[f]);
          if (n !== null) return n;
        }
      } catch (e) { console.warn("readWalletBalance failed:", (e as Error).message); }
      return null;
    };

    // ── Email super_admin + finance about a low provider wallet ───────────────
    const notifyWalletLow = async (balance: number | null, needed: number, ctx: string) => {
      try {
        const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
        // throttle: at most one wallet-low email per 30 min
        const { data: recent } = await sb.from("admin_notifications")
          .select("id").eq("type", "warning").ilike("title", "%wallet%")
          .gte("created_at", new Date(Date.now() - 30 * 60 * 1000).toISOString()).limit(1);
        if (recent && recent.length) return;

        await sb.from("admin_notifications").insert({
          type: "warning", title: "CK Wallet Too Low For Operations",
          message: `Provider wallet ₦${balance ?? "?"} cannot cover a ₦${Math.ceil(needed)} ${ctx}. Customers are being told to try again later. Top up now.`,
        });

        const { data: admins } = await sb.from("admin_users")
          .select("email").in("role", ["super_admin", "finance_admin"]).eq("is_active", true).not("email", "is", null);
        const html = billEmailHtml({
          accentColor: "linear-gradient(135deg,#dc2626,#b91c1c)", icon: "⚠",
          title: "Provider Wallet Too Low — Load It Now",
          subtitle: "Customers are being blocked from paying",
          body: `<p style="margin:0 0 14px;color:#374151;font-size:14px;">A customer just tried to buy <strong>${esc(ctx)}</strong> but the Clubkonnect wallet does not have enough balance to fulfil it. The payment was <strong>not taken</strong> — the customer was asked to try again later.</p>
            <table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 16px;">
              <tr><td style="padding:7px 0;color:#6b7280;width:170px;font-weight:600;">Current wallet balance</td><td style="padding:7px 0;font-weight:800;color:#dc2626;">₦${(balance ?? 0).toLocaleString()}</td></tr>
              <tr style="background:#fef9c3;"><td style="padding:7px 8px;color:#6b7280;font-weight:600;">Needed for this order</td><td style="padding:7px 8px;font-weight:700;color:#92400e;">₦${Math.ceil(needed).toLocaleString()}</td></tr>
            </table>
            <div style="padding:14px 16px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;">
              <p style="margin:0;font-weight:700;color:#991b1b;font-size:14px;">Action Required</p>
              <p style="margin:8px 0 0;color:#991b1b;font-size:13px;">Top up the Clubkonnect wallet at <a href="https://www.nellobytesystems.com" style="color:#dc2626;font-weight:600;">nellobytesystems.com</a>. Bill payments will keep failing until it is funded.</p>
            </div>`,
        });
        for (const a of (admins || [])) {
          if (a.email) {
            try { await sendEmail(sb, { to: a.email, subject: "[KudiTrack] URGENT: Load the bill-payment wallet — it's too low", html }); }
            catch (e) { console.error("wallet-low email failed:", a.email, (e as Error).message); }
          }
        }
      } catch (e) { console.error("notifyWalletLow error:", (e as Error).message); }
    };

    // ── Refresh ClubKonnect wholesale discount rates into platform_config ─────
    // Stores the raw CK responses plus a normalised { airtime:{NET:pct},
    // epin:{NET:pct} } map used for Enterprise pricing and the availability
    // pre-flight. Fallbacks (last known CK spread) fill in any network CK omits.
    const FALLBACK_AIRTIME: Record<string, number> = { MTN: 0.03, Airtel: 0.03, "9mobile": 0.07, Glo: 0.08 };
    const FALLBACK_EPIN:    Record<string, number> = { MTN: 0.01, Airtel: 0.02, "9mobile": 0.05, Glo: 0.02 };
    const refreshCkPrices = async (sb: ReturnType<typeof createClient>) => {
      const parsePct = (v: unknown): number | null => {
        if (v === null || v === undefined) return null;
        const n = Number(String(v).replace(/[^0-9.]/g, ""));
        return isNaN(n) ? null : (n > 1 ? n / 100 : n);
      };
      const NET_ALIAS: Record<string, string> = {
        MTN: "MTN", GLO: "Glo", AIRTEL: "Airtel",
        "9MOBILE": "9mobile", "M_9MOBILE": "9mobile", "M-9MOBILE": "9mobile", "9-MOBILE": "9mobile", ETISALAT: "9mobile",
      };
      // CK shape: { MOBILE_NETWORK: { MTN: [{ PRODUCT_DISCOUNT_AMOUNT: "0.97", PRODUCT_DISCOUNT: "3%" }] } }
      const discOf = (row: unknown): number | null => {
        const r = (Array.isArray(row) ? row[0] : row) as Record<string, unknown> | undefined;
        if (!r || typeof r !== "object") return null;
        const amt = Number(String(r.PRODUCT_DISCOUNT_AMOUNT ?? "").replace(/[^0-9.]/g, ""));
        if (!isNaN(amt) && amt > 0 && amt <= 1) return Number((1 - amt).toFixed(4)); // "0.97" → 0.03
        return parsePct(r.PRODUCT_DISCOUNT ?? r.DISCOUNT ?? r.discount);
      };
      const normalise = (raw: Record<string, unknown>): Record<string, number> => {
        const out: Record<string, number> = {};
        const mn = (raw?.MOBILE_NETWORK ?? raw?.mobile_network ?? raw) as Record<string, unknown> | undefined;
        if (!mn || typeof mn !== "object") return out;
        for (const [k, v] of Object.entries(mn)) {
          const net = NET_ALIAS[k.toUpperCase().replace(/\s+/g, "")];
          const p = discOf(v);
          if (net && p !== null && p >= 0 && p < 0.5) out[net] = p;
        }
        return out;
      };
      const [rawAirtime, rawEpin] = await Promise.all([
        ck("APIAirtimeDiscountV1.asp", { APIKey: AIRTIME_K }, { retries: 1, timeoutMs: 15000 }).catch(() => ({})),
        ck("APIEPINDiscountV2.asp",    { APIKey: PRINT_AIRTIME_K }, { retries: 1, timeoutMs: 15000 }).catch(() => ({})),
      ]);
      const airtimeLive = normalise(rawAirtime as Record<string, unknown>);
      const epinLive    = normalise(rawEpin as Record<string, unknown>);
      const discounts = {
        // for pricing — always covers all 4 networks
        airtime: { ...FALLBACK_AIRTIME, ...airtimeLive },
        epin:    { ...FALLBACK_EPIN, ...epinLive },
        // for availability — only what CK actually returned this refresh
        airtime_live: airtimeLive,
        epin_live:    epinLive,
        raw_airtime: rawAirtime, raw_epin: rawEpin,
      };
      await sb.from("platform_config").upsert([
        { key: "ck_discounts", value: JSON.stringify(discounts), description: "ClubKonnect wholesale discounts (auto)" },
        { key: "ck_discounts_updated", value: new Date().toISOString(), description: "Last ck_discounts refresh" },
      ], { onConflict: "key" });
      return discounts;
    };

    if (action === "refresh-ck-prices") {
      const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
      const discounts = await refreshCkPrices(sb);
      return json({ ok: true, discounts });
    }

    // ── Pre-flight a bill before the customer is charged ──────────────────────
    // Confirms the provider wallet can cover the order and (for print/EPIN) that
    // the requested network is actually available. Never takes a payment.
    if (action === "bill-preflight") {
      const { cat, network, amount, denom } = body as {
        cat: string; network?: string; amount: number; denom?: string;
      };
      const cost = Number(amount) || 0;
      if (!cat || cost <= 0) return json({ ok: false, reason: "bad_request", message: "Invalid request." });

      // Outage check: is ClubKonnect's purchase route for this service actually up? If it's crashing (as on
      // 2026-09-28) the customer would be debited, the order would fail and they'd be refunded — stop BEFORE charging
      // instead, unless the backup (V3) route is enabled for this service and is itself up. Unknown never blocks.
      // With the provider switch, airtime and data may also go to VTpass: the sale is only paused when EVERY provider this
      // order could go to is down.
      const routeCfg = await routeConfig();
      const route = PREFLIGHT_ROUTE[cat];
      const order: Provider[] = VT_SERVICES.has(cat) ? await providerOrderFor(cat) : ["clubkonnect"];
      let ckDown: string | null = null;   // why ClubKonnect can't take it right now (null = it can, or we can't tell)
      if (order.includes("clubkonnect") && route && routeCfg.healthcheckOn) {
        const [svc, mainPath] = route;
        const forced = routeCfg.forceV3.has(svc);
        const main = await routeHealth(forced ? V3_PATH[mainPath] : mainPath);
        if (main === "down") {
          const backupUp = !forced && routeCfg.fallbackOn && routeCfg.fallbackServices.has(svc) &&
            (await routeHealth(V3_PATH[mainPath])) === "up";
          if (!backupUp) ckDown = forced ? "backup route (test mode)" : "main route";
        }
        // …and is the purchase service behind the login check working for OUR account? (see purchaseServiceHealth)
        // (No longer asks purchaseServiceHealth: on 2026-09-30 a real N50 airtime order went through while its must-refuse
        // test orders still got IIS 503 — ClubKonnect answers INVALID orders from a real account with that page, so the
        // probe paused every sale for ~36 h while ClubKonnect was taking orders. Diagnostic only now, in route-check.)
      }
      const vtDown = order.includes("vtpass") && (await vtHealth()) === "down";
      const available = order.filter((p) => (p === "vtpass" ? !vtDown : !ckDown));
      if (!available.length) {
        const detail = [ckDown && (order.length > 1 ? `ClubKonnect: ${ckDown}` : ckDown), vtDown && "VTpass: down"].filter(Boolean).join("; ");
        afterResponse(sendRouteAlert({ svc: route?.[0] ?? cat, outcome: "blocked", detail }));
        return json({ ok: false, reason: "provider_down", message: "This service is temporarily unavailable. Please try again later — you have not been charged." });
      }
      // VTpass takes it (ClubKonnect's wallet and discounts don't apply; an empty VTpass wallet moves the order back).
      if (available[0] === "vtpass") return json({ ok: true, balance: null, provider: "vtpass", discounts: { airtime: {}, epin: {} } });
      const vtBackup = available.includes("vtpass");   // a ClubKonnect refusal for an empty wallet would move the order to VTpass

      const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
      const { data: cfgRows } = await sb.from("platform_config").select("key, value").in("key", ["ck_discounts", "ck_discounts_updated", "ck_wallet_min_buffer"]);
      const cfg: Record<string, string> = {};
      (cfgRows || []).forEach((r) => { cfg[r.key] = r.value; });
      let disc: { epin?: Record<string, number>; epin_live?: Record<string, number>; airtime?: Record<string, number> } = {};
      try { disc = JSON.parse(cfg.ck_discounts || "{}"); } catch { /* keep {} */ }
      const buffer = Number(cfg.ck_wallet_min_buffer || "0") || 0;

      // Lazily refresh discount + availability data when missing or older than 24h.
      const stale = !cfg.ck_discounts_updated ||
        (Date.now() - Date.parse(cfg.ck_discounts_updated) > 24 * 60 * 60 * 1000);
      if (!disc.epin || Object.keys(disc.epin).length === 0 || stale) {
        try { disc = await refreshCkPrices(sb); } catch (e) { console.warn("lazy price refresh failed:", (e as Error).message); }
      }

      // Availability: for the resale products, a network CK didn't return this
      // refresh (epin_live) is treated as out of stock — only enforced when we
      // actually got a live list back.
      if ((cat === "print-airtime" || cat === "airtime-bundle") && network) {
        const live = disc.epin_live || {};
        if (Object.keys(live).length > 0) {
          const nets = cat === "airtime-bundle" ? ["MTN", "Airtel", "9mobile", "Glo"] : [network];
          const missing = nets.filter((n) => live[n] == null);
          if (missing.length) {
            return json({
              ok: false, reason: "unavailable",
              message: `${missing.join(", ")} print recharge isn't available right now. Please try again later — you have not been charged.`,
            });
          }
        }
      }

      // Wallet: alert, and block if it can't cover the order — unless VTpass can take it instead (then ClubKonnect's
      // "insufficient balance" moves the order there; the admins still hear that the wallet is low).
      const balance = await readWalletBalance();
      if (balance !== null && balance < cost + buffer) {
        const label = cat === "airtime-bundle" ? `bundle set${denom ? ` (₦${denom})` : ""}`
          : cat === "print-airtime" ? "airtime print"
          : cat === "print-data" ? "data print" : cat;
        await notifyWalletLow(balance, cost + buffer, label);
        if (vtBackup) return json({ ok: true, balance, provider: "vtpass", discounts: { airtime: disc.airtime ?? {}, epin: disc.epin ?? {} } });
        return json({
          ok: false, reason: "wallet_low",
          message: "This service is temporarily unavailable. Please try again later — you have not been charged.",
        });
      }

      return json({ ok: true, balance, discounts: { airtime: disc.airtime ?? {}, epin: disc.epin ?? {} } });
    }

    // ── ClubKonnect request variants (service-only diagnostic) ─────────────────
    // Since 2026-09-28 ~20:30 UTC every purchase from our account gets IIS 503 "The service is unavailable" while the same
    // order on ClubKonnect's website works. This sends ONE order ClubKonnect must refuse (network 99, ₦1, phone "0") in
    // several shapes — host, scheme, callback, user agent, method — to find any that gets a real (JSON) answer. Returns
    // statuses only; with includeUser the UserID too, for the workflow's test from another IP (it masks it at once).
    //
    // mode "insufficient": a VALID order that can't be paid for — MTN airtime of (wallet balance + ₦5,000), capped at
    // ₦49,000 (skipped above that), to the account's own number. Accepted credentials → INSUFFICIENT_BALANCE (nothing
    // bought); rejected → INVALID_CREDENTIALS. Returns statuses + short SHA-256 fingerprints of the key / UserID (to compare
    // with the GitHub secret) — never the key, the balance or the number.
    if (action === "ck-variants" && (body as { mode?: unknown }).mode === "insufficient") {
      const fp = async (v: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)))].slice(0, 6).map((b) => b.toString(16).padStart(2, "0")).join("");
      const bal = await ck("APIWalletBalanceV1.asp", { APIKey: AIRTIME_K }, { retries: 0, timeoutMs: 15000 }).catch(() => ({} as Record<string, unknown>));
      const balance = parseCkAmount(bal.balance ?? bal.Balance ?? bal.WalletBalance);
      const phone = String(bal.phoneno ?? bal.PhoneNo ?? "").replace(/\D/g, "");
      const base = { keyFp: await fp(AIRTIME_K), userFp: await fp(USER_ID), balanceRead: balance !== null, phoneRead: phone.length >= 10 };
      if (balance === null || phone.length < 10) return json({ ...base, skipped: "could not read the balance / number" });
      const amount = Math.ceil((balance + 5000) / 100) * 100;
      if (amount > 49_000) return json({ ...base, skipped: "balance too high for a safe unpayable order" });
      let reply: Record<string, unknown>;
      try {
        reply = await ck("APIAirtimeV1.asp", { APIKey: AIRTIME_K, MobileNetwork: "01", Amount: String(amount), MobileNumber: phone, RequestID: `KDT-PROBE-${Date.now()}`, CallBackURL: "https://kudiai.app/" }, { retries: 0, timeoutMs: 20000 });
      } catch (e) { return json({ ...base, http: 0, status: `unreachable: ${(e as Error).message}` }); }
      if (isOk(reply)) console.error("[ck-variants] an order meant to be unpayable was ACCEPTED — investigate", JSON.stringify({ ...reply, walletbalance: "<hidden>" }));
      return json({ ...base, amountRule: "balance + N5,000", http: reply._http ?? 200,
        status: typeof reply._raw === "string" ? `page: ${String(reply._raw).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 60)}` : String(reply.status ?? reply.Status ?? "(no status)") });
    }

    if (action === "ck-variants") {
      const rid = () => `KUDIAI-HEALTH-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const params = (extra: Record<string, string | null> = {}) => {
        const p: Record<string, string> = { UserID: USER_ID, APIKey: AIRTIME_K, MobileNetwork: "99", Amount: "1", MobileNumber: "0", RequestID: rid(), CallBackURL: "https://kudiai.app/" };
        for (const [k, v] of Object.entries(extra)) { if (v === null) delete p[k]; else p[k] = v; }
        return p;
      };
      const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
      const variants: [string, string, "GET" | "POST", Record<string, string | null>, Record<string, string>][] = [
        ["as-is", "https://www.nellobytesystems.com/APIAirtimeV1.asp", "GET", {}, { Accept: "application/json" }],
        ["no-callback", "https://www.nellobytesystems.com/APIAirtimeV1.asp", "GET", { CallBackURL: null }, { Accept: "application/json" }],
        ["no-www", "https://nellobytesystems.com/APIAirtimeV1.asp", "GET", {}, { Accept: "application/json" }],
        ["http", "http://www.nellobytesystems.com/APIAirtimeV1.asp", "GET", {}, { Accept: "application/json" }],
        ["browser-ua", "https://www.nellobytesystems.com/APIAirtimeV1.asp", "GET", {}, { "User-Agent": UA, Accept: "text/html,application/json,*/*" }],
        ["post-form", "https://www.nellobytesystems.com/APIAirtimeV1.asp", "POST", {}, { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }],
        ["clubkonnect-host", "https://www.clubkonnect.com/APIAirtimeV1.asp", "GET", {}, { Accept: "application/json" }],
        ["data-script", "https://www.nellobytesystems.com/APIDatabundleV1.asp", "GET", { MobileNetwork: "01", DataPlan: "KUDIAI-NO-SUCH-PLAN" }, { Accept: "application/json" }],
      ];
      const results = await Promise.all(variants.map(async ([name, url, method, extra, headers]) => {
        const qs = new URLSearchParams(params(extra)).toString();
        try {
          const res = await fetch(method === "GET" ? `${url}?${qs}` : url, { method, headers, body: method === "POST" ? qs : undefined, signal: AbortSignal.timeout(15_000), redirect: "manual" });
          const text = await res.text();
          let status = "";
          try { const j = JSON.parse(text); status = String(j.status ?? j.Status ?? JSON.stringify(j).slice(0, 80)); }
          catch { status = "page: " + text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80); }
          return { name, http: res.status, location: res.headers.get("location") ?? undefined, status };
        } catch (e) { return { name, http: 0, status: `unreachable: ${(e as Error).message.slice(0, 60)}` }; }
      }));
      if (results.some((r) => /^(ORDER_RECEIVED|ORDER_COMPLETED)/.test(r.status))) console.error("[ck-variants] ClubKonnect ACCEPTED an unfulfillable test order — investigate", JSON.stringify(results));
      return json({ results, ...((body as { includeUser?: unknown }).includeUser === true ? { userId: USER_ID } : {}) });
    }

    // ── Bill provider status (service-only; the admin portal's Bill provider page) ──
    // Fresh health of both providers, the switches, and where a new airtime / data order would go right now.
    // Statuses only — never keys, balances or customer data.
    if (action === "provider-status") {
      healthCache.clear(); svcHealth = null; vtHealthCache = null; provCfgCache = null;
      const cfg = await providerConfig();
      const services = [...VT_SERVICES];
      const [ckHealths, vt] = await Promise.all([Promise.all(services.map((s) => ckHealth(s))), vtHealth()]);
      const orders = await Promise.all(services.map((s) => providerOrderFor(s)));
      const rc = await routeConfig();
      return json({
        config: cfg,
        services,
        vtpass: { configured: vtConfigured(VT), env: VT.env, live: vtUsable(), health: vtConfigured(VT) ? vt : "unknown" },
        clubkonnect: { health: Object.fromEntries(services.map((s, i) => [s, ckHealths[i]])), healthCheckOn: rc.healthcheckOn },
        routing: Object.fromEntries(services.map((s, i) => [s, orders[i]])),
        checkedAt: new Date().toISOString(),
      });
    }

    // ── VTpass explore (service-only, SANDBOX ONLY) ───────────────────────────
    // Records VTpass's real answers for cable TV, electricity, WAEC and Smile — catalogues, customer checks and one
    // sandbox purchase each (VTpass's published sandbox test numbers; play money) — before any routing relies on them.
    if (action === "vtpass-explore") {
      if (!vtConfigured(VT)) return json({ error: "VTpass keys are not configured" });
      if (VT.env !== "sandbox") return json({ error: "Refused: VTpass is live — explore only ever runs against the sandbox." });
      const clip = (v: unknown, n = 160) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s == null ? null : s.length > n ? s.slice(0, n) + "…" : s; };
      const shape = (d: VtResult) => {
        const c = (d.content ?? {}) as Record<string, unknown>, t = vtTxn(d);
        const top: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(d)) if (k !== "content" && !k.startsWith("_")) top[k] = clip(v);
        const content: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(c)) if (k !== "transactions" && k !== "varations" && k !== "variations") content[k] = clip(v, 220);
        return { http: d._http ?? null, top, content, txStatus: vtTxnStatus(d) || null, txKeys: Object.keys(t), raw: typeof d._raw === "string" ? clip(d._raw) : undefined };
      };
      const vars = async (sid: string) => {
        const d = await vtCall(vtFetch, VT, "GET", `/service-variations?serviceID=${encodeURIComponent(sid)}`, undefined, 20_000);
        const list = ((d.content as Record<string, unknown> | undefined)?.varations ?? (d.content as Record<string, unknown> | undefined)?.variations ?? []) as Record<string, unknown>[];
        return { sid, http: d._http ?? null, desc: d.response_description ?? null, count: Array.isArray(list) ? list.length : 0,
          sample: (Array.isArray(list) ? list : []).slice(0, 4).map((v) => ({ code: v.variation_code, name: clip(v.name, 60), amount: v.variation_amount, fixed: v.fixedPrice })) };
      };
      const verify = async (sid: string, billersCode: string, type?: string) =>
        ({ sid, billersCode, type: type ?? null, ...shape(await vtCall(vtFetch, VT, "POST", "/merchant-verify", { billersCode, serviceID: sid, ...(type ? { type } : {}) }, 30_000)) });
      const now = Date.now();
      let n = 0;
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const buy = async (label: string, body: Record<string, unknown>) => {
        const requestId = vtRequestId(`KDT-BILL-${now + ++n}`, now);
        const pay = await vtCall(vtFetch, VT, "POST", "/pay", { request_id: requestId, ...body }, 60_000);
        const rq = await vtCall(vtFetch, VT, "POST", "/requery", { request_id: requestId }, 30_000);
        return { label, requestId, pay: shape(pay), requery: { code: vtCode(rq) || null, txStatus: vtTxnStatus(rq) || null, top: shape(rq).top } };
      };
      // Optional: just these electricity cases — [serviceID, "prepaid"|"postpaid", amount] — verify + buy each (spaced for the 15 s rule).
      const electric = (body as { electric?: unknown }).electric;
      if (Array.isArray(electric) && electric.length) {
        const out = [];
        for (const [i, [sid, type, amount]] of (electric as [string, string, number][]).slice(0, 4).entries()) {
          const meter = type === "prepaid" ? "1111111111111" : "1010101010101";
          const v = await verify(sid, meter, type);
          if (i > 0) await sleep(16_000);
          out.push({ sid, type, amount, verify: v, buy: await buy(`${sid} ${type} ${amount}`, { serviceID: sid, billersCode: meter, variation_code: type, amount, phone: `080${61111111 + i}` }) });
        }
        return json({ env: VT.env, electric: out });
      }
      const catalogues = await Promise.all(["dstv", "gotv", "startimes", "showmax", "waec", "waec-registration", "smile-direct", "ikeja-electric"].map(vars));
      const verifies = [];
      for (const [sid, code, type] of [["dstv", "1212121212"], ["gotv", "1212121212"], ["startimes", "1212121212"], ["dstv", "0000000001"],
        ["ikeja-electric", "1111111111111", "prepaid"], ["ikeja-electric", "1010101010101", "postpaid"], ["ikeja-electric", "12345", "prepaid"],
        ["smile-direct", "tester@sandbox.com"], ["smile-direct", "08011111111"]] as [string, string, string?][]) verifies.push(await verify(sid, code, type));
      const cheapest = (sid: string) => { const c = catalogues.find((x) => x.sid === sid); return c?.sample?.length ? [...c.sample].sort((a, b) => Number(a.amount) - Number(b.amount))[0] : null; };
      const buys = [];
      const plan = (sid: string) => String(cheapest(sid)?.code ?? "");
      const steps: [string, Record<string, unknown>][] = [
        ["dstv change", { serviceID: "dstv", billersCode: "1212121212", variation_code: plan("dstv"), phone: "08021111111", subscription_type: "change", quantity: 1 }],
        ["gotv change", { serviceID: "gotv", billersCode: "1212121212", variation_code: plan("gotv"), phone: "08031111111", subscription_type: "change", quantity: 1 }],
        ["startimes", { serviceID: "startimes", billersCode: "1212121212", variation_code: plan("startimes"), phone: "08041111111" }],
        ["electricity prepaid", { serviceID: "ikeja-electric", billersCode: "1111111111111", variation_code: "prepaid", amount: 1000, phone: "08051111111" }],
        ["electricity postpaid", { serviceID: "ikeja-electric", billersCode: "1010101010101", variation_code: "postpaid", amount: 1000, phone: "08061111111" }],
        ["waec result checker", { serviceID: "waec", variation_code: plan("waec"), quantity: 1, phone: "08071111111" }],
        ["waec registration", { serviceID: "waec-registration", variation_code: plan("waec-registration"), quantity: 1, phone: "08081111111" }],
        ["smile", { serviceID: "smile-direct", billersCode: "tester@sandbox.com", variation_code: plan("smile-direct"), phone: "08091111111" }],
      ];
      for (const [label, body] of steps) { buys.push(await buy(label, body)); await new Promise((r) => setTimeout(r, 1200)); }
      return json({ env: VT.env, catalogues, verifies, buys });
    }

    // ── VTpass sandbox proof (service-only, SANDBOX ONLY) ─────────────────────
    // VTpass grants live access only after seeing a successful sandbox order for each service we integrate. For one group
    // per call (airtime, data, cable, electricity-1..4, education, smile) this places one order per service
    // through the SAME request-id builder, order bodies and mappings real orders use, to VTpass's sandbox test numbers,
    // checks the customer number first where the form asks about it, and confirms each order by requery.
    // Returns the request IDs to put on VTpass's "Request API access" form. Refuses outright once VTpass is live.
    if (action === "vtpass-sandbox-proof") {
      if (!vtConfigured(VT)) return json({ error: "VTpass keys are not configured" });
      if (VT.env !== "sandbox") return json({ error: "Refused: VTpass is live — the proof only ever runs against the sandbox." });
      const group = String((body as { group?: unknown }).group ?? "airtime");
      const now = Date.now();
      let n = 0;
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const results: Record<string, unknown>[] = [];
      // Every order goes through the production pieces: vtRequestId + the vt*Body builders + the same mappings.
      const order = async (service: string, serviceID: string, payBody: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
        const requestId = vtRequestId(`KDT-BILL-${now + ++n}`, now);
        const pay = await vtCall(vtFetch, VT, "POST", "/pay", { request_id: requestId, ...payBody }, 60_000);
        const rq = await vtCall(vtFetch, VT, "POST", "/requery", { request_id: requestId }, 30_000);
        results.push({
          service, serviceID, requestId, ...extra,
          payCode: vtCode(pay) || null, payDesc: String(pay.response_description ?? "").slice(0, 60) || null,
          status: vtTxnStatus(rq) || vtTxnStatus(pay) || null, confirmed: classifyVt(rq) === "delivered",
          token: serviceID.endsWith("-electric") ? (vtElectricToken(rq) ? "yes" : "none") : undefined,
          pins: serviceID.startsWith("waec") ? (vtCardDetails(rq) ? "yes" : "none") : undefined,
        });
      };
      const check = async (sid: string, code: string, type?: string) => {
        const c = vtCustomer(await vtCall(vtFetch, VT, "POST", "/merchant-verify", { billersCode: code, serviceID: sid, ...(type ? { type } : {}) }, 30_000));
        return { verified: c.kind === "ok", verifiedName: c.kind === "ok" ? c.name : c.kind === "invalid" ? `invalid: ${c.message.slice(0, 60)}` : "unavailable" };
      };
      const cheapest = async (sid: string, avoid = new Set<number>()) =>
        (await vtCatalogue(sid)).sort((x, y) => x.plan_amount - y.plan_amount).find((p) => !avoid.has(p.plan_amount)) ?? null;
      // VTpass refuses a second order to the same recipient within 15 s (019) — so recipients alternate and orders are spaced.
      if (group === "airtime") {
        const PHONE = "08011111111", nets = ["MTN", "Airtel", "Glo", "9mobile"];
        for (const [i, net] of nets.entries()) {
          const a = airtimeServiceId(net)!;
          if (i > 0) await sleep(16_000);
          await order(`${net} Airtime VTU`, a, vtAirtimeBody(a, 150 + 10 * i, PHONE));
        }
      } else if (group === "data") {
        const PHONE = "08011111111", used = new Set<number>(), nets = ["MTN", "Airtel", "Glo", "9mobile"];
        for (const [i, net] of nets.entries()) {
          if (i > 0) await sleep(16_000);
          const d = dataServiceId(net)!, pick = await cheapest(d, used);
          if (!pick) { results.push({ service: `${net} Data`, serviceID: d, error: "no plan listed" }); continue; }
          used.add(pick.plan_amount);
          await order(`${net} Data`, d, vtDataBody(d, vtPlanCode(pick.plan_id), PHONE), { variation: `${vtPlanCode(pick.plan_id)} — ${pick.plan_name}` });
        }
      } else if (group === "cable") {
        const CARD = "1212121212";
        for (const [i, provider] of ["dstv", "gotv", "startimes"].entries()) {
          const v = await check(provider, CARD), pick = await cheapest(provider);
          if (!pick) { results.push({ service: provider, serviceID: provider, error: "no bouquet listed", ...v }); continue; }
          if (i > 0) await sleep(16_000);
          await order(provider === "dstv" ? "DSTV Subscription" : provider === "gotv" ? "Gotv Payment" : "Startimes Subscription", provider,
            vtCableBody(provider, CARD, vtPlanCode(pick.plan_id), `080${31111111 + i}`), { ...v, variation: `${vtPlanCode(pick.plan_id)} — ${pick.plan_name}` });
        }
      } else if (/^electricity-[1-4]$/.test(group)) {
        const codes = [["01", "02", "03"], ["04", "05", "06"], ["07", "08", "09"], ["10", "11", "12"]][Number(group.slice(-1)) - 1];
        for (const [i, code] of codes.entries()) {
          const sid = VT_ELECTRIC[code], prepaid = i % 2 === 0;   // alternate the two test meters: the same meter comes round every other order
          const meter = prepaid ? "1111111111111" : "1010101010101", mt = prepaid ? "prepaid" as const : "postpaid" as const;
          // each disco has its own minimum — the meter check says what it is
          const vr = await vtCall(vtFetch, VT, "POST", "/merchant-verify", { billersCode: meter, serviceID: sid, type: mt }, 30_000);
          const c = vtCustomer(vr), content = (vr.content ?? {}) as Record<string, unknown>;
          const minimum = Math.max(1000, Number(content.Min_Purchase_Amount) || 0, Number(content.Minimum_Amount) || 0);
          if (i > 0) await sleep(9_000);
          const checked = { verified: c.kind === "ok", verifiedName: c.kind === "ok" ? c.name : c.kind === "invalid" ? `invalid: ${c.message.slice(0, 60)}` : "unavailable" };
          await order(sid, sid, vtElectricBody(sid, meter, mt, minimum, `080${51111111 + i}`), { ...checked, variation: `${mt} ₦${minimum}` });
          // a disco whose minimum the meter check doesn't state (Ibadan, Kaduna in the sandbox) → once more, higher (013 placed nothing)
          if (results[results.length - 1]?.payCode === "013") {
            results.pop();
            await sleep(16_000);
            await order(sid, sid, vtElectricBody(sid, meter, mt, 5000, `080${51111111 + i}`), { ...checked, variation: `${mt} ₦5000` });
          }
        }
      } else if (group === "education") {
        for (const [i, examType] of ["waecdirect", "waec-registration"].entries()) {
          const b = vtWaecBody(examType, `080${71111111 + i}`)!;
          await order(examType === "waecdirect" ? "WAEC Result Checker PIN" : "WAEC Registration PIN", String(b.serviceID), b, { variation: String(b.variation_code) });
          await sleep(3_000);
        }
      } else if (group === "smile") {
        // In the sandbox only VTpass's test email verifies; the account to pay is the AccountId it lists.
        const vr = await vtCall(vtFetch, VT, "POST", "/merchant-verify", { billersCode: "tester@sandbox.com", serviceID: VT_SMILE }, 30_000);
        const c = vtCustomer(vr);
        let acct = "";
        try {
          const raw = ((vr.content ?? {}) as Record<string, unknown>).AccountList;
          const list = (typeof raw === "string" ? JSON.parse(raw) : raw) as { Account?: { AccountId?: unknown }[] } | undefined;
          acct = String(list?.Account?.[0]?.AccountId ?? "");
        } catch { /* none */ }
        const pick = await cheapest(VT_SMILE);
        if (!acct || !pick) results.push({ service: "Smile Payment", serviceID: VT_SMILE, error: !acct ? "no account listed" : "no plan listed", verified: c.kind === "ok" });
        else await order("Smile Payment", VT_SMILE, vtSmileBody(acct, vtPlanCode(pick.plan_id), acct),
          { verified: c.kind === "ok", verifiedName: c.kind === "ok" ? c.name : null, variation: `${vtPlanCode(pick.plan_id)} — ${pick.plan_name}` });
      } else {
        return json({ error: `unknown group "${group}" (airtime, data, cable, electricity-1..4, education, smile)` });
      }
      return json({ env: VT.env, group, results });
    }

    // ── VTpass contract probe (service-only) ─────────────────────────────────
    // Records how VTpass REALLY answers each case the routing relies on, instead of trusting its docs: a lookup of an order
    // that doesn't exist, the request_id format, and — in the SANDBOX only (play money, VTpass's published test numbers) —
    // a delivered / pending / odd-answer / failed order, a repeat of the same request_id, and a data plan purchase.
    // In live it only looks up made-up orders (free, places nothing). Returns codes, statuses and field NAMES — no keys.
    if (action === "vtpass-probe") {
      const out: Record<string, unknown> = { env: VT.env, configured: vtConfigured(VT), publicKeySet: !!VT.publicKey };
      if (!vtConfigured(VT)) return json(out);
      const f: typeof fetch = (u, i) => fetch(u, i);
      const sum = (d: VtResult, rid?: string) => {
        const c = (d.content ?? {}) as Record<string, unknown>, t = vtTxn(d);
        return {
          http: d._http ?? null, code: vtCode(d) || null, desc: String(d.response_description ?? "").slice(0, 90) || null,
          txStatus: vtTxnStatus(d) || null, contentKeys: Object.keys(c).slice(0, 15), txKeys: Object.keys(t).slice(0, 30),
          topKeys: Object.keys(d).filter((k) => !k.startsWith("_")).slice(0, 20),
          ridEchoed: rid ? String(d.requestId ?? "") === rid : undefined,
          totalAmount: t.total_amount ?? null, commission: t.commission ?? null, amount: t.amount ?? d.amount ?? null,
          hasTxnId: !!(t.transactionId ?? d.transactionId),
          raw: typeof d._raw === "string" ? d._raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) : undefined,
          unreachable: d._unreachable ? String(d._error ?? "yes") : undefined,
        };
      };
      const requery = (rid: string) => vtCall(f, VT, "POST", "/requery", { request_id: rid }, 30_000);
      const now = Date.now();
      const madeUp = vtRequestId(`KDT-BILL-${now}`, now) + "PROBE";
      const [rqMadeUp, rqMalformed, variations] = await Promise.all([
        requery(madeUp), requery("KUDIAIPROBE"), vtCall(f, VT, "GET", "/service-variations?serviceID=mtn-data", undefined, 30_000),
      ]);
      const plans = parseVariations(variations);
      Object.assign(out, {
        requeryMadeUp: sum(rqMadeUp, madeUp), requeryMalformed: sum(rqMalformed),
        variations: { ...sum(variations), plans: plans.length, first: plans[0] ?? null },
      });
      if (VT.env !== "sandbox") return json(out);

      // Sandbox purchases: each order gets its own KDT-BILL-<ms> reference, exactly as the app's orders do.
      const buy = async (i: number, label: string, body: Record<string, unknown>) => {
        const rid = vtRequestId(`KDT-BILL-${now + i}`, now);
        const pay = await vtCall(f, VT, "POST", "/pay", { request_id: rid, ...body }, 45_000);
        const rq = await requery(rid);
        return { label, ridLength: rid.length, pay: sum(pay, rid), requery: sum(rq, rid), rid };
      };
      const cases = await Promise.all([
        buy(1, "airtime 08011111111 (sandbox: success)", { serviceID: "mtn", amount: 100, phone: "08011111111" }),
        buy(2, "airtime 201000000000 (sandbox: pending)", { serviceID: "mtn", amount: 100, phone: "201000000000" }),
        buy(3, "airtime 500000000000 (sandbox: unexpected)", { serviceID: "mtn", amount: 100, phone: "500000000000" }),
        buy(4, "airtime 08033333333 (sandbox: other number)", { serviceID: "mtn", amount: 100, phone: "08033333333" }),
        plans[0] ? buy(5, "data first plan 08011111111", { serviceID: "mtn-data", billersCode: "08011111111", variation_code: plans[0].plan_id.slice(3), phone: "08011111111" })
                 : Promise.resolve({ label: "data", skipped: "no plans" }),
      ]);
      // the same request_id again — VTpass must refuse to place it twice
      const first = cases[0] as { rid: string };
      const again = await vtCall(f, VT, "POST", "/pay", { request_id: first.rid, serviceID: "mtn", amount: 100, phone: "08011111111" }, 45_000);
      // a request_id without the date prefix
      const noDate = await vtCall(f, VT, "POST", "/pay", { request_id: `KDT${now}NODATE`, serviceID: "mtn", amount: 100, phone: "08011111111" }, 45_000);
      Object.assign(out, {
        cases: cases.map((c) => { const { rid: _r, ...rest } = c as Record<string, unknown>; return rest; }),
        repeatSameRequestId: sum(again, first.rid), requestIdWithoutDate: sum(noDate),
        airtimeSids: { MTN: airtimeServiceId("MTN"), "9mobile": airtimeServiceId("9mobile") }, dataSid: dataServiceId("Airtel"),
      });
      return json(out);
    }

    // ── Route check (service-only, read-only, free) ───────────────────────────
    // Health of every main + backup purchase script (made-up account — never ours), plus a lookup, with OUR account,
    // of an order that can't exist: shows ClubKonnect's real "no such order" reply, which the fallback depends on.
    // Returns statuses and field names only — never keys or customer data.
    if (action === "route-check") {
      healthCache.clear(); svcHealth = null;
      const paths = [...Object.keys(V3_PATH), ...Object.values(V3_PATH)];
      const canary: Record<string, string> = {};
      await Promise.all(paths.map(async (p) => { canary[p] = await routeHealth(p); }));
      const purchaseService = await purchaseServiceHealth();
      const probe = await lookupOrder(AIRTIME_K, `KUDIAI-ROUTECHECK-${Date.now()}`);
      const q = probe.q ?? {};
      // Dry runs with OUR account — every one is an order ClubKonnect cannot fulfil (below the ₦50 minimum, a network code
      // that doesn't exist, a plan that doesn't exist), so it's refused with nothing placed. A JSON refusal = the script
      // got past our login and is working; a crash page = it's broken for real (authenticated) orders, which the
      // made-up-account probe can't see.
      const dry = async (path: string, key: string, extra: Record<string, string>) => {
        try {
          const d = await ck(path, { APIKey: key, MobileNumber: "08000000000", RequestID: `KUDIAI-DRYRUN-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, CallBackURL: "https://kudiai.app/", ...extra }, { retries: 0, timeoutMs: 15000 });
          if (typeof d._raw === "string") {
            // what the error page actually says (ClubKonnect's own text, tags stripped) — it may name the reason
            const txt = d._raw.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
            return `crash page (HTTP ${d._http}): ${txt}`;
          }
          return String(d.status ?? d.Status ?? JSON.stringify(Object.keys(d)));
        } catch (e) { return `unreachable: ${(e as Error).message}`; }
      };
      const [dryV1, dryV3, dryV1Net, dryV1Plan] = await Promise.all([
        dry("APIAirtimeV1.asp", AIRTIME_K, { MobileNetwork: "01", Amount: "1" }),
        dry("APIAirtimeV3.asp", AIRTIME_K, { MobileNetwork: "01", Amount: "1" }),
        dry("APIAirtimeV1.asp", AIRTIME_K, { MobileNetwork: "99", Amount: "50" }),
        dry("APIDatabundleV1.asp", DATA_K, { MobileNetwork: "01", DataPlan: "KUDIAI-NO-SUCH-PLAN" }),
      ]);
      // Is each service's key accepted? The wallet-balance lookup checks UserID + APIKey (catalogue lists don't check
      // credentials at all). Reports only "valid" or ClubKonnect's status — never the balance.
      const KEYS: Record<string, string> = {
        airtime: AIRTIME_K, data: DATA_K, cable: CABLETV_K, electricity: ELECTRICITY_K, betting: BETTING_K, waec: WAEC_K,
        jamb: JAMB_K, spectranet: SPECTRANET_K, smile: SMILE_K, "print-airtime": PRINT_AIRTIME_K, "print-data": PRINT_DATA_K,
      };
      const keys: Record<string, string> = {};
      await Promise.all(Object.entries(KEYS).map(async ([svc, k]) => {
        if (!k) { keys[svc] = "not configured"; return; }
        try {
          const d = await ck("APIWalletBalanceV1.asp", { APIKey: k }, { retries: 0, timeoutMs: 15000 });
          if (typeof d._raw === "string") { keys[svc] = `crash page (HTTP ${d._http})`; return; }
          const s = String(d.status ?? d.Status ?? "").trim();
          keys[svc] = s && /INVALID|MISSING|UNAUTHOR|DENIED|BLOCK|WHITELIST|\bIP\b/i.test(s) ? s : "valid";
        } catch (e) { keys[svc] = `unreachable: ${(e as Error).message}`; }
      }));
      let egressIp = "unknown";
      try { egressIp = (await (await fetch("https://api.ipify.org", { signal: AbortSignal.timeout(5000) })).text()).trim(); } catch { /* optional */ }
      const cfg = await routeConfig();
      return json({
        canary,
        purchaseService,
        dryRun: { airtimeV1: dryV1, airtimeV3: dryV3, airtimeV1BadNetwork: dryV1Net, dataV1BadPlan: dryV1Plan },
        keys,
        account: { userIdSet: !!USER_ID, userIdLooksLikeCk: /^CK\d+$/i.test(USER_ID), egressIp },
        lookup: { kind: probe.kind, status: q.status ?? q.Status ?? null, statuscode: q.statuscode ?? q.StatusCode ?? null, fields: Object.keys(q) },
        config: { fallbackOn: cfg.fallbackOn, fallbackServices: [...cfg.fallbackServices], forceV3: [...cfg.forceV3], healthcheckOn: cfg.healthcheckOn },
      });
    }

    // ── Health check — test every service key in parallel ─────────────────────
    if (action === "health-check") {
      // Only check the top-level status field — never scan the whole JSON body
      // which may contain "INVALID" in product names, IDs, etc.
      const isInvalid = (d: Record<string, unknown>) => {
        const s = String(d?.status ?? d?.Status ?? "").toUpperCase().trim();
        return s === "INVALID_CREDENTIALS" || s === "INVALID_KEY" ||
               s === "INVALID_APIKEY"      || s === "INVALID_USER" ||
               s === "INVALID_USERID"      || s === "UNAUTHORIZED" ||
               (s.startsWith("INVALID") && s.includes("CREDENTIAL"));
      };
      // A response is positively OK if it has real data (not just absence of error)
      const hasData = (d: Record<string, unknown>) =>
        !!(d?.MOBILE_NETWORK ?? d?.TV_ID ?? d?.Networks ?? d?.Packages ?? d?.packages ??
           d?.Plans ?? d?.plans ?? d?.DataBundlePlans ?? d?.CardDetails ?? d?.card_details);
      const ping = async (label: string, path: string, params: Record<string, string>) => {
        if (!params["APIKey"]) return { label, ok: false, detail: "Not configured — add key to Supabase secrets", raw: "" };
        try {
          const d = await ck(path, params);
          const raw = JSON.stringify(d).slice(0, 150);
          if (isInvalid(d)) return { label, ok: false, detail: String(d?.status ?? "INVALID_CREDENTIALS"), raw };
          return { label, ok: true, detail: hasData(d) ? "confirmed" : "reachable", raw };
        } catch (e) {
          return { label, ok: false, detail: (e as Error).message, raw: "" };
        }
      };
      const results = await Promise.all([
        ping("Airtime",       "APIDatabundleNetworkV2.asp",  { APIKey: AIRTIME_K }),
        ping("Data",          "APIDatabundlePlansV2.asp",    { APIKey: DATA_K, MobileNetwork: "01" }),
        ping("Cable TV",      "APICableTVPackagesV2.asp",    { APIKey: CABLETV_K, CableTV: "dstv" }),
        ping("Electricity",   "APIElectricityTypeV2.asp",    { APIKey: ELECTRICITY_K }),
        ping("Betting",       "APIBettingTypeV2.asp",        { APIKey: BETTING_K }),
        ping("WAEC",          "APIWAECPackagesV2.asp",       { APIKey: WAEC_K }),
        ping("JAMB",          "APIJAMBPackagesV2.asp",       { APIKey: JAMB_K }),
        ping("Spectranet",    "APISpectranetPackagesV2.asp", { APIKey: SPECTRANET_K }),
        ping("Smile",         "APISmilePackagesV2.asp",      { APIKey: SMILE_K }),
        ping("Print Airtime", "APIEPINDiscountV2.asp",       { APIKey: PRINT_AIRTIME_K }),
        ping("Print Data",    "APIDatabundlePlansV2.asp",    { APIKey: PRINT_DATA_K, MobileNetwork: "01" }),
      ]);
      return json({ results });
    }

    // ── Price lists exactly as ClubKonnect returns them (operator export, read-only) ─────────────────
    // Data and Print Data each use their OWN api key, so each product's list is fetched with its own key; Print Airtime
    // and normal airtime only expose a per-network discount. Nothing is calculated or normalised here.
    if (action === "price-list") {
      const NETS: Record<string, string> = { MTN: "01", Glo: "02", "9mobile": "03", Airtel: "04" };
      const plansFor = async (key: string) => {
        if (!key) return { error: "api key not configured" };
        const out: Record<string, unknown> = {};
        await Promise.all(Object.entries(NETS).map(async ([name, id]) => {
          try { out[name] = await ck("APIDatabundlePlansV2.asp", { APIKey: key, MobileNetwork: id }); }
          catch (e) { out[name] = { error: (e as Error).message }; }
        }));
        return out;
      };
      const once = async (path: string, key: string) => {
        if (!key) return { error: "api key not configured" };
        try { return await ck(path, { APIKey: key }); } catch (e) { return { error: (e as Error).message }; }
      };
      const [data, print_data, print_airtime, airtime] = await Promise.all([
        plansFor(DATA_K), plansFor(PRINT_DATA_K),
        once("APIEPINDiscountV2.asp", PRINT_AIRTIME_K), once("APIAirtimeDiscountV1.asp", AIRTIME_K),
      ]);
      return json({ fetched_at: new Date().toISOString(), data, print_data, print_airtime, airtime });
    }

    // ── Wallet balance + commission (admin dashboard) ──────────────────────────
    if (action === "wallet-balance") {
      const useKey = AIRTIME_K || DATA_K || ELECTRICITY_K || CABLETV_K;
      if (!USER_ID || !useKey)
        return json({ error: "CK credentials not configured", balance: null, commission: null });
      const data = await ck("APIWalletBalanceV1.asp", { APIKey: useKey });
      console.log("wallet-balance raw:", JSON.stringify(data));

      // CK sometimes returns "₦26.00", "3,169.36" or "-343.85" — parseCkAmount handles all and keeps the sign
      const parseAmt = parseCkAmount;

      const BALANCE_FIELDS    = ["WalletBalance","walletbalance","wallet_balance","Balance","balance","AccountBalance","Wallet_Balance","WALLETBALANCE","available_balance","AvailableBalance"];
      const COMMISSION_FIELDS = ["TotalCommission","Commission","commission","total_commission","CommissionBalance","CommissionEarned","commission_balance","commission_earned"];

      let balance: number | null = null;
      for (const f of BALANCE_FIELDS) {
        const v = parseAmt(data[f]);
        if (v !== null) { balance = v; break; }
      }

      let commission: number | null = null;
      for (const f of COMMISSION_FIELDS) {
        const v = parseAmt(data[f]);
        if (v !== null) { commission = v; break; }
      }

      return json({ balance, commission, raw: data });
    }

    return json({ error: `Unknown action: ${action}` });
  } catch (e) {
    console.error("bill service error:", e);
    return json({ error: (e as Error).message });
  }
});
