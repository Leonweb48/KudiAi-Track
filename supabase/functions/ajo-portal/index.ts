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

const CLIENT_SELECT = `
  id, full_name, email, phone, profile_image_url, owner_id, staff_id,
  current_balance, total_saved, total_withdrawn,
  next_contribution_date, contribution_frequency, contribution_amount,
  registration_date, membership_number, portal_active, status,
  address, state, lga, ward, notes
`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const { action } = body;

  try {
    // ── Login with membership number + PIN ────────────────────────
    if (action === "auth") {
      const { membership_number, pin } = body as { membership_number: string; pin: string };
      if (!membership_number || !pin) return json({ error: "Membership number and PIN required" }, 400);

      const { data: client, error } = await sb
        .from("aso_clients")
        .select(CLIENT_SELECT)
        .eq("membership_number", String(membership_number).trim().toUpperCase())
        .eq("portal_pin", String(pin).trim())
        .maybeSingle();

      if (error || !client) return json({ error: "Invalid membership number or PIN" }, 401);
      if (!client.portal_active) {
        return json({ error: "Portal access is disabled. Contact your savings agent." }, 403);
      }
      return json({ client });
    }

    // ── Refresh client data by ID (session already validated) ─────
    if (action === "get-client") {
      const { client_id, owner_id } = body as { client_id: string; owner_id: string };
      const { data: client } = await sb
        .from("aso_clients")
        .select(CLIENT_SELECT)
        .eq("id", client_id)
        .eq("owner_id", owner_id)
        .maybeSingle();
      if (!client) return json({ error: "Client not found" }, 404);
      return json({ client });
    }

    // ── Contribution history ───────────────────────────────────────
    if (action === "get-contributions") {
      const { client_id, owner_id } = body as { client_id: string; owner_id: string };
      const { data } = await sb
        .from("ajo_contributions")
        .select("*")
        .eq("aso_client_id", client_id)
        .eq("owner_id", owner_id)
        .order("created_at", { ascending: false })
        .limit(100);
      return json({ contributions: data || [] });
    }

    // ── Owner + assigned-staff info ───────────────────────────────
    if (action === "get-owner-info") {
      const { owner_id, client_id } = body as { owner_id: string; client_id: string };

      const [ownerRes, clientRes] = await Promise.all([
        sb.from("profiles").select("business_name, full_name, phone, email, profile_image_url").eq("id", owner_id).maybeSingle(),
        sb.from("aso_clients").select("staff_id").eq("id", client_id).maybeSingle(),
      ]);

      let staffInfo = null;
      if (clientRes.data?.staff_id) {
        const { data: staff } = await sb
          .from("staff")
          .select("full_name, phone, email, profile_image_url")
          .eq("id", clientRes.data.staff_id)
          .maybeSingle();
        staffInfo = staff;
      }

      return json({ owner: ownerRes.data, staff: staffInfo });
    }

    // ── Record a Paystack-confirmed contribution ───────────────────
    if (action === "record-contribution") {
      const { client_id, owner_id, amount, payment_method, paystack_ref, notes } = body as {
        client_id: string; owner_id: string; amount: number;
        payment_method?: string; paystack_ref?: string; notes?: string;
      };

      await sb.from("ajo_contributions").insert({
        aso_client_id:  client_id,
        owner_id,
        amount,
        type:           "contribution",
        payment_method: payment_method || "paystack",
        paystack_ref:   paystack_ref || null,
        status:         "completed",
        notes:          notes || null,
      });

      const { data: cl } = await sb
        .from("aso_clients")
        .select("total_saved, current_balance, contribution_frequency, next_contribution_date")
        .eq("id", client_id)
        .maybeSingle();

      if (!cl) return json({ error: "Client not found" }, 404);

      const freqDays: Record<string, number> = { daily: 1, weekly: 7, monthly: 30 };
      const days = freqDays[cl.contribution_frequency] || 30;
      const base = cl.next_contribution_date || new Date().toISOString().slice(0, 10);
      const nd   = new Date(base);
      nd.setDate(nd.getDate() + days);

      const { data: updated } = await sb.from("aso_clients")
        .update({
          total_saved:            (cl.total_saved     || 0) + amount,
          current_balance:        (cl.current_balance || 0) + amount,
          next_contribution_date: nd.toISOString().slice(0, 10),
        })
        .eq("id", client_id)
        .select(CLIENT_SELECT)
        .single();

      return json({ client: updated });
    }

    // ── Change PIN ────────────────────────────────────────────────
    if (action === "change-pin") {
      const { client_id, old_pin, new_pin } = body as { client_id: string; old_pin: string; new_pin: string };
      if (!new_pin || !/^\d{4}$/.test(new_pin)) return json({ error: "PIN must be exactly 4 digits" }, 400);

      const { data: cl } = await sb.from("aso_clients").select("portal_pin").eq("id", client_id).maybeSingle();
      if (!cl || cl.portal_pin !== String(old_pin).trim()) return json({ error: "Current PIN is incorrect" }, 401);

      await sb.from("aso_clients").update({ portal_pin: new_pin }).eq("id", client_id);
      return json({ success: true });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});
