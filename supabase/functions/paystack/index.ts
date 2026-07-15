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

    // ── Create a Paystack subaccount for an Ajo client or group ─────────
    if (action === "create-subaccount") {
      const { client_id, group_id, business_name, bank_code, account_number, percentage_charge = 100, bank_name } = body as {
        client_id?: string; group_id?: string; business_name: string;
        bank_code: string; account_number: string; percentage_charge?: number;
        bank_name?: string;
      };
      if ((!client_id && !group_id) || !business_name || !bank_code || !account_number) {
        return json({ error: "business_name, bank_code and account_number are required, plus either client_id or group_id" }, 400);
      }

      // Verify ownership
      const token = authHeader.replace("Bearer ", "");
      const { data: { user } } = await sb.auth.getUser(token);
      if (!user) return json({ error: "Unauthorized" }, 401);

      if (client_id) {
        const { data: cl } = await sb.from("aso_clients").select("id, user_id").eq("id", client_id).maybeSingle();
        if (!cl) return json({ error: "Client not found" }, 404);
        if (user.id !== cl.user_id) return json({ error: "Forbidden" }, 403);
      } else {
        const { data: grp } = await sb.from("ajo_groups").select("id, owner_id").eq("id", group_id!).maybeSingle();
        if (!grp) return json({ error: "Group not found" }, 404);
        if (user.id !== grp.owner_id) return json({ error: "Forbidden" }, 403);
      }

      // Create Paystack subaccount
      const psRes = await fetch("https://api.paystack.co/subaccount", {
        method: "POST",
        headers: psHeaders,
        body: JSON.stringify({
          business_name,
          settlement_bank: bank_code,
          account_number,
          percentage_charge,
        }),
      });
      const psData = await psRes.json();
      if (!psData.status || !psData.data?.subaccount_code) {
        return json({ error: psData.message || "Failed to create subaccount" }, 422);
      }

      // Persist subaccount code + bank details back to the correct record
      const patch = {
        paystack_subaccount_code: psData.data.subaccount_code,
        paystack_subaccount_id:   String(psData.data.id),
        account_name:             psData.data.account_name ?? null,
        bank_name:                bank_name || null,
      };
      if (client_id) {
        await sb.from("aso_clients").update(patch).eq("id", client_id);
      } else {
        await sb.from("ajo_groups").update(patch).eq("id", group_id!);
      }

      return json({ subaccount_code: psData.data.subaccount_code, data: psData.data });
    }

    // ── Update an existing Paystack subaccount ─────────────────────────────
    if (action === "update-subaccount") {
      const { client_id, settlement_bank, account_number, business_name, percentage_charge, bank_name } = body as {
        client_id?: string; settlement_bank?: string; account_number?: string;
        business_name?: string; percentage_charge?: number; bank_name?: string;
      };

      // Resolve subaccount code — auth-gated when client_id provided
      let subaccountCode = (body as { subaccount_code?: string }).subaccount_code;
      if (client_id) {
        const token = authHeader.replace("Bearer ", "");
        const { data: { user } } = await sb.auth.getUser(token);
        if (!user) return json({ error: "Unauthorized" }, 401);
        const { data: cl } = await sb.from("aso_clients")
          .select("user_id, paystack_subaccount_code")
          .eq("id", client_id).maybeSingle();
        if (!cl) return json({ error: "Client not found" }, 404);
        if (user.id !== cl.user_id) return json({ error: "Forbidden" }, 403);
        subaccountCode = cl.paystack_subaccount_code;
        if (!subaccountCode) return json({ error: "No subaccount linked to this client yet" }, 400);
      }
      if (!subaccountCode) return json({ error: "client_id or subaccount_code required" }, 400);

      const psRes = await fetch(`https://api.paystack.co/subaccount/${subaccountCode}`, {
        method: "PUT",
        headers: psHeaders,
        body: JSON.stringify({ business_name, settlement_bank, account_number, percentage_charge }),
      });
      const psData = await psRes.json();

      // If called via client_id, persist updated bank details to aso_clients
      if (client_id && psData.status) {
        const patch: Record<string, unknown> = {};
        if (settlement_bank) patch.bank_code     = settlement_bank;
        if (account_number)  patch.account_number = account_number;
        if (bank_name)       patch.bank_name      = bank_name;
        if (psData.data?.account_name) patch.account_name = psData.data.account_name;
        if (Object.keys(patch).length) await sb.from("aso_clients").update(patch).eq("id", client_id);
      }

      return json(psData);
    }

    // ── Initialize an Ajo contribution payment (with subaccount routing) ───
    if (action === "initialize-contribution") {
      const _icToken = authHeader.replace("Bearer ", "");
      if (!_icToken) return json({ error: "Unauthorized" }, 401);
      const { data: { user: _icUser } } = await sb.auth.getUser(_icToken);
      if (!_icUser) return json({ error: "Unauthorized" }, 401);

      const { client_id, owner_id, amount, email, reference } = body as {
        client_id: string; owner_id: string; amount: number;
        email: string; reference: string;
      };

      // Fetch the client's group subaccount — also used for caller ownership check
      const { data: cl } = await sb
        .from("aso_clients")
        .select("id, ajo_group_id, contribution_amount, user_id, client_user_id")
        .eq("id", client_id)
        .maybeSingle();
      if (!cl) return json({ error: "Client not found" }, 404);
      // Caller must be the business owner or the client themselves
      if (cl.user_id !== _icUser.id && cl.client_user_id !== _icUser.id) {
        return json({ error: "Forbidden" }, 403);
      }

      let subaccountCode: string | undefined;
      if (cl.ajo_group_id) {
        const { data: grp } = await sb
          .from("ajo_groups")
          .select("paystack_subaccount_code")
          .eq("id", cl.ajo_group_id)
          .maybeSingle();
        subaccountCode = grp?.paystack_subaccount_code ?? undefined;
      }

      const psRes = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: psHeaders,
        body: JSON.stringify({
          email,
          amount:     Math.round(Number(amount) * 100),
          reference,
          channels:   ["card", "bank", "ussd", "mobile_money", "bank_transfer"],
          subaccount: subaccountCode,
          bearer:     subaccountCode ? "subaccount" : undefined,
          metadata: {
            client_id,
            owner_id,
            type: "ajo_contribution",
          },
        }),
      });
      const psData = await psRes.json();
      return json({ ...psData, public_key: PUBLIC_KEY });
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

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});
