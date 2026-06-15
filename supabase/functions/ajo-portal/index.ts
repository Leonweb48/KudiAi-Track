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
  id, full_name, email, phone, profile_image_url, owner_id, user_id, staff_id,
  current_balance, total_saved, total_withdrawn,
  next_contribution_date, contribution_frequency, contribution_amount,
  registration_date, membership_number, portal_active, status,
  address, state, lga, ward, notes,
  registration_charge, withdrawal_fee_percent
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

      // On first login (no last_login_at set yet), fire welcome email
      const { data: loginCheck } = await sb
        .from("aso_clients")
        .select("last_login_at")
        .eq("id", client.id)
        .maybeSingle();
      const isFirstLogin = !loginCheck?.last_login_at;

      // Update last_login_at
      await sb.from("aso_clients")
        .update({ last_login_at: new Date().toISOString() })
        .eq("id", client.id);

      if (isFirstLogin && client.email) {
        fetch("https://kuditrack-admin.vercel.app/api/public/email-trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-trigger-secret": "kuditrack-email-trigger-2026-amaya" },
          body: JSON.stringify({ event: "ajo_client_first_login", data: { name: client.full_name || "", email: client.email } }),
        }).catch(() => null);
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
        .or(`user_id.eq.${owner_id},owner_id.eq.${owner_id}`)
        .maybeSingle();
      if (!client) return json({ error: "Client not found" }, 404);
      return json({ client });
    }

    // ── Contribution history ───────────────────────────────────────
    if (action === "get-contributions") {
      const { client_id } = body as { client_id: string };
      const { data } = await sb
        .from("ajo_contributions")
        .select("*")
        .eq("aso_client_id", client_id)
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

      // Fire contribution email notifications
      const { data: clientFull } = await sb
        .from("aso_clients")
        .select("full_name, email, user_id, staff_id")
        .eq("id", client_id)
        .maybeSingle();

      if (clientFull) {
        const resolvedOwnerId2 = owner_id || clientFull.user_id;
        const emailData: Record<string, string | number> = {
          client_id:   client_id,
          client_name: clientFull.full_name || "",
          client_email: clientFull.email || "",
          amount,
          date: new Date().toLocaleDateString("en-NG"),
          balance: (cl.current_balance || 0) + amount,
        };
        if (clientFull.staff_id) {
          const { data: staffRow } = await sb
            .from("staff").select("email, full_name").eq("id", clientFull.staff_id).maybeSingle();
          if (staffRow?.email) emailData.staff_email = staffRow.email;
          if (staffRow?.full_name) emailData.staff_name = staffRow.full_name;
        }
        if (resolvedOwnerId2) {
          const { data: ownerRow } = await sb
            .from("profiles").select("email, business_name").eq("id", resolvedOwnerId2).maybeSingle();
          if (ownerRow?.email) emailData.owner_email = ownerRow.email;
          if (ownerRow?.business_name) emailData.business_name = ownerRow.business_name;
        }

        await fetch("https://kuditrack-admin.vercel.app/api/public/email-trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-trigger-secret": "kuditrack-email-trigger-2026-amaya" },
          body: JSON.stringify({ event: "ajo_contribution", data: emailData }),
        }).catch(() => null);
      }

      return json({ client: updated });
    }

    // ── Client requests a withdrawal ─────────────────────────────
    if (action === "request-withdrawal") {
      const { client_id, owner_id, amount } = body as { client_id: string; owner_id: string; amount: number };
      if (!client_id || !owner_id || !amount || amount <= 0) return json({ error: "client_id, owner_id and amount are required" }, 400);

      const { data: cl } = await sb.from("aso_clients")
        .select("full_name, email, user_id, current_balance, total_withdrawn, registration_charge, withdrawal_fee_percent")
        .eq("id", client_id)
        .or(`user_id.eq.${owner_id},owner_id.eq.${owner_id}`)
        .maybeSingle();

      if (!cl) return json({ error: "Client not found" }, 404);
      if (amount > (cl.current_balance || 0)) return json({ error: "Insufficient balance" }, 400);

      // First withdrawal uses flat registration_charge; subsequent use withdrawal_fee_percent
      const isFirst    = (cl.total_withdrawn || 0) === 0;
      const feeType    = isFirst ? "registration_fee" : "withdrawal_fee";
      const feeAmount  = isFirst
        ? (cl.registration_charge || 0)
        : (amount * (cl.withdrawal_fee_percent || 0)) / 100;
      const netAmount  = amount - feeAmount;

      if (netAmount <= 0) return json({ error: "Amount too small after fee deduction" }, 400);

      const resolvedOwnerId = cl.user_id || owner_id;

      const { data: request, error: reqErr } = await sb.from("ajo_withdrawal_requests").insert({
        aso_client_id: client_id,
        owner_id: resolvedOwnerId,
        amount,
        fee_type:   feeType,
        fee_amount: feeAmount,
        net_amount: netAmount,
        status:     "pending",
      }).select().single();

      if (reqErr) return json({ error: reqErr.message }, 500);

      const { data: owner } = await sb.from("profiles")
        .select("email, business_name").eq("id", resolvedOwnerId).maybeSingle();

      await fetch("https://kuditrack-admin.vercel.app/api/public/email-trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-trigger-secret": "kuditrack-email-trigger-2026-amaya" },
        body: JSON.stringify({
          event: "ajo_withdrawal_request",
          data: {
            client_id:     client_id,
            client_name:   cl.full_name || "",
            client_email:  cl.email     || "",
            owner_id:      resolvedOwnerId,
            owner_email:   owner?.email  || "",
            business_name: owner?.business_name || "",
            amount,
            fee_type:   feeType,
            fee_amount: feeAmount,
            net_amount: netAmount,
            date: new Date().toLocaleDateString("en-NG"),
          },
        }),
      }).catch(() => null);

      return json({ request });
    }

    // ── Client: fetch their own withdrawal requests ───────────────
    if (action === "get-withdrawal-requests") {
      const { client_id, owner_id } = body as { client_id: string; owner_id: string };
      const { data } = await sb.from("ajo_withdrawal_requests")
        .select("*")
        .eq("aso_client_id", client_id)
        .eq("owner_id", owner_id)
        .order("requested_at", { ascending: false })
        .limit(20);
      return json({ requests: data || [] });
    }

    // ── Business: fetch all pending requests ──────────────────────
    if (action === "get-pending-requests") {
      const { owner_id } = body as { owner_id: string };
      const { data } = await sb.from("ajo_withdrawal_requests")
        .select("*, aso_clients(full_name, email, current_balance, membership_number)")
        .eq("owner_id", owner_id)
        .eq("status", "pending")
        .order("requested_at", { ascending: false });
      return json({ requests: data || [] });
    }

    // ── Business: approve a withdrawal request ────────────────────
    if (action === "approve-withdrawal") {
      const { request_id, owner_id } = body as { request_id: string; owner_id: string };
      if (!request_id || !owner_id) return json({ error: "request_id and owner_id required" }, 400);

      const { data: req } = await sb.from("ajo_withdrawal_requests")
        .select("*")
        .eq("id", request_id)
        .eq("owner_id", owner_id)
        .eq("status", "pending")
        .maybeSingle();

      if (!req) return json({ error: "Request not found or already processed" }, 404);

      const { data: cl } = await sb.from("aso_clients")
        .select("full_name, email, current_balance, total_withdrawn")
        .eq("id", req.aso_client_id)
        .maybeSingle();

      if (!cl) return json({ error: "Client not found" }, 404);
      if ((cl.current_balance || 0) < req.amount) return json({ error: "Insufficient client balance" }, 400);

      await sb.from("ajo_withdrawal_requests")
        .update({ status: "approved", approved_at: new Date().toISOString() })
        .eq("id", request_id);

      await sb.from("ajo_contributions").insert({
        aso_client_id:  req.aso_client_id,
        owner_id,
        amount:         req.net_amount,
        type:           "withdrawal",
        payment_method: "cash",
        status:         "completed",
        notes:          `Approved withdrawal. Gross: ₦${req.amount}, Fee (${req.fee_type}): ₦${req.fee_amount}`,
      });

      const newBalance  = (cl.current_balance  || 0) - req.amount;
      const newWithdrawn = (cl.total_withdrawn || 0) + req.amount;
      await sb.from("aso_clients")
        .update({ current_balance: newBalance, total_withdrawn: newWithdrawn })
        .eq("id", req.aso_client_id);

      const { data: owner } = await sb.from("profiles")
        .select("email, business_name").eq("id", owner_id).maybeSingle();

      await fetch("https://kuditrack-admin.vercel.app/api/public/email-trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-trigger-secret": "kuditrack-email-trigger-2026-amaya" },
        body: JSON.stringify({
          event: "ajo_withdrawal_approved",
          data: {
            client_id:     req.aso_client_id,
            client_name:   cl.full_name || "",
            client_email:  cl.email     || "",
            owner_id:      owner_id,
            owner_email:   owner?.email  || "",
            business_name: owner?.business_name || "",
            amount:        req.amount,
            fee_type:      req.fee_type,
            fee_amount:    req.fee_amount,
            net_amount:    req.net_amount,
            balance_after: newBalance,
            date: new Date().toLocaleDateString("en-NG"),
          },
        }),
      }).catch(() => null);

      return json({ success: true });
    }

    // ── Business: reject a withdrawal request ─────────────────────
    if (action === "reject-withdrawal") {
      const { request_id, owner_id } = body as { request_id: string; owner_id: string };
      if (!request_id || !owner_id) return json({ error: "request_id and owner_id required" }, 400);

      const { data: req } = await sb.from("ajo_withdrawal_requests")
        .select("id").eq("id", request_id).eq("owner_id", owner_id).eq("status", "pending").maybeSingle();

      if (!req) return json({ error: "Request not found or already processed" }, 404);

      await sb.from("ajo_withdrawal_requests")
        .update({ status: "rejected", approved_at: new Date().toISOString() })
        .eq("id", request_id);

      return json({ success: true });
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
