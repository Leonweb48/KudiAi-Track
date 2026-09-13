// Flutterwave v4 wallet API — deployed --no-verify-jwt; auth is enforced in-function
// (user actions: sb.auth.getUser(token); `disburse`: token must equal the service key).
//
// Powers the digital-wallet test build:
//   provision-account  → create FLW customer + static virtual account, store on wallets
//   list-banks         → NG bank list (for the withdraw form)
//   resolve-account    → name enquiry on a bank account
//   transfer           → PIN-verified, holds funds + pays out immediately
//   disburse           → run the payout (service-role only; called by the admin API)
//   simulate-topup     → TEST MODE only: force a mock charge.completed into the wallet
//
// All amounts crossing into the DB are kobo. Everything hits FLW_BASE_URL (sandbox).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const FLW_TOKEN_URL = "https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token";
const FLW_BASE      = Deno.env.get("FLW_BASE_URL") || "https://developersandbox-api.flutterwave.com";
const FLW_CLIENT_ID = Deno.env.get("FLW_CLIENT_ID") ?? "";
const FLW_CLIENT_SECRET = Deno.env.get("FLW_CLIENT_SECRET") ?? "";
const FLW_TEST_BVN  = Deno.env.get("FLW_TEST_BVN") || "22222222222";
// Optional static-IP relay for payouts (Flutterwave IP-whitelists transfers).
const FLW_RELAY_URL = (Deno.env.get("FLW_RELAY_URL") || "").replace(/\/$/, "");
const FLW_RELAY_KEY = Deno.env.get("FLW_RELAY_KEY") ?? "";
// v3 — used ONLY for BVN Verification (v4 has no such product at all). Static
// secret-key auth, completely separate host/auth from the v4 OAuth flow above.
const FLW_V3_BASE       = "https://api.flutterwave.com";
const FLW_V3_SECRET_KEY = Deno.env.get("FLW_V3_SECRET_KEY") ?? "";
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY      = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
// Shared secret between the admin portal and the Supabase functions (also used
// for email triggers). The admin portal's SERVICE_ROLE_KEY env can differ from
// the one injected here, so server-to-server calls authenticate with this.
const INTERNAL_SECRET = Deno.env.get("EMAIL_TRIGGER_SECRET") ?? "";

// ── OAuth token cache (survives across invocations in the same isolate) ──────
let _tok = { value: "", exp: 0 };
async function flwToken(): Promise<string> {
  if (_tok.value && Date.now() < _tok.exp - 60_000) return _tok.value;
  const res = await fetch(FLW_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: FLW_CLIENT_ID,
      client_secret: FLW_CLIENT_SECRET,
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    throw new Error(`FLW auth failed (${res.status}): ${j.error_description || j.error || "unknown"}`);
  }
  _tok = { value: j.access_token, exp: Date.now() + (Number(j.expires_in || 600) * 1000) };
  return _tok.value;
}

async function flwFetch(path: string, init: RequestInit & { scenario?: string; relay?: boolean } = {}) {
  const token = await flwToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> || {}),
  };
  if (init.scenario) headers["X-Scenario-Key"] = init.scenario;

  // Payouts must leave from a whitelisted IP — send them via the static-IP relay
  // when one is configured. Everything else goes direct.
  const useRelay = init.relay && FLW_RELAY_URL && FLW_RELAY_KEY;
  const target = useRelay ? `${FLW_RELAY_URL}${path}` : `${FLW_BASE}${path}`;
  if (useRelay) headers["x-relay-key"] = FLW_RELAY_KEY;

  const res = await fetch(target, { ...init, headers });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  console.log(`FLW ${init.method || "GET"} ${path} ${useRelay ? "(relay) " : ""}→ ${res.status} ${text.slice(0, 300)}`);
  return { ok: res.ok, status: res.status, data };
}

// v3 fetch — no OAuth, no relay, just a static secret-key Bearer token against
// api.flutterwave.com. Used exclusively by verify-bvn-init/verify-bvn-status.
async function flwV3Fetch(path: string, init: RequestInit = {}) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${FLW_V3_SECRET_KEY}`,
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> || {}),
  };
  const res = await fetch(`${FLW_V3_BASE}${path}`, { ...init, headers });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  console.log(`FLW v3 ${init.method || "GET"} ${path} → ${res.status} ${text.slice(0, 200)}`);
  return { ok: res.ok, status: res.status, data };
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Resolve a target user's identity — profiles (business owner) first,
// aso_clients (an Ajo/savings client) as fallback — and report which table
// owns the record, so callers can read/write BVN-verification columns on the
// right one. Shared by provision-account and the two verify-bvn-* actions.
// deno-lint-ignore no-explicit-any
async function resolveIdentity(sb: any, targetUid: string): Promise<{
  table: "profiles" | "aso_clients" | "staff"; email: string; fullName: string; phoneRaw: string;
}> {
  const { data: profile } = await sb.from("profiles")
    .select("email, full_name, business_name, phone").eq("id", targetUid).maybeSingle();
  let email    = profile?.email || "";
  let fullName = (profile?.full_name || profile?.business_name || "").trim();
  let phoneRaw = String(profile?.phone ?? "").replace(/\D/g, "");
  let table: "profiles" | "aso_clients" | "staff" = "profiles";
  if (!fullName) {
    const { data: cl } = await sb.from("aso_clients")
      .select("email, full_name, phone").eq("client_user_id", targetUid).maybeSingle();
    if (cl) {
      table    = "aso_clients";
      email    = email || cl.email || "";
      fullName = (cl.full_name || "").trim();
      phoneRaw = phoneRaw || String(cl.phone ?? "").replace(/\D/g, "");
    } else {
      // Staff/managers never get a profiles row (no signup trigger creates one
      // for the admin-API-created auth users manage-staff-account provisions),
      // so reaching here unambiguously means "staff", not "no identity found".
      const { data: st } = await sb.from("staff")
        .select("email, full_name, phone").eq("user_id", targetUid).maybeSingle();
      if (st) {
        table    = "staff";
        email    = email || st.email || "";
        fullName = (st.full_name || "").trim();
        phoneRaw = phoneRaw || String(st.phone ?? "").replace(/\D/g, "");
      }
    }
  }
  return { table, email, fullName, phoneRaw };
}

// The column that identifies a person within their resolveIdentity() table —
// profiles/aso_clients/staff each key their own-user link differently.
function filterColFor(table: "profiles" | "aso_clients" | "staff"): string {
  return table === "profiles" ? "id" : table === "aso_clients" ? "client_user_id" : "user_id";
}

// ── bank list cache ─────────────────────────────────────────────────────────
let _banks: { list: unknown[]; exp: number } = { list: [], exp: 0 };

// NIBSS name enquiry — retried, since it times out often.
async function flwResolve(bank_code: string, account_number: string) {
  let lastType = "", lastMsg = "";
  for (let i = 0; i < 3; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 700));
    const r = await flwFetch("/banks/account-resolve", {
      method: "POST",
      body: JSON.stringify({ currency: "NGN", account: { code: bank_code, number: account_number } }),
    });
    if (r.ok) return { ok: true, name: (r.data as any)?.data?.account_name || "", type: "", msg: "" };
    const err = (r.data as any)?.error || {};
    lastType = String(err.type || ""); lastMsg = String(err.message || "");
    if (/INVALID_ACCOUNT|UNKNOWN_BANK_CODE|not recognized|is invalid/i.test(lastType + " " + lastMsg)) break;
  }
  return { ok: false, name: "", type: lastType, msg: lastMsg };
}

// Run a Flutterwave bank payout.
async function flwDisburse(o: {
  reference: string; amount_kobo: number; bank_code: string; account_number: string;
  account_name?: string; narration?: string;
}) {
  const naira = Math.round(Number(o.amount_kobo) / 100);
  // NGN payouts: Flutterwave runs its own name enquiry — only bank code + account
  // number are needed. A supplied name (esp. one with "/" from NIBSS) trips
  // REQUEST_NOT_VALID, so we don't send it.
  // Narration shows on the recipient's bank alert — brand it KudiAI + a short ref.
  const shortRef = "KDT" + String(o.reference).replace(/-/g, "").slice(0, 8).toUpperCase();
  const userNarr = String(o.narration || "").replace(/[^\w .,-]/g, " ").trim();
  const payload = {
    action: "instant", type: "bank", reference: o.reference,
    narration: `KudiAI Track ${shortRef}${userNarr ? ` ${userNarr}` : ""}`.slice(0, 100).trim(),
    payment_instruction: {
      amount: { value: naira, applies_to: "destination_currency" },
      source_currency: "NGN", destination_currency: "NGN",
      recipient: { bank: { code: o.bank_code, account_number: o.account_number } },
    },
  };
  console.log("FLW disburse payload:", JSON.stringify(payload));
  const r = await flwFetch("/direct-transfers", {
    method: "POST",
    relay: true,
    headers: { "X-Idempotency-Key": o.reference, "X-Trace-Id": `${o.reference}-tr` },
    body: JSON.stringify(payload),
  });
  const d = r.data as any;
  const t = d?.data ?? d;                 // FLW wraps the transfer in `data`
  const vErrs = (d?.error?.validation_errors || []).map((e: any) => `${e.field_name || e.field || "?"}: ${e.message}`).join("; ");
  console.log("FLW disburse resp:", r.status, JSON.stringify(d).slice(0, 400));
  return {
    ok: r.ok,
    error: (d?.error?.message || "Transfer failed") + (vErrs ? ` (${vErrs})` : ""),
    detail: d,
    transfer_id: t?.id || "",
    status: t?.status || "NEW",
    fee_kobo: Math.round(Number(t?.fee?.value ?? t?.fee_charged ?? 0) * 100),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!FLW_CLIENT_ID || !FLW_CLIENT_SECRET) return json({ error: "Flutterwave not configured" }, 503);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const action = String(body.action || "");
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // config helper
  const cfg = async (key: string, dflt: string) => {
    const { data } = await sb.from("platform_config").select("value").eq("key", key).maybeSingle();
    return (data?.value ?? dflt) as string;
  };

  try {
    // ═══ disburse — server-to-server only (called by the admin approval API) ═
    if (action === "disburse") {
      const internal = req.headers.get("x-internal-secret") ?? "";
      // A bearer token that decodes to a service_role JWT for this project also passes.
      let jwtServiceRole = false;
      try {
        const p = JSON.parse(atob((token.split(".")[1] || "").replace(/-/g, "+").replace(/_/g, "/")));
        jwtServiceRole = p?.role === "service_role" && (!p?.ref || SUPABASE_URL.includes(p.ref));
      } catch { /* not a JWT */ }
      const authed = (SERVICE_KEY && token === SERVICE_KEY)
        || (INTERNAL_SECRET && (internal === INTERNAL_SECRET || token === INTERNAL_SECRET))
        || jwtServiceRole;
      if (!authed) return json({ error: "Unauthorized" }, 401);
      const { reference, amount_kobo, bank_code, account_number, account_name, narration } = body as {
        reference: string; amount_kobo: number; bank_code: string;
        account_number: string; account_name?: string; narration?: string;
      };
      const r = await flwDisburse({ reference, amount_kobo, bank_code, account_number, account_name, narration });
      if (!r.ok) return json({ error: r.error, detail: r.detail }, 502);
      return json({ ok: true, transfer_id: r.transfer_id, status: r.status, fee_kobo: r.fee_kobo });
    }

    // ═══ verify-bvn-init — start Flutterwave v3 BVN consent verification ════
    // v4 (everything else in this file) has no BVN verification product at
    // all — /virtual-accounts only ever recorded a BVN, never confirmed it
    // was genuine. This is a NIBSS-mandated consent/OTP flow: the BVN holder
    // must actively approve on Flutterwave's hosted page before we learn
    // whether the BVN is real and matches a name.
    if (action === "verify-bvn-init") {
      const internal = req.headers.get("x-internal-secret") ?? "";
      let jwtServiceRole = false;
      try {
        const p = JSON.parse(atob((token.split(".")[1] || "").replace(/-/g, "+").replace(/_/g, "/")));
        jwtServiceRole = p?.role === "service_role" && (!p?.ref || SUPABASE_URL.includes(p.ref));
      } catch { /* not a JWT */ }
      const serviceAuthed = (SERVICE_KEY && token === SERVICE_KEY)
        || (INTERNAL_SECRET && (internal === INTERNAL_SECRET || token === INTERNAL_SECRET))
        || jwtServiceRole;
      const targetFromBody = String((body as Record<string, unknown>).target_user_id || "");

      let targetUid: string;
      if (serviceAuthed && targetFromBody) {
        targetUid = targetFromBody;
      } else {
        if (!token) return json({ error: "Unauthorized" }, 401);
        const { data: { user: selfUser } } = await sb.auth.getUser(token);
        if (!selfUser) return json({ error: "Unauthorized" }, 401);
        targetUid = selfUser.id;
      }

      if (!FLW_V3_SECRET_KEY) return json({ error: "BVN verification is not configured" }, 503);

      const bvn = String((body as Record<string, unknown>).bvn ?? "").replace(/\D/g, "");
      if (!/^\d{11}$/.test(bvn)) return json({ error: "Enter a valid 11-digit BVN" }, 400);

      const { table, fullName } = await resolveIdentity(sb, targetUid);
      const nameForVerify = fullName || "KudiAI User";
      const [fn, ...ln] = nameForVerify.split(/\s+/);

      // Native apps redirect straight to a custom URL scheme (same mechanism
      // Google Sign-In already uses in this app); web needs a real hosted page.
      const redirectUrl = String((body as Record<string, unknown>).redirect_url || "").trim()
        || "com.amayatechnologies.kuditrack://bvn-callback";

      const r = await flwV3Fetch("/v3/bvn/verifications", {
        method: "POST",
        body: JSON.stringify({ bvn, firstname: fn || "KudiAI", lastname: ln.join(" ") || "User", redirect_url: redirectUrl }),
      });
      if (!r.ok) {
        return json({ error: (r.data as any)?.message || "Could not start BVN verification", detail: r.data }, 502);
      }
      const d = (r.data as any)?.data || {};
      const reference = String(d.reference || "");
      const hash = await sha256Hex(bvn);

      await sb.from(table).update({
        bvn_verification_reference: reference,
        bvn_hash: hash,
        bvn_verified: false, // reset — a stale "verified" flag from a prior BVN must not survive
      }).eq(filterColFor(table), targetUid);

      if (!d.url) {
        // Flutterwave returns a null url when the person already has prior
        // consent on file for this BVN — go straight to the status check.
        return json({ ok: true, alreadyConsented: true, reference });
      }
      return json({ ok: true, url: d.url, reference });
    }

    // ═══ verify-bvn-status — check/finalise a pending BVN consent ═══════════
    if (action === "verify-bvn-status") {
      const internal = req.headers.get("x-internal-secret") ?? "";
      let jwtServiceRole = false;
      try {
        const p = JSON.parse(atob((token.split(".")[1] || "").replace(/-/g, "+").replace(/_/g, "/")));
        jwtServiceRole = p?.role === "service_role" && (!p?.ref || SUPABASE_URL.includes(p.ref));
      } catch { /* not a JWT */ }
      const serviceAuthed = (SERVICE_KEY && token === SERVICE_KEY)
        || (INTERNAL_SECRET && (internal === INTERNAL_SECRET || token === INTERNAL_SECRET))
        || jwtServiceRole;
      const targetFromBody = String((body as Record<string, unknown>).target_user_id || "");

      let targetUid: string;
      if (serviceAuthed && targetFromBody) {
        targetUid = targetFromBody;
      } else {
        if (!token) return json({ error: "Unauthorized" }, 401);
        const { data: { user: selfUser } } = await sb.auth.getUser(token);
        if (!selfUser) return json({ error: "Unauthorized" }, 401);
        targetUid = selfUser.id;
      }

      if (!FLW_V3_SECRET_KEY) return json({ error: "BVN verification is not configured" }, 503);

      const { table, fullName } = await resolveIdentity(sb, targetUid);
      const filterCol = filterColFor(table);
      const { data: row } = await sb.from(table)
        .select("bvn_verification_reference").eq(filterCol, targetUid).maybeSingle();
      const reference = row?.bvn_verification_reference as string | undefined;
      if (!reference) return json({ error: "No BVN verification in progress" }, 400);

      const r = await flwV3Fetch(`/v3/bvn/verifications/${reference}`, { method: "GET" });
      if (!r.ok) return json({ ok: true, verified: false, pending: true });
      const d = (r.data as any)?.data || {};
      if (d.status !== "COMPLETED") {
        return json({ ok: true, verified: false, pending: true });
      }

      // Extract only what's needed for the name match — the rest of bvn_data
      // (DOB, phone, address, a base64 face image, watchlist status, etc.) is
      // read here and never written anywhere. Our Privacy Policy commits to
      // not storing BVN-derived data beyond what's needed to run the wallet.
      const bd = (d.bvn_data || {}) as Record<string, unknown>;
      const verifiedFirst = String(bd.firstName || "").trim().toLowerCase();
      const verifiedLast  = String(bd.surname || "").trim().toLowerCase();
      const nameTokens = fullName.toLowerCase().split(/\s+/).filter(Boolean);
      const matches = !!verifiedFirst && !!verifiedLast
        && nameTokens.includes(verifiedFirst) && nameTokens.includes(verifiedLast);

      if (!matches) {
        await sb.from(table).update({ bvn_verified: false }).eq(filterCol, targetUid);
        return json({
          ok: true, verified: false, mismatch: true,
          error: "The name on this BVN doesn't match your profile. Please check and try again.",
        });
      }

      const verifiedName = `${bd.firstName || ""} ${bd.surname || ""}`.trim();
      await sb.from(table).update({
        bvn_verified: true,
        bvn_verified_at: new Date().toISOString(),
        ...(table === "profiles" ? { verified_name: verifiedName } : { bvn_verified_name: verifiedName }),
      }).eq(filterCol, targetUid);

      return json({ ok: true, verified: true });
    }

    // ═══ provision-account — self-service OR server-to-server on-behalf-of ═══
    // An Ajo/savings client, opted into a wallet by the owner while being
    // added, has no session of their own yet — same auth as `disburse` lets
    // manage-ajo-client-account provision on their behalf (target_user_id).
    if (action === "provision-account") {
      const internal = req.headers.get("x-internal-secret") ?? "";
      let jwtServiceRole = false;
      try {
        const p = JSON.parse(atob((token.split(".")[1] || "").replace(/-/g, "+").replace(/_/g, "/")));
        jwtServiceRole = p?.role === "service_role" && (!p?.ref || SUPABASE_URL.includes(p.ref));
      } catch { /* not a JWT */ }
      const serviceAuthed = (SERVICE_KEY && token === SERVICE_KEY)
        || (INTERNAL_SECRET && (internal === INTERNAL_SECRET || token === INTERNAL_SECRET))
        || jwtServiceRole;
      const targetFromBody = String((body as Record<string, unknown>).target_user_id || "");

      let targetUid: string;
      if (serviceAuthed && targetFromBody) {
        targetUid = targetFromBody;
      } else {
        if (!token) return json({ error: "Unauthorized" }, 401);
        const { data: { user: selfUser } } = await sb.auth.getUser(token);
        if (!selfUser) return json({ error: "Unauthorized" }, 401);
        targetUid = selfUser.id;
      }

      if ((await cfg("wallet_enabled", "false")) !== "true") {
        return json({ error: "Wallet is not enabled" }, 403);
      }

      const { error: initErr } = await sb.rpc("wallet_get_or_create_for", { p_user_id: targetUid });
      if (initErr) { console.error("[flutterwave] wallet_get_or_create_for:", initErr.message); return json({ error: "Wallet init failed" }, 500); }
      const { data: w } = await sb.from("wallets").select("*").eq("user_id", targetUid).maybeSingle();
      if (!w) return json({ error: "Wallet init failed" }, 500);
      if (w.flw_virtual_account_id && w.flw_account_number) {
        return json({
          ok: true, account_number: w.flw_account_number,
          account_bank: w.flw_account_bank, account_name: w.flw_account_name,
        });
      }

      // ── BVN / NIN. In test mode a placeholder is fine; live requires a
      //    completed BVN verification (see verify-bvn-init/verify-bvn-status)
      //    for this EXACT BVN, done recently — v4 alone would happily create
      //    an account with an unverified or fake BVN otherwise.
      const testMode = (await cfg("wallet_test_mode", "true")) === "true";
      const bvn = String((body as Record<string, unknown>).bvn ?? "").replace(/\D/g, "");
      const nin = String((body as Record<string, unknown>).nin ?? "").replace(/\D/g, "");
      const effBvn = bvn || (testMode ? FLW_TEST_BVN : "");
      if (!/^\d{11}$/.test(effBvn)) {
        return json({ error: "A valid 11-digit BVN is required to activate your wallet", code: "bvn_required" }, 400);
      }

      // profiles (business owner) first, aso_clients (an Ajo/savings client) as fallback
      const { table: idTable, fullName: idFullName, phoneRaw: idPhone, email: idEmail } = await resolveIdentity(sb, targetUid);
      const email    = idEmail || `wallet+${targetUid.slice(0, 8)}@kudiai.app`;
      const fullName = idFullName || "KudiAI Owner";
      const phoneRaw = idPhone;
      const [fn, ...ln] = fullName.split(/\s+/);

      // Real BVN verification (verify-bvn-init/verify-bvn-status, Flutterwave v3)
      // is gated on this flag rather than always-on, because Flutterwave has BVN
      // Verification disabled on this merchant account ("Merchant is not enabled
      // to use BVN service") — enforcing it unconditionally would hard-block
      // every wallet activation. Flip bvn_verification_enabled to 'true' in
      // platform_config once Flutterwave confirms the product is enabled; no
      // redeploy needed. The reverify banner (frontend) checks the same flag.
      if (!testMode && (await cfg("bvn_verification_enabled", "false")) === "true") {
        const filterCol = filterColFor(idTable);
        const { data: verRow } = await sb.from(idTable)
          .select("bvn_verified, bvn_hash, bvn_verified_at").eq(filterCol, targetUid).maybeSingle();
        const effHash = await sha256Hex(effBvn);
        const verifiedRecently = !!verRow?.bvn_verified_at
          && (Date.now() - new Date(verRow.bvn_verified_at as string).getTime()) < 24 * 3600 * 1000;
        if (!verRow?.bvn_verified || verRow.bvn_hash !== effHash || !verifiedRecently) {
          return json({ error: "Please verify your BVN first", code: "bvn_not_verified" }, 400);
        }
      }

      let customerId = w.flw_customer_id as string | null;
      if (!customerId) {
        const c = await flwFetch("/customers", {
          method: "POST",
          headers: { "X-Idempotency-Key": `cus-${targetUid}` },
          body: JSON.stringify({
            email, name: { first: fn || "KudiAI", last: ln.join(" ") || "Owner" },
            ...(phoneRaw.length >= 10 ? { phone: { country_code: "234", number: phoneRaw.replace(/^234/, "").replace(/^0/, "") } } : {}),
          }),
        });
        if (!c.ok) return json({ error: "Could not create wallet profile", detail: c.data }, 502);
        customerId = (c.data as any)?.data?.id || "";
      }

      const va = await flwFetch("/virtual-accounts", {
        method: "POST",
        headers: { "X-Idempotency-Key": `va-${targetUid}` },
        body: JSON.stringify({
          customer_id: customerId,
          reference: `kdt-${targetUid}`,             // ≤42 chars, stable per user
          currency: "NGN",
          account_type: "static",
          amount: 0,
          bvn: effBvn,
          ...(nin.length === 11 ? { nin } : {}),
          narration: `KudiAI Wallet - ${fullName}`.slice(0, 60),
        }),
      });
      if (!va.ok) {
        const msg = String((va.data as any)?.error?.message || "").toLowerCase();
        const vErrs = (va.data as any)?.error?.validation_errors || [];
        const bvnBad = /bvn|nin|identity|verif|date of birth|name mismatch/.test(msg)
          || vErrs.some((e: any) => /bvn|nin/i.test(e?.field_name || ""));
        const acctHold = /under review|irregular|contact support|not enabled|not permitted|compliance|restricted/.test(msg);
        if (acctHold) {
          try {
            await sb.from("admin_notifications").insert({
              type: "error", category: "finance", target_roles: ["finance_admin", "super_admin"],
              title: "Wallet activation blocked by Flutterwave",
              message: `Flutterwave rejected virtual-account creation: "${(va.data as any)?.error?.message}". The wallet product may not be enabled or the account is under review — contact Flutterwave support.`,
              metadata: { detail: va.data },
            });
          } catch { /* non-fatal */ }
        }
        return json({
          error: bvnBad
            ? "Your BVN could not be verified. Check the number and that the name and date of birth on it match your profile."
            : acctHold
              ? "Wallet activation is temporarily unavailable. Our team has been notified — please try again later."
              : "Could not create your wallet account. Please try again shortly.",
          code: bvnBad ? "bvn_invalid" : acctHold ? "account_hold" : "va_failed",
          detail: va.data,
        }, bvnBad ? 422 : acctHold ? 503 : 502);
      }
      const v = (va.data as any)?.data || {};

      await sb.rpc("wallet_persist_account", {
        p_user_id: targetUid,
        p_customer_id: customerId,
        p_va_id: v.id || "",
        p_account_no: v.account_number || "",
        p_account_bank: v.account_bank_name || "",
        p_account_name: v.narration || fullName,
      });

      return json({
        ok: true,
        account_number: v.account_number || "",
        account_bank: v.account_bank_name || "",
        account_name: v.narration || fullName,
      });
    }

    // ═══ everything else needs a signed-in user ═════════════════════════════
    if (!token) return json({ error: "Unauthorized" }, 401);
    const { data: { user } } = await sb.auth.getUser(token);
    if (!user) return json({ error: "Unauthorized" }, 401);
    const uid = user.id;

    // A client bound to the caller's JWT — the owner-callable RPCs use auth.uid().
    const asUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });

    // ── charge-bill — one-time dynamic virtual account for a non-wallet bill
    //    payment (the Paystack-card-popup replacement — flagged separately from
    //    the wallet itself, since a business without a wallet can still pay bills). ──
    if (action === "charge-bill") {
      if ((await cfg("flw_bills_enabled", "false")) !== "true") return json({ error: "Not available" }, 403);
      const { amount_kobo, reference, narration } = body as { amount_kobo: number; reference: string; narration?: string };
      if (!amount_kobo || amount_kobo <= 0) return json({ error: "Enter an amount" }, 400);
      if (!reference) return json({ error: "Missing reference" }, 400);

      // Reuse the user's wallet customer_id if they have one; otherwise create a
      // lightweight Flutterwave customer just for this charge.
      const { data: w } = await sb.from("wallets").select("flw_customer_id").eq("user_id", uid).maybeSingle();
      let customerId = w?.flw_customer_id as string | null;
      if (!customerId) {
        const { data: profile } = await sb.from("profiles").select("email, full_name, business_name, phone").eq("id", uid).maybeSingle();
        const email = profile?.email || user.email || `bill+${uid.slice(0, 8)}@kudiai.app`;
        const fullName = (profile?.full_name || profile?.business_name || "KudiAI User").trim();
        const [fn, ...ln] = fullName.split(/\s+/);
        const phoneRaw = String(profile?.phone ?? "").replace(/\D/g, "");
        const c = await flwFetch("/customers", {
          method: "POST",
          headers: { "X-Idempotency-Key": `cus-${uid}` },
          body: JSON.stringify({
            email, name: { first: fn || "KudiAI", last: ln.join(" ") || "User" },
            ...(phoneRaw.length >= 10 ? { phone: { country_code: "234", number: phoneRaw.replace(/^234/, "").replace(/^0/, "") } } : {}),
          }),
        });
        if (!c.ok) return json({ error: "Could not start payment. Please try again." }, 502);
        customerId = (c.data as any)?.data?.id || "";
      }

      const naira = Math.round(Number(amount_kobo) / 100);
      const va = await flwFetch("/virtual-accounts", {
        method: "POST",
        headers: { "X-Idempotency-Key": `bill-${reference}` },
        body: JSON.stringify({
          customer_id: customerId,
          reference: `kdtb-${reference}`.slice(0, 42),
          currency: "NGN",
          account_type: "dynamic",
          amount: naira,
          narration: (narration || "KudiAI Bill Payment").slice(0, 60),
        }),
      });
      if (!va.ok) {
        console.error("[flutterwave] charge-bill VA failed:", JSON.stringify(va.data));
        return json({ error: "Could not start payment. Please try again shortly." }, 502);
      }
      const v = (va.data as any)?.data || {};
      return json({
        ok: true,
        account_number: v.account_number || "",
        account_bank: v.account_bank_name || "",
        account_name: v.narration || "KudiAI Bill Payment",
        amount: naira,
        expires_at: v.expiry_date || null,
      });
    }

    if ((await cfg("wallet_enabled", "false")) !== "true") {
      return json({ error: "Wallet is not enabled" }, 403);
    }

    // ── TEMPORARY diagnostic — is Card Issuing enabled on this Flutterwave
    // account? A plain GET/list call: cannot create a card, cannot charge
    // anything. Remove once answered (see conversation this was added in).
    if (action === "check-virtual-cards") {
      const r = await flwV3Fetch("/virtual-cards?page=1", { method: "GET" });
      return json({ ok: r.ok, status: r.status, data: r.data });
    }

    // ── list-banks ────────────────────────────────────────────────────────
    if (action === "list-banks") {
      if (_banks.list.length && Date.now() < _banks.exp) return json({ ok: true, banks: _banks.list });
      const r = await flwFetch("/banks?country=NG");
      if (!r.ok) return json({ error: "Could not load banks" }, 502);
      const list = ((r.data as any)?.data || []) as unknown[];
      _banks = { list, exp: Date.now() + 24 * 3600 * 1000 };
      return json({ ok: true, banks: list });
    }

    // ── resolve-account (name enquiry) ────────────────────────────────────
    if (action === "resolve-account") {
      const { bank_code, account_number } = body as { bank_code: string; account_number: string };
      if (!bank_code || !account_number) return json({ error: "Bank and account number required" }, 400);
      const rr = await flwResolve(bank_code, account_number);
      if (rr.ok) return json({ ok: true, account_name: rr.name });
      const bad = /INVALID_ACCOUNT|is invalid/i.test(rr.msg);
      const badBank = /UNKNOWN_BANK_CODE|not recognized/i.test(rr.msg);
      return json({
        error: badBank ? "That bank isn't supported — pick it from the list again."
             : bad ? "That account number doesn't exist at this bank. Check and try again."
             : "Couldn't verify right now. Check the details, or continue and confirm the name yourself.",
        code: bad ? "invalid_account" : badBank ? "bad_bank" : "resolve_unavailable",
      }, 422);
    }

    // ── simulate-topup — TEST MODE only ──────────────────────────────────
    if (action === "simulate-topup") {
      if ((await cfg("wallet_test_mode", "true")) !== "true") return json({ error: "Not available" }, 403);
      const { data: w } = await sb.from("wallets").select("*").eq("user_id", uid).maybeSingle();
      if (!w?.flw_customer_id) return json({ error: "Activate your wallet first" }, 400);
      const naira = Math.min(Math.max(Math.round(Number(body.amount_naira || 2000)), 100), 50000);
      const r = await flwFetch("/virtual-accounts", {
        method: "POST",
        scenario: "issuer:approved",
        headers: { "X-Idempotency-Key": `sim-${uid}-${Date.now()}` },
        body: JSON.stringify({
          customer_id: w.flw_customer_id,
          reference: `sim-${uid.slice(0, 8)}-${Date.now().toString(36)}`,
          currency: "NGN", account_type: "dynamic", amount: naira, expiry: 600,
          narration: "KudiAI test top-up",
        }),
      });
      if (!r.ok) return json({ error: "Simulation failed", detail: r.data }, 502);
      return json({ ok: true, simulated: true, amount_naira: naira });
    }

    // ── transfer — PIN-confirmed, runs immediately (no admin approval) ───
    if (action === "transfer") {
      const { amount_kobo, bank_code, account_number, narration, book_expense, pin, confirmed_name } = body as {
        amount_kobo: number; bank_code: string; account_number: string;
        narration?: string; book_expense?: boolean; pin?: string; confirmed_name?: string;
      };
      if (!amount_kobo || amount_kobo <= 0) return json({ error: "Enter an amount" }, 400);
      if (!bank_code || !account_number) return json({ error: "Bank and account number required" }, 400);
      if (!pin || !/^\d{4,6}$/.test(String(pin))) return json({ error: "Enter your transaction PIN", code: "pin_required" }, 400);

      // 1. verify the transaction PIN server-side
      const pv = await fetch(`${SUPABASE_URL}/functions/v1/pin-manager`, {
        method: "POST",
        headers: { Authorization: authHeader, apikey: ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify_txn_pin", pin: String(pin) }),
      });
      const pj = await pv.json().catch(() => ({}));
      if (!pj?.success) {
        return json({
          error: pj?.locked ? "Too many PIN attempts — try again later."
               : pj?.error === "Transaction PIN not set" ? "Set a transaction PIN first (Settings → Security)."
               : "Incorrect PIN.",
          code: pj?.locked ? "pin_locked" : "pin_bad",
        }, 403);
      }

      // 2. resolve the recipient name. Hard-fail on a bad account/bank; if the
      //    name service is just down, fall back to the name the owner confirmed.
      const rr = await flwResolve(bank_code, account_number);
      if (!rr.ok && /INVALID_ACCOUNT|UNKNOWN_BANK_CODE|not recognized|is invalid/i.test(rr.type + " " + rr.msg)) {
        return json({ error: "That account or bank isn't valid. Please check and try again." }, 422);
      }
      const accountName = rr.ok ? rr.name : String(confirmed_name || "").trim();
      if (!accountName) return json({ error: "Could not verify that account. Try again in a moment." }, 422);

      // 3. hold the funds
      const { data: wdId, error: holdErr } = await asUser.rpc("wallet_hold_transfer", {
        p_amount_kobo: Math.round(amount_kobo),
        p_bank_code: bank_code,
        p_account_number: account_number,
        p_account_name: accountName,
        p_narration: String(narration || "").slice(0, 100),
        p_book_expense: !!book_expense,
      });
      if (holdErr) return json({ error: holdErr.message.replace(/^.*:\s*/, "") }, 400);

      // 4. send it
      const d = await flwDisburse({
        reference: String(wdId), amount_kobo: Math.round(amount_kobo),
        bank_code, account_number, account_name: accountName,
        narration: String(narration || ""),
      });
      if (!d.ok) {
        await sb.rpc("wallet_transfer_failed", { p_withdrawal_id: wdId, p_reason: `Transfer declined: ${d.error}` });
        return json({ error: `Transfer could not be completed (${d.error}). Your wallet was not charged.`, detail: d.detail }, 502);
      }
      await sb.rpc("wallet_transfer_sent", { p_withdrawal_id: wdId, p_flw_transfer_id: d.transfer_id, p_fee_kobo: d.fee_kobo });
      return json({ ok: true, account_name: accountName, status: d.status, fee_kobo: d.fee_kobo, withdrawal_id: wdId });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    console.error("[flutterwave]", e);
    return json({ error: (e as Error).message || "Wallet request failed" }, 500);
  }
});
