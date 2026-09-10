// Flutterwave v4 wallet API — deployed --no-verify-jwt; auth is enforced in-function
// (user actions: sb.auth.getUser(token); `disburse`: token must equal the service key).
//
// Powers the digital-wallet test build:
//   provision-account  → create FLW customer + static virtual account, store on wallets
//   list-banks         → NG bank list (for the withdraw form)
//   resolve-account    → name enquiry on a bank account
//   submit-withdrawal  → validate + hold funds + raise an admin approval request
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
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY      = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

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

async function flwFetch(path: string, init: RequestInit & { scenario?: string } = {}) {
  const token = await flwToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> || {}),
  };
  if (init.scenario) headers["X-Scenario-Key"] = init.scenario;
  const res = await fetch(`${FLW_BASE}${path}`, { ...init, headers });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  console.log(`FLW ${init.method || "GET"} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return { ok: res.ok, status: res.status, data };
}

// ── bank list cache ─────────────────────────────────────────────────────────
let _banks: { list: unknown[]; exp: number } = { list: [], exp: 0 };

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
    // ═══ disburse — service-role only (called by the admin approval API) ═════
    if (action === "disburse") {
      if (token !== SERVICE_KEY) return json({ error: "Unauthorized" }, 401);
      const { reference, amount_kobo, bank_code, account_number, account_name, narration } = body as {
        reference: string; amount_kobo: number; bank_code: string;
        account_number: string; account_name?: string; narration?: string;
      };
      const naira = Math.round(Number(amount_kobo) / 100);
      const [first, ...rest] = String(account_name || "KudiAI Wallet").trim().split(/\s+/);
      const r = await flwFetch("/direct-transfers", {
        method: "POST",
        headers: { "X-Idempotency-Key": reference, "X-Trace-Id": `${reference}-tr` },
        body: JSON.stringify({
          action: "instant", type: "bank", reference,
          narration: String(narration || "KudiAI wallet transfer").slice(0, 100),
          payment_instruction: {
            amount: { value: naira, applies_to: "destination_currency" },
            source_currency: "NGN", destination_currency: "NGN",
            recipient: {
              bank: { code: bank_code, account_number },
              name: { first: first || "KudiAI", last: rest.join(" ") || "Wallet" },
            },
          },
        }),
      });
      if (!r.ok) return json({ error: (r.data as any)?.error?.message || "Payout failed", detail: r.data }, 502);
      const d = r.data as any;
      const feeKobo = Math.round(Number(d?.fee?.value || 0) * 100);
      return json({ ok: true, transfer_id: d?.id || "", status: d?.status || "NEW", fee_kobo: feeKobo });
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
      const r = await flwFetch("/banks/account-resolve", {
        method: "POST",
        body: JSON.stringify({ currency: "NGN", account: { code: bank_code, number: account_number } }),
      });
      if (!r.ok) return json({ error: "Could not verify that account" }, 422);
      return json({ ok: true, account_name: (r.data as any)?.data?.account_name || "" });
    }

    // ── provision-account ────────────────────────────────────────────────
    if (action === "provision-account") {
      const { error: initErr } = await asUser.rpc("wallet_get_or_create");
      if (initErr) { console.error("[flutterwave] wallet_get_or_create:", initErr.message); return json({ error: "Wallet init failed" }, 500); }
      const { data: w } = await sb.from("wallets").select("*").eq("user_id", uid).maybeSingle();
      if (!w) return json({ error: "Wallet init failed" }, 500);
      if (w.flw_virtual_account_id && w.flw_account_number) {
        return json({
          ok: true, account_number: w.flw_account_number,
          account_bank: w.flw_account_bank, account_name: w.flw_account_name,
        });
      }

      // ── BVN / NIN. Live static accounts are validated against NIBSS; in test
      //    mode a placeholder is fine.
      const testMode = (await cfg("wallet_test_mode", "true")) === "true";
      const bvn = String((body as Record<string, unknown>).bvn ?? "").replace(/\D/g, "");
      const nin = String((body as Record<string, unknown>).nin ?? "").replace(/\D/g, "");
      const effBvn = bvn || (testMode ? FLW_TEST_BVN : "");
      if (!/^\d{11}$/.test(effBvn)) {
        return json({ error: "A valid 11-digit BVN is required to activate your wallet", code: "bvn_required" }, 400);
      }

      const { data: profile } = await sb.from("profiles")
        .select("email, full_name, business_name, phone").eq("id", uid).maybeSingle();
      const email = profile?.email || user.email || `wallet+${uid.slice(0, 8)}@kudiai.app`;
      const fullName = (profile?.full_name || profile?.business_name || "KudiAI Owner").trim();
      const [fn, ...ln] = fullName.split(/\s+/);
      const phoneRaw = String(profile?.phone ?? "").replace(/\D/g, "");

      let customerId = w.flw_customer_id as string | null;
      if (!customerId) {
        const c = await flwFetch("/customers", {
          method: "POST",
          headers: { "X-Idempotency-Key": `cus-${uid}` },
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
        headers: { "X-Idempotency-Key": `va-${uid}` },
        body: JSON.stringify({
          customer_id: customerId,
          reference: `kdt-${uid}`,                 // ≤42 chars, stable per user
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
          await sb.from("admin_notifications").insert({
            type: "error", category: "finance", target_roles: ["finance_admin", "super_admin"],
            title: "Wallet activation blocked by Flutterwave",
            message: `Flutterwave rejected virtual-account creation: "${(va.data as any)?.error?.message}". The wallet product may not be enabled or the account is under review — contact Flutterwave support.`,
            metadata: { detail: va.data },
          }).catch(() => {});
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
        p_user_id: uid,
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

    // ── submit-withdrawal / send money ──────────────────────────────────
    if (action === "submit-withdrawal") {
      const { amount_kobo, bank_code, account_number, narration, book_expense } = body as {
        amount_kobo: number; bank_code: string; account_number: string;
        narration?: string; book_expense?: boolean;
      };
      if (!amount_kobo || amount_kobo <= 0) return json({ error: "Enter an amount" }, 400);
      if (!bank_code || !account_number) return json({ error: "Bank and account number required" }, 400);

      // resolve the name server-side (don't trust a client-supplied name)
      const nr = await flwFetch("/banks/account-resolve", {
        method: "POST",
        body: JSON.stringify({ currency: "NGN", account: { code: bank_code, number: account_number } }),
      });
      if (!nr.ok) return json({ error: "Could not verify that bank account" }, 422);
      const accountName = (nr.data as any)?.data?.account_name || "";

      const { data: reqId, error } = await asUser.rpc("wallet_submit_withdrawal", {
        p_amount_kobo: Math.round(amount_kobo),
        p_bank_code: bank_code,
        p_account_number: account_number,
        p_account_name: accountName,
        p_narration: String(narration || "").slice(0, 100),
        p_book_expense: !!book_expense,
      });
      if (error) return json({ error: error.message.replace(/^.*:\s*/, "") }, 400);
      return json({ ok: true, request_id: reqId, account_name: accountName });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    console.error("[flutterwave]", e);
    return json({ error: (e as Error).message || "Wallet request failed" }, 500);
  }
});
