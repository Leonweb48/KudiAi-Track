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
import nodemailer from "npm:nodemailer@6";
import { bankEmail, esc, cleanSubject, nairaFromKobo, appLink, htmlToText } from "../_shared/bankEmail.ts";
import { loadAccounts, isConfigured, resolveActive, graceStatus, type FlwAccount, type AccountKey } from "../_shared/flwAccounts.ts";
import { customerName, customerPhone, customerEmail } from "../_shared/flwCustomer.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const FLW_TOKEN_URL = "https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token";
// Two Flutterwave accounts can be live at once (see _shared/flwAccounts.ts): the original "legacy" one and the
// business one the platform is moving to. ACTIVE is the account new numbers, payouts and name enquiries use;
// it is re-read from platform_config at the start of every request. Before the switch it is always legacy.
const ACCOUNTS = loadAccounts((k) => Deno.env.get(k));
let ACTIVE: FlwAccount = ACCOUNTS.legacy;
const FLW_TEST_BVN  = Deno.env.get("FLW_TEST_BVN") || "22222222222";
// Optional static-IP relay for payouts (Flutterwave IP-whitelists transfers).
const FLW_RELAY_URL = (Deno.env.get("FLW_RELAY_URL") || "").replace(/\/$/, "");
const FLW_RELAY_KEY = Deno.env.get("FLW_RELAY_KEY") ?? "";
// v3 — used ONLY for BVN Verification (v4 has no such product at all). Static
// secret-key auth, completely separate host/auth from the v4 OAuth flow above.
const FLW_V3_BASE       = "https://api.flutterwave.com";
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY      = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
// Shared secret between the admin portal and the Supabase functions (also used
// for email triggers). The admin portal's SERVICE_ROLE_KEY env can differ from
// the one injected here, so server-to-server calls authenticate with this.
const INTERNAL_SECRET = Deno.env.get("EMAIL_TRIGGER_SECRET") ?? "";

// The payout email uses the shared bank-grade layout (_shared/bankEmail.ts). The
// email is BUILT inside the try: a template problem must never get in the way of a
// payout that has already moved money.
// deno-lint-ignore no-explicit-any
async function sendWalletEmail(sb: any, to: string, subject: string, build: () => string): Promise<boolean> {
  if (!to) return false;
  try {
    const html = build();
    const { data: smtp } = await sb.from("smtp_config").select("*").limit(1).maybeSingle();
    if (!smtp) return false;
    const transport = nodemailer.createTransport({
      host: smtp.host, port: smtp.port, secure: smtp.encryption === "ssl",
      auth: { user: smtp.username, pass: smtp.password },
    });
    await transport.sendMail({ from: `"${smtp.from_name || "KudiAI Track"}" <${smtp.from_email}>`, to, subject: cleanSubject(subject), html, text: htmlToText(html) });
    return true;
  } catch (e) { console.warn("[flutterwave] email failed:", (e as Error).message); return false; }
}

const fmtNgn = (kobo: number) => `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;

// ── OAuth token cache, one per account (survives across invocations in the same isolate) ──
const _toks: Partial<Record<AccountKey, { value: string; exp: number }>> = {};
async function flwToken(acct: FlwAccount = ACTIVE): Promise<string> {
  const cached = _toks[acct.key];
  if (cached && cached.value && Date.now() < cached.exp - 60_000) return cached.value;
  const res = await fetch(FLW_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: acct.clientId,
      client_secret: acct.clientSecret,
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    throw new Error(`FLW auth failed (${acct.key}, ${res.status}): ${j.error_description || j.error || "unknown"}`);
  }
  _toks[acct.key] = { value: j.access_token, exp: Date.now() + (Number(j.expires_in || 600) * 1000) };
  return j.access_token as string;
}

// `account` picks the Flutterwave account for this call (default: the active one).
async function flwFetch(path: string, rawInit: RequestInit & { scenario?: string; relay?: boolean; account?: FlwAccount } = {}) {
  const { account, ...init } = rawInit;
  const acct = account ?? ACTIVE;
  const token = await flwToken(acct);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> || {}),
  };
  if (init.scenario) headers["X-Scenario-Key"] = init.scenario;

  // Payouts must leave from a whitelisted IP — send them via the static-IP relay
  // when one is configured. Everything else goes direct.
  const useRelay = init.relay && FLW_RELAY_URL && FLW_RELAY_KEY;
  const target = useRelay ? `${FLW_RELAY_URL}${path}` : `${acct.base}${path}`;
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
    Authorization: `Bearer ${ACTIVE.v3Key}`,
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

// Is this a server-to-server call (service role)? True only for the service key itself, the internal shared
// secret, or a service_role JWT that the DATABASE accepts.
//
// SECURITY: this function is deployed --no-verify-jwt, so nothing upstream checks a JWT's signature. It used to
// decode the token and believe its `role` claim — meaning anyone could forge an unsigned token claiming
// role=service_role and call `disburse` (a bank payout), `provision-account` for any user, etc. The claim is now
// only a hint for whether to ask; PostgREST verifies the signature and only a genuine service_role token may run
// the service-only probe function.
async function isServiceCall(req: Request, token: string): Promise<boolean> {
  const internal = req.headers.get("x-internal-secret") ?? "";
  if (SERVICE_KEY && token === SERVICE_KEY) return true;
  if (INTERNAL_SECRET && (internal === INTERNAL_SECRET || token === INTERNAL_SECRET)) return true;
  if (!token || token.split(".").length !== 3) return false;
  try {
    const p = JSON.parse(atob((token.split(".")[1] || "").replace(/-/g, "+").replace(/_/g, "/")));
    if (p?.role !== "service_role") return false;          // ordinary user tokens never reach the probe
  } catch { return false; }
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/flw_account_status`, {
      method: "POST",
      headers: { apikey: token, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
    });
    return r.ok;
  } catch { return false; }
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

  // Which Flutterwave account is active right now (legacy until the switch).
  ACTIVE = resolveActive(ACCOUNTS, await cfg("flw_active_account", "legacy"), (m) => console.warn("[flutterwave]", m));

  // ═══ check-accounts — service only. Proves each Flutterwave account's credentials work BEFORE the switch, so it
  //    is never made blind. Returns yes/no facts only — never a secret, token or hash. Runs ahead of the
  //    "configured" guard below because diagnosing that is its job. ═══
  if (action === "check-accounts") {
    if (!(await isServiceCall(req, token))) return json({ error: "Unauthorized" }, 401);
    const report: Record<string, Record<string, unknown>> = {};
    for (const key of ["legacy", "business"] as AccountKey[]) {
      const a = ACCOUNTS[key];
      const r: Record<string, unknown> = {
        configured: isConfigured(a),
        mode: /sandbox/i.test(a.base) ? "sandbox" : "live",
        webhook_hash_set: !!a.webhookHash,
        v3_key_set: !!a.v3Key,
      };
      if (isConfigured(a)) {
        try {
          await flwToken(a);
          r.auth = "ok";
          const b = await flwFetch("/banks?country=NG", { account: a });
          r.banks = b.ok ? "ok" : `failed (${b.status})`;
          // what is actually in this account — compare against wallet_liability_ngn below before switching payouts to it
          const bal = await flwFetch("/wallets/balances", { account: a });
          const ngn = (((bal.data as { data?: { currency: string; available_balance: number }[] })?.data) || []).find((x) => x.currency === "NGN");
          r.ngn_available = bal.ok ? Number(ngn?.available_balance ?? 0) : `failed (${bal.status})`;
        } catch (e) { r.auth = `failed: ${(e as Error).message}`; }
      }
      report[key] = r;
    }
    // The payout relay must egress from an IP whitelisted on EVERY account that sends transfers.
    let relayIp: string | null = null;
    if (FLW_RELAY_URL && FLW_RELAY_KEY) {
      try {
        const w = await fetch(`${FLW_RELAY_URL}/whoami`, { headers: { "x-relay-key": FLW_RELAY_KEY } });
        relayIp = w.ok ? String(((await w.json()) as { ip?: string }).ip || "") || null : null;
      } catch { /* reported as null */ }
    }
    const warnings: string[] = [];
    if (ACCOUNTS.legacy.webhookHash && ACCOUNTS.legacy.webhookHash === ACCOUNTS.business.webhookHash) {
      warnings.push("the two webhook secret hashes are identical — they must differ, or events cannot be attributed to an account");
    }
    if (ACCOUNTS.business.base !== ACCOUNTS.legacy.base) {
      warnings.push("the accounts use different API base URLs — the payout relay talks to ONE base (its FLW_BASE_URL)");
    }
    // What the wallets owe holders (all of it should be covered by the ACTIVE account's balance).
    const { data: st } = await sb.rpc("flw_account_status");
    return json({
      ok: true, active: ACTIVE.key, relay_egress_ip: relayIp, accounts: report,
      wallet_liability_ngn: (st as { total_balance_ngn?: number } | null)?.total_balance_ngn ?? null,
      wallets: st ?? null, warnings,
    });
  }

  if (!isConfigured(ACTIVE)) return json({ error: "Flutterwave not configured" }, 503);

  try {
    // ═══ disburse — server-to-server only (called by the admin approval API) ═
    if (action === "disburse") {
      const authed = await isServiceCall(req, token);
      if (!authed) return json({ error: "Unauthorized" }, 401);
      const { reference, amount_kobo, bank_code, account_number, account_name, narration } = body as {
        reference: string; amount_kobo: number; bank_code: string;
        account_number: string; account_name?: string; narration?: string;
      };
      const r = await flwDisburse({ reference, amount_kobo, bank_code, account_number, account_name, narration });
      if (!r.ok) return json({ error: r.error, detail: r.detail }, 502);
      return json({ ok: true, transfer_id: r.transfer_id, status: r.status, fee_kobo: r.fee_kobo });
    }

    // ═══ announce-migration — service only. Emails every holder of an old (legacy) account number that a new one is
    //    available, and until when the old one keeps working. Idempotent: wallets.migration_emailed_at is set per
    //    person after their email goes out, so running it twice never emails anyone twice. `dry_run: true` only
    //    counts. Only meaningful after the switch (flw_switch_to_business). ═══
    if (action === "announce-migration") {
      if (!(await isServiceCall(req, token))) return json({ error: "Unauthorized" }, 401);
      if (ACTIVE.key !== "business") return json({ error: "The business account is not active yet — switch first" }, 409);
      const dryRun = (body as Record<string, unknown>).dry_run === true;
      const g = graceStatus(ACTIVE.key, await cfg("flw_legacy_grace_until", ""));
      const until = g.until
        ? new Date(g.until).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" })
        : "";

      const { data: targets, error: tErr } = await sb.from("wallets")
        .select("user_id, flw_account_number")
        .eq("flw_account", "legacy").not("flw_account_number", "is", null).is("migration_emailed_at", null)
        .limit(200);
      if (tErr) return json({ error: "Could not list wallets" }, 500);
      if (dryRun) return json({ ok: true, dry_run: true, would_email: (targets ?? []).length });

      let sent = 0, noEmail = 0, failed = 0;
      for (const t of targets ?? []) {
        const who = await resolveIdentity(sb, t.user_id as string);
        if (!who.email) { noEmail++; continue; }        // left unmarked — picked up if an email is added later
        try {
          const delivered = await sendWalletEmail(sb, who.email, "Your KudiAI wallet has a new account number", () => bankEmail({
            title: "Your wallet has a new account number", tone: "warning", timestamp: new Date(),
            preheader: "Get your new number in the app — your current one keeps working for a short while",
            intro: `We've upgraded the bank that powers your KudiAI wallet, so your wallet now has a new account number. `
              + `Your money and history are safe and unchanged.`,
            rows: [
              ["Your current number", esc(t.flw_account_number), { mono: true }],
              ["Keeps working until", until ? esc(until) : "For a short while"],
              ["What to do", "Open Wallet in the app and tap “Get my new number”"],
              ["You will need", "Your BVN or NIN"],
            ],
            note: "After the date above, transfers to your current number will not reach your wallet automatically. "
              + "Enter your BVN or NIN <b>only inside the KudiAI Track app</b> — never send it to anyone by email, chat or phone, and never share your PIN or OTP.",
            button: { label: "Open Wallet →", url: appLink({ tab: "wallet" }) },
            security: false,
          }));
          if (!delivered) { failed++; continue; }        // SMTP refused / not configured — left unmarked, retried next run
          const { error: mErr } = await sb.rpc("flw_mark_migration_emailed", { p_user_id: t.user_id });
          if (mErr) { failed++; console.error("[flutterwave] flw_mark_migration_emailed:", mErr.message); } else sent++;
        } catch (e) { failed++; console.warn("[flutterwave] announce-migration email failed:", (e as Error).message); }
      }
      return json({ ok: true, sent, skipped_no_email: noEmail, failed, more_may_remain: (targets ?? []).length >= 200 });
    }

    // ═══ process-scheduled-transfer — cron-triggered only, never user-callable
    //    (wallet_run_scheduled_transfers, pg_net → here, with a shared secret
    //    distinct from the general internal secret above — scoped to exactly
    //    this one purpose). Mirrors the interactive "transfer" action's hold →
    //    disburse sequence, but resolves whose wallet from the scheduled row
    //    (service-role, no user session exists at 3am) instead of auth.uid(),
    //    and re-checks balance + both caps fresh via wallet_hold_scheduled_
    //    transfer exactly as a manual transfer would — the PIN taken at
    //    schedule-creation authorizes the STANDING INSTRUCTION, not a blanket
    //    bypass of these checks on every run. ══════════════════════════════
    if (action === "process-scheduled-transfer") {
      const cronSecret = req.headers.get("x-cron-secret") ?? "";
      const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
      if (!CRON_SECRET || cronSecret !== CRON_SECRET) return json({ error: "Unauthorized" }, 401);

      const { scheduled_transfer_id } = body as { scheduled_transfer_id: string };
      if (!scheduled_transfer_id) return json({ error: "Missing scheduled_transfer_id" }, 400);

      const { data: row } = await sb.from("wallet_scheduled_transfers").select("*").eq("id", scheduled_transfer_id).maybeSingle();
      if (!row) return json({ error: "Scheduled transfer not found" }, 404);

      const { data: wdId, error: holdErr } = await sb.rpc("wallet_hold_scheduled_transfer", {
        p_owner_id: row.owner_id,
        p_scheduled_id: row.id,
        p_amount_kobo: row.amount_kobo,
        p_bank_code: row.bank_code,
        p_account_number: row.account_number,
        p_account_name: row.account_name,
        p_narration: row.narration,
        p_book_expense: row.book_expense,
      });

      if (holdErr) {
        const reason = holdErr.message.replace(/^.*:\s*/, "");
        await sb.rpc("wallet_record_scheduled_run", { p_id: row.id, p_success: false, p_error: reason });
        return json({ ok: true, held: false, reason });
      }

      const d = await flwDisburse({
        reference: String(wdId), amount_kobo: row.amount_kobo,
        bank_code: row.bank_code, account_number: row.account_number, account_name: row.account_name,
        narration: String(row.narration || ""),
      });

      if (!d.ok) {
        await sb.rpc("wallet_transfer_failed", { p_withdrawal_id: wdId, p_reason: `Transfer declined: ${d.error}` });
        await sb.rpc("wallet_record_scheduled_run", { p_id: row.id, p_success: false, p_error: d.error });
        return json({ ok: true, held: true, disbursed: false, reason: d.error });
      }

      // Settlement (completed/failed) + the debit notification both happen via
      // the same flutterwave-webhook transfer.disburse handler that already
      // processes every withdrawal, scheduled or manual — this row was created
      // with the exact same shape, so nothing new is needed there.
      await sb.rpc("wallet_transfer_sent", { p_withdrawal_id: wdId, p_flw_transfer_id: d.transfer_id, p_fee_kobo: d.fee_kobo });
      await sb.rpc("wallet_record_scheduled_run", { p_id: row.id, p_success: true });
      return json({ ok: true, held: true, disbursed: true, withdrawal_id: wdId });
    }

    // ═══ send-ajo-payout-email — cron-triggered only, never user-callable ════
    // ajo_settle_due_wallet_payouts() is pure SQL run from pg_cron (or the
    // wallets AFTER UPDATE auto-settle trigger) — it can't call fetch()
    // itself, so it reaches this action via pg_net.http_post + the same
    // Vault cron_secret used by process-scheduled-transfer above. Sends the
    // client the wallet-style receipt their payout never had (only an
    // in-app bell notification existed before this). Best-effort: money has
    // already moved by the time this fires; a missing/bad email is never
    // allowed to affect the payout's settled status.
    if (action === "send-ajo-payout-email") {
      const cronSecret = req.headers.get("x-cron-secret") ?? "";
      const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
      if (!CRON_SECRET || cronSecret !== CRON_SECRET) return json({ error: "Unauthorized" }, 401);

      const { client_user_id, amount_kobo, balance_after_kobo, payout_id } = body as {
        client_user_id: string; amount_kobo: number; balance_after_kobo?: number; payout_id?: string;
      };
      if (!client_user_id || !amount_kobo) return json({ error: "client_user_id and amount_kobo required" }, 400);

      const identity = await resolveIdentity(sb, client_user_id);
      if (!identity.email) return json({ ok: true, sent: false, reason: "no email on file" });

      // The payout's own row carries the stored reference and server timestamp.
      let payoutRow: { receipt_ref?: string | null; created_at?: string | null } | null = null;
      if (payout_id) {
        try {
          const { data } = await sb.from("ajo_contributions").select("receipt_ref, created_at").eq("id", payout_id).maybeSingle();
          payoutRow = data;
        } catch { /* the email still goes out without a reference */ }
      }

      await sendWalletEmail(sb, identity.email, `Payout Received — ${fmtNgn(amount_kobo)}`, () =>
        bankEmail({
          title: "Payout Received", tone: "success",
          timestamp: payoutRow?.created_at,
          amount: nairaFromKobo(amount_kobo), amountLabel: "Credited to Your Wallet",
          intro: "This payout was credited to your KudiAI wallet.",
          rows: [
            ["Transaction Reference", payoutRow?.receipt_ref ? esc(payoutRow.receipt_ref) : "", { mono: true }],
            ["Payment Method", "KudiAI Wallet"],
            ["Source", "Ajo/Esusu withdrawal"],
            ["Balance After", balance_after_kobo != null ? nairaFromKobo(balance_after_kobo) : ""],
          ],
          button: { label: "View Transaction →", url: appLink({ tab: "wallet" }) },
        }));

      return json({ ok: true, sent: true });
    }

    // ═══ verify-bvn-init — start Flutterwave v3 BVN consent verification ════
    // v4 (everything else in this file) has no BVN verification product at
    // all — /virtual-accounts only ever recorded a BVN, never confirmed it
    // was genuine. This is a NIBSS-mandated consent/OTP flow: the BVN holder
    // must actively approve on Flutterwave's hosted page before we learn
    // whether the BVN is real and matches a name.
    if (action === "verify-bvn-init") {
      const serviceAuthed = await isServiceCall(req, token);
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

      if (!ACTIVE.v3Key) return json({ error: "BVN verification is not configured" }, 503);

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
      const serviceAuthed = await isServiceCall(req, token);
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

      if (!ACTIVE.v3Key) return json({ error: "BVN verification is not configured" }, 503);

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
      const serviceAuthed = await isServiceCall(req, token);
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
      // Which Flutterwave account this wallet's number lives on, and which one a NEW number should be
      // created under (normally the active account; a service caller can pin one for a pilot).
      const walletAcct: AccountKey = w.flw_account === "business" ? "business" : "legacy";
      const hasVa = !!(w.flw_virtual_account_id && w.flw_account_number);
      let target: FlwAccount = ACTIVE;
      const pinned = String((body as Record<string, unknown>).use_account || "");
      if (serviceAuthed && (pinned === "business" || pinned === "legacy")) target = ACCOUNTS[pinned];
      if (!isConfigured(target)) return json({ error: `The ${target.key} Flutterwave account is not configured` }, 503);
      const wantsMigrate = (body as Record<string, unknown>).migrate === true;

      if (hasVa && walletAcct === target.key) {
        return json({
          ok: true, account_number: w.flw_account_number,
          account_bank: w.flw_account_bank, account_name: w.flw_account_name,
          account: walletAcct,
        });
      }
      if (hasVa && !wantsMigrate) {
        // The wallet still sits on the other account. Its old number keeps working during the grace period;
        // the caller must ask explicitly (migrate: true, with a BVN) to move to the new one.
        const g = graceStatus(ACTIVE.key, await cfg("flw_legacy_grace_until", ""));
        return json({
          ok: true, needs_migration: true, account: walletAcct,
          account_number: w.flw_account_number, account_bank: w.flw_account_bank, account_name: w.flw_account_name,
          grace_until: g.until ? new Date(g.until).toISOString() : null, retired: g.retired,
        });
      }

      // ── BVN or NIN. Flutterwave needs ONE of them for an NGN virtual account, so either opens the wallet
      //    (the other can be added later). In test mode a placeholder BVN is fine. Where a BVN is given and
      //    real BVN verification is on, it must be a verified one (see verify-bvn-init/verify-bvn-status)
      //    for this EXACT BVN, done recently — v4 alone would happily create an account with an unverified
      //    or fake BVN otherwise. A NIN is validated by Flutterwave itself when the account is created.
      const testMode = (await cfg("wallet_test_mode", "true")) === "true";
      const bvn = String((body as Record<string, unknown>).bvn ?? "").replace(/\D/g, "");
      const nin = String((body as Record<string, unknown>).nin ?? "").replace(/\D/g, "");
      // a malformed number is refused rather than silently dropped
      if (bvn && !/^\d{11}$/.test(bvn)) return json({ error: "Your BVN must be exactly 11 digits", code: "bvn_format" }, 400);
      if (nin && !/^\d{11}$/.test(nin)) return json({ error: "Your NIN must be exactly 11 digits", code: "nin_format" }, 400);
      const effBvn = bvn || (testMode ? FLW_TEST_BVN : "");
      if (!effBvn && !nin) {
        return json({ error: "Enter your BVN or your NIN (11 digits) to activate your wallet", code: "id_required" }, 400);
      }

      // profiles (business owner) first, aso_clients (an Ajo/savings client) as fallback
      const { table: idTable, fullName: idFullName, phoneRaw: idPhone, email: idEmail } = await resolveIdentity(sb, targetUid);
      const email    = customerEmail(idEmail, `wallet+${targetUid.slice(0, 8)}@kudiai.app`);
      const fullName = idFullName || "KudiAI Owner";

      // Real BVN verification (verify-bvn-init/verify-bvn-status, Flutterwave v3)
      // is gated on this flag rather than always-on, because Flutterwave has BVN
      // Verification disabled on this merchant account ("Merchant is not enabled
      // to use BVN service") — enforcing it unconditionally would hard-block
      // every wallet activation. Flip bvn_verification_enabled to 'true' in
      // platform_config once Flutterwave confirms the product is enabled; no
      // redeploy needed. The reverify banner (frontend) checks the same flag.
      if (effBvn && !testMode && (await cfg("bvn_verification_enabled", "false")) === "true") {
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

      // A stored customer id only means something on the account that created it.
      let customerId = (walletAcct === target.key ? (w.flw_customer_id as string | null) : null) ?? null;
      if (!customerId) {
        // Flutterwave's customer API only takes letters in names and a 7–10 digit phone (see _shared/flwCustomer.ts) —
        // a business name like "Amaya & Co." used to be rejected here, failing every such activation.
        const custBody = JSON.stringify({
          email, name: customerName(fullName, "Owner"),
          ...(customerPhone(idPhone) ? { phone: customerPhone(idPhone) } : {}),
        });
        const c = await flwFetch("/customers", {
          method: "POST",
          account: target,
          // fingerprint of the payload: a corrected profile is a fresh request, an identical retry stays idempotent
          headers: { "X-Idempotency-Key": `cus-${targetUid}-${(await sha256Hex(custBody)).slice(0, 10)}` },
          body: custBody,
        });
        if (!c.ok) {
          return json({
            error: c.status === 400
              ? "We couldn't set up your wallet profile. Please check the name and phone number on your profile, then try again."
              : "Could not create wallet profile",
            code: "profile_failed", detail: c.data,
          }, 502);
        }
        customerId = (c.data as any)?.data?.id || "";
      }

      // The idempotency key carries a short fingerprint of the ID used, so retrying with a corrected (or the other)
      // number is a fresh request instead of replaying the failed one; the same number retried stays idempotent.
      const idTag = (await sha256Hex(`${effBvn}|${nin}`)).slice(0, 10);
      const va = await flwFetch("/virtual-accounts", {
        method: "POST",
        account: target,
        headers: { "X-Idempotency-Key": `va-${targetUid}-${idTag}` },
        body: JSON.stringify({
          customer_id: customerId,
          reference: `kdt-${targetUid}`,             // ≤42 chars, stable per user
          currency: "NGN",
          account_type: "static",
          amount: 0,
          ...(effBvn ? { bvn: effBvn } : {}),
          ...(nin ? { nin } : {}),
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
            ? "Your BVN or NIN could not be verified. Check the number and that the name and date of birth on it match your profile."
            : acctHold
              ? "Wallet activation is temporarily unavailable. Our team has been notified — please try again later."
              : "Could not create your wallet account. Please try again shortly.",
          code: bvnBad ? "bvn_invalid" : acctHold ? "account_hold" : "va_failed",
          detail: va.data,
        }, bvnBad ? 422 : acctHold ? 503 : 502);
      }
      const v = (va.data as any)?.data || {};

      const persistArgs = {
        p_user_id: targetUid,
        p_customer_id: customerId,
        p_va_id: v.id || "",
        p_account_no: v.account_number || "",
        p_account_bank: v.account_bank_name || "",
        p_account_name: v.narration || fullName,
      };
      let migrated = false;
      if (hasVa) {
        // Moving an existing wallet to the new account: the old number is remembered (legacy_flw_*) so deposits
        // made to it during the grace period still credit this wallet.
        const { data: moved, error: mErr } = await sb.rpc("wallet_migrate_account", persistArgs);
        if (mErr) { console.error("[flutterwave] wallet_migrate_account:", mErr.message); return json({ error: "Could not switch your wallet to the new account. Please try again." }, 500); }
        migrated = moved === true;
      } else {
        const { error: pErr } = await sb.rpc("wallet_persist_account", { ...persistArgs, p_account: target.key });
        if (pErr) { console.error("[flutterwave] wallet_persist_account:", pErr.message); return json({ error: "Could not save your wallet account. Please try again." }, 500); }
      }

      return json({
        ok: true,
        migrated,
        account: target.key,
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
      // (A customer id only means something on the Flutterwave account that created it, so a wallet that
      // still sits on the other account gets a fresh customer on the active one.)
      const { data: w } = await sb.from("wallets").select("flw_customer_id, flw_account").eq("user_id", uid).maybeSingle();
      let customerId = (w?.flw_account === "business" ? "business" : "legacy") === ACTIVE.key ? (w?.flw_customer_id as string | null) : null;
      if (!customerId) {
        const { data: profile } = await sb.from("profiles").select("email, full_name, business_name, phone").eq("id", uid).maybeSingle();
        const email = customerEmail(profile?.email || user.email, `bill+${uid.slice(0, 8)}@kudiai.app`);
        const fullName = (profile?.full_name || profile?.business_name || "KudiAI User").trim();
        const custBody = JSON.stringify({
          email, name: customerName(fullName, "User"),
          ...(customerPhone(String(profile?.phone ?? "")) ? { phone: customerPhone(String(profile?.phone ?? "")) } : {}),
        });
        const c = await flwFetch("/customers", {
          method: "POST",
          headers: { "X-Idempotency-Key": `cus-${uid}-${(await sha256Hex(custBody)).slice(0, 10)}` },
          body: custBody,
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
      if (!w?.flw_customer_id || (w.flw_account === "business" ? "business" : "legacy") !== ACTIVE.key) return json({ error: "Activate your wallet first" }, 400);
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

    // ── schedule-transfer — PIN-confirmed ONCE, sets up a standing instruction
    //    (wallet_run_scheduled_transfers + process-scheduled-transfer run every
    //    future cycle unattended, re-checking balance/caps fresh each time —
    //    see that action's own comment for why) ─────────────────────────────
    if (action === "schedule-transfer") {
      const { amount_kobo, bank_code, account_number, narration, book_expense, pin, confirmed_name, frequency, start_at } = body as {
        amount_kobo: number; bank_code: string; account_number: string;
        narration?: string; book_expense?: boolean; pin?: string; confirmed_name?: string;
        frequency?: string; start_at?: string;
      };
      if (!amount_kobo || amount_kobo <= 0) return json({ error: "Enter an amount" }, 400);
      if (!bank_code || !account_number) return json({ error: "Bank and account number required" }, 400);
      if (!pin || !/^\d{4,6}$/.test(String(pin))) return json({ error: "Enter your transaction PIN", code: "pin_required" }, 400);
      if (!["daily", "weekly", "monthly"].includes(String(frequency))) return json({ error: "Choose how often this should repeat" }, 400);

      // 1. verify the transaction PIN server-side — this ONE verification
      //    authorizes the whole standing instruction; there is no PIN to check
      //    on any future unattended run.
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

      // 2. resolve the recipient name — same as an instant transfer, verified
      //    once now rather than trusted blindly on every future run.
      const rr = await flwResolve(bank_code, account_number);
      if (!rr.ok && /INVALID_ACCOUNT|UNKNOWN_BANK_CODE|not recognized|is invalid/i.test(rr.type + " " + rr.msg)) {
        return json({ error: "That account or bank isn't valid. Please check and try again." }, 422);
      }
      const accountName = rr.ok ? rr.name : String(confirmed_name || "").trim();
      if (!accountName) return json({ error: "Could not verify that account. Try again in a moment." }, 422);

      const startAt = start_at && !isNaN(Date.parse(start_at)) ? new Date(start_at).toISOString() : null;

      // 3. create the standing instruction — no funds move yet; the first run
      //    happens on wallet_run_scheduled_transfers' next tick once due.
      const { data: scheduleId, error: schedErr } = await asUser.rpc("wallet_create_scheduled_transfer", {
        p_bank_code: bank_code,
        p_account_number: account_number,
        p_account_name: accountName,
        p_amount_kobo: Math.round(amount_kobo),
        p_narration: String(narration || "").slice(0, 100),
        p_book_expense: !!book_expense,
        p_frequency: frequency,
        p_start_at: startAt,
      });
      if (schedErr) return json({ error: schedErr.message.replace(/^.*:\s*/, "") }, 400);

      return json({ ok: true, account_name: accountName, scheduled_transfer_id: scheduleId });
    }

    // ── list-scheduled-transfers / cancel-scheduled-transfer — thin wrappers so
    //    the client never needs the service-role-only bookkeeping RPCs directly ──
    if (action === "list-scheduled-transfers") {
      const { data, error } = await asUser.from("wallet_scheduled_transfers").select("*").order("created_at", { ascending: false });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, scheduled: data || [] });
    }

    if (action === "set-scheduled-transfer-status") {
      const { scheduled_transfer_id, status } = body as { scheduled_transfer_id: string; status: string };
      if (!scheduled_transfer_id || !["active", "paused", "cancelled"].includes(String(status))) {
        return json({ error: "Invalid request" }, 400);
      }
      const { error } = await asUser.rpc("wallet_set_scheduled_transfer_status", { p_id: scheduled_transfer_id, p_status: status });
      if (error) return json({ error: error.message.replace(/^.*:\s*/, "") }, 400);
      return json({ ok: true });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    console.error("[flutterwave]", e);
    return json({ error: (e as Error).message || "Wallet request failed" }, 500);
  }
});
