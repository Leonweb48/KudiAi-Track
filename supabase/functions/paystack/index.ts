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
      const { email, amount, reference, metadata, subaccount, bearer, channels } = body as {
        email: string; amount: number; reference: string;
        metadata?: Record<string, unknown>; subaccount?: string;
        bearer?: string; channels?: string[];
      };
      const res = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: psHeaders,
        body: JSON.stringify({
          email,
          amount:     Math.round(Number(amount) * 100),
          reference,
          metadata,
          subaccount: subaccount ?? undefined,
          bearer:     bearer ?? (subaccount ? "subaccount" : undefined),
          channels:   channels ?? ["card", "bank", "ussd", "mobile_money", "bank_transfer"],
        }),
      });
      return json(await res.json());
    }

    // ── Verify a transaction ───────────────────────────────────────────────
    if (action === "verify") {
      const { reference } = body as { reference: string };
      const res = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
        { headers: psHeaders },
      );
      return json(await res.json());
    }

    // ── Resolve a bank account (verify account number + bank code) ─────────
    if (action === "resolve-account") {
      const { account_number, bank_code } = body as { account_number: string; bank_code: string };
      const res = await fetch(
        `https://api.paystack.co/bank/resolve?account_number=${account_number}&bank_code=${bank_code}`,
        { headers: psHeaders },
      );
      return json(await res.json());
    }

    // ── List Nigerian banks ────────────────────────────────────────────────
    if (action === "list-banks") {
      const res = await fetch(
        "https://api.paystack.co/bank?country=nigeria&use_cursor=false&perPage=100",
        { headers: psHeaders },
      );
      return json(await res.json());
    }

    // ── Create a Paystack subaccount for an Ajo group ─────────────────────
    if (action === "create-subaccount") {
      const { group_id, business_name, bank_code, account_number, percentage_charge = 100 } = body as {
        group_id: string; business_name: string;
        bank_code: string; account_number: string; percentage_charge?: number;
      };

      // Verify group belongs to the authenticated user
      const { data: grp, error: grpErr } = await sb
        .from("ajo_groups").select("id, owner_id").eq("id", group_id).maybeSingle();
      if (grpErr || !grp) return json({ error: "Group not found" }, 404);

      // Validate caller is the group owner (JWT sub matches owner_id)
      const token = authHeader.replace("Bearer ", "");
      const { data: { user } } = await sb.auth.getUser(token);
      if (!user || user.id !== grp.owner_id) return json({ error: "Forbidden" }, 403);

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

      // Persist subaccount code back to the group record
      await sb.from("ajo_groups").update({
        paystack_subaccount_code: psData.data.subaccount_code,
        paystack_subaccount_id:   String(psData.data.id),
        account_name:             psData.data.account_name ?? null,
        updated_at:               new Date().toISOString(),
      }).eq("id", group_id);

      return json({ subaccount_code: psData.data.subaccount_code, data: psData.data });
    }

    // ── Update an existing Paystack subaccount ─────────────────────────────
    if (action === "update-subaccount") {
      const { subaccount_code, business_name, settlement_bank, account_number, percentage_charge } = body as {
        subaccount_code: string; business_name?: string; settlement_bank?: string;
        account_number?: string; percentage_charge?: number;
      };
      const psRes = await fetch(`https://api.paystack.co/subaccount/${subaccount_code}`, {
        method: "PUT",
        headers: psHeaders,
        body: JSON.stringify({ business_name, settlement_bank, account_number, percentage_charge }),
      });
      return json(await psRes.json());
    }

    // ── Initialize an Ajo contribution payment (with subaccount routing) ───
    if (action === "initialize-contribution") {
      const { client_id, owner_id, amount, email, reference } = body as {
        client_id: string; owner_id: string; amount: number;
        email: string; reference: string;
      };

      // Fetch the client's group subaccount
      const { data: cl } = await sb
        .from("aso_clients")
        .select("id, ajo_group_id, contribution_amount")
        .eq("id", client_id)
        .maybeSingle();

      let subaccountCode: string | undefined;
      if (cl?.ajo_group_id) {
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

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});
