import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const SECRET_KEY  = Deno.env.get("PAYSTACK_SECRET_KEY")  ?? "";
  const PUBLIC_KEY  = Deno.env.get("PAYSTACK_PUBLIC_KEY")  ?? "";
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!SECRET_KEY) return json({ error: "Paystack not configured" }, 503);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const authHeader = req.headers.get("Authorization") ?? "";
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const psHeaders = {
    Authorization:  `Bearer ${SECRET_KEY}`,
    "Content-Type": "application/json",
  };

  try {
    const { action } = body;

    // ── Initialize a standard transaction ─────────────────────────────────
    if (action === "initialize") {
      // Require auth — prevents unauthenticated Paystack initialization
      const token = authHeader.replace("Bearer ", "");
      if (!token) return json({ error: "Unauthorized" }, 401);
      const { data: { user: initUser } } = await sb.auth.getUser(token);
      if (!initUser) return json({ error: "Unauthorized" }, 401);

      const { email, amount, reference, metadata, subaccount, bearer, channels } = body as {
        email: string; amount: number; reference: string;
        metadata?: Record<string, unknown>; subaccount?: string;
        bearer?: string; channels?: string[];
      };
      const { callback_url } = body as { callback_url?: string };
      const res = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: psHeaders,
        body: JSON.stringify({
          email,
          amount:       Math.round(Number(amount) * 100),
          reference,
          metadata,
          callback_url: callback_url ?? undefined,
          subaccount:   subaccount ?? undefined,
          bearer:       bearer ?? (subaccount ? "subaccount" : undefined),
          channels:     channels ?? ["card", "bank", "ussd", "mobile_money", "bank_transfer"],
        }),
      });
      const psResp = await res.json();
      return json({ ...psResp, public_key: PUBLIC_KEY });
    }

    // ── Verify a transaction ───────────────────────────────────────────────
    if (action === "verify") {
      const { reference } = body as { reference: string };
      if (!reference) return json({ error: "reference required" }, 400);

      // Require a valid Supabase user session for all bill verifications
      const token = authHeader.replace("Bearer ", "");
      if (!token) return json({ error: "Unauthorized" }, 401);
      const { data: { user }, error: authErr } = await sb.auth.getUser(token);
      if (authErr || !user) return json({ error: "Unauthorized" }, 401);

      const res = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
        { headers: psHeaders },
      );
      const psResp = await res.json();

      // Idempotency: mark as fulfilled on first success; reject on replay
      if (psResp?.data?.status === "success") {
        const { error: logErr } = await sb
          .from("paystack_webhook_log")
          .insert({ event: "bill.api_verify", reference, payload: { user_id: user.id, amount: psResp.data.amount, verified_at: new Date().toISOString() } });

        if (logErr?.code === "23505") {
          // Unique constraint — reference already fulfilled
          return json({ ...psResp, data: { ...psResp.data, status: "already_fulfilled" } });
        }
      }

      return json(psResp);
    }

    // ── Resolve a bank account (verify account number + bank code) ─────────
    if (action === "resolve-account") {
      const _raToken = authHeader.replace("Bearer ", "");
      if (!_raToken) return json({ error: "Unauthorized" }, 401);
      const { data: { user: _raUser } } = await sb.auth.getUser(_raToken);
      if (!_raUser) return json({ error: "Unauthorized" }, 401);
      const { account_number, bank_code } = body as { account_number: string; bank_code: string };
      const res = await fetch(
        `https://api.paystack.co/bank/resolve?account_number=${account_number}&bank_code=${bank_code}`,
        { headers: psHeaders },
      );
      return json(await res.json());
    }

    // ── List Nigerian banks ────────────────────────────────────────────────
    if (action === "list-banks") {
      const _lbToken = authHeader.replace("Bearer ", "");
      if (!_lbToken) return json({ error: "Unauthorized" }, 401);
      const { data: { user: _lbUser } } = await sb.auth.getUser(_lbToken);
      if (!_lbUser) return json({ error: "Unauthorized" }, 401);
      const res = await fetch(
        "https://api.paystack.co/bank?country=nigeria&use_cursor=false&perPage=100",
        { headers: psHeaders },
      );
      return json(await res.json());
    }

    // ── Create Paystack dedicated virtual account ──────────────────────────
    if (action === "create-virtual-account") {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: authErr } = await sb.auth.getUser(token);
      if (authErr || !user) return json({ error: "Unauthorized" }, 401);

      const { data: profile } = await sb.from("profiles")
        .select("owner_name, business_name, paystack_customer_code, virtual_account_number, virtual_account_bank, virtual_account_name")
        .eq("id", user.id).maybeSingle();

      if (profile?.virtual_account_number) {
        return json({ account: { bank: profile.virtual_account_bank, number: profile.virtual_account_number, name: profile.virtual_account_name } });
      }

      const email = user.email ?? "";
      const businessName = (profile?.business_name || profile?.owner_name || "Business").slice(0, 60);

      let customerCode = profile?.paystack_customer_code;
      if (!customerCode) {
        const custRes = await fetch("https://api.paystack.co/customer", {
          method: "POST", headers: psHeaders,
          body: JSON.stringify({ email, first_name: businessName, last_name: "Business" }),
        });
        const custData = await custRes.json();
        if (!custData.status) return json({ error: custData.message || "Failed to create Paystack customer" });
        customerCode = custData.data.customer_code;
        await sb.from("profiles").update({ paystack_customer_code: customerCode }).eq("id", user.id);
      }

      const preferredBank = (body as { preferred_bank?: string }).preferred_bank ?? "wema-bank";
      const dvaRes = await fetch("https://api.paystack.co/dedicated_account", {
        method: "POST", headers: psHeaders,
        body: JSON.stringify({ customer: customerCode, preferred_bank: preferredBank }),
      });
      const dvaData = await dvaRes.json();
      if (!dvaData.status) return json({ error: dvaData.message || "Failed to create virtual account" });

      const acct = dvaData.data;
      const bankName   = acct.bank?.name ?? preferredBank;
      const acctNumber = acct.account_number;
      const acctName   = acct.account_name;

      await sb.from("profiles").update({
        virtual_account_bank:   bankName,
        virtual_account_number: acctNumber,
        virtual_account_name:   acctName,
        virtual_account_ref:    acct.id ? String(acct.id) : null,
      }).eq("id", user.id);

      return json({ account: { bank: bankName, number: acctNumber, name: acctName } });
    }

    // ── Fetch virtual account from profile ─────────────────────────────────
    if (action === "get-virtual-account") {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user } } = await sb.auth.getUser(token);
      if (!user) return json({ error: "Unauthorized" }, 401);
      const { data: profile } = await sb.from("profiles")
        .select("virtual_account_bank, virtual_account_number, virtual_account_name")
        .eq("id", user.id).maybeSingle();
      if (!profile?.virtual_account_number) return json({ account: null });
      return json({ account: { bank: profile.virtual_account_bank, number: profile.virtual_account_number, name: profile.virtual_account_name } });
    }

    // ── Initiate a Paystack refund ─────────────────────────────────────────────
    // Called server-to-server only (service role key required).
    // Paystack refund API: POST /refund { transaction, amount? (kobo), merchant_note? }
    // Omitting amount triggers a full refund of the original charge.
    if (action === "refund") {
      const token = authHeader.replace("Bearer ", "");
      if (!token || token !== SERVICE_KEY) return json({ error: "Unauthorized" }, 401);
      const { transaction, amount, reason } = body as {
        transaction: string; amount?: number; reason?: string;
      };
      if (!transaction) return json({ error: "transaction reference required" }, 400);
      const refBody: Record<string, unknown> = { transaction };
      // If amount provided (NGN), convert to kobo. Omit for full refund.
      if (amount != null && Number(amount) > 0) refBody.amount = Math.round(Number(amount) * 100);
      if (reason) refBody.merchant_note = String(reason).slice(0, 200);
      const res = await fetch("https://api.paystack.co/refund", {
        method: "POST",
        headers: psHeaders,
        body: JSON.stringify(refBody),
      });
      const rd = await res.json();
      console.log(`[paystack/refund] ref=${transaction} status=${rd?.status} id=${rd?.data?.id ?? "n/a"}`);
      return json(rd);
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});
