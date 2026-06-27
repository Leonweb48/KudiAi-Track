import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EMAIL_TRIGGER_SECRET = Deno.env.get("EMAIL_TRIGGER_SECRET") ?? "";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const CLIENT_SELECT = `
  id, full_name, email, phone, profile_image_url, user_id, staff_id,
  ajo_group_id,
  current_balance, total_saved, total_withdrawn,
  next_contribution_date, contribution_frequency, contribution_amount,
  registration_date, membership_number, portal_active, status,
  address, state, lga, ward, notes,
  registration_charge, withdrawal_fee_percent
`;

const PAYSTACK_SECRET = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
const PAYSTACK_PUBLIC = Deno.env.get("PAYSTACK_PUBLIC_KEY") ?? "";

function genRef(prefix = "AJO") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

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
        fetch("https://admin.kudiai.app/api/public/email-trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
          body: JSON.stringify({ event: "ajo_client_first_login", data: { name: client.full_name || "", email: client.email } }),
        }).catch(() => null);
      }

      return json({ client });
    }

    // ── Refresh client data by ID (session already validated) ─────
    if (action === "get-client") {
      const { client_id } = body as { client_id: string };
      const { data: client } = await sb
        .from("aso_clients")
        .select(CLIENT_SELECT)
        .eq("id", client_id)
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

        await fetch("https://admin.kudiai.app/api/public/email-trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
          body: JSON.stringify({ event: "ajo_contribution", data: emailData }),
        }).catch(() => null);
      }

      return json({ client: updated });
    }

    // ── Client requests a withdrawal ─────────────────────────────
    if (action === "request-withdrawal") {
      const { client_id, owner_id, amount } = body as { client_id: string; owner_id: string; amount: number };
      if (!client_id || !amount || amount <= 0) return json({ error: "client_id and amount are required" }, 400);

      const { data: cl } = await sb.from("aso_clients")
        .select("full_name, email, user_id, current_balance, total_withdrawn, registration_charge, withdrawal_fee_percent")
        .eq("id", client_id)
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

      await fetch("https://admin.kudiai.app/api/public/email-trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
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
      const { client_id } = body as { client_id: string };
      const { data } = await sb.from("ajo_withdrawal_requests")
        .select("*")
        .eq("aso_client_id", client_id)
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

      await fetch("https://admin.kudiai.app/api/public/email-trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
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

    // ── Initialize a Paystack contribution payment (client self-pay) ─────
    if (action === "initialize-payment") {
      const { client_id, amount: requestedAmount } = body as { client_id: string; amount?: number };
      if (!client_id) return json({ error: "client_id required" }, 400);
      if (!PAYSTACK_SECRET) return json({ error: "Paystack not configured" }, 503);

      const { data: cl, error: clErr } = await sb
        .from("aso_clients")
        .select("id, email, contribution_amount, contribution_frequency, user_id, paystack_subaccount_code, full_name, next_contribution_date")
        .eq("id", client_id)
        .maybeSingle();

      if (clErr) return json({ error: `DB error fetching client: ${clErr.message}` }, 500);
      if (!cl) return json({ error: "Client not found" }, 404);
      if (!cl.email) {
        return json({ error: "Your account has no email address. Ask your savings agent to add one." }, 422);
      }

      const ownerId = cl.user_id;
      if (!ownerId) return json({ error: "Could not resolve business owner. Contact support." }, 422);

      // Use caller-supplied amount if valid, otherwise fall back to the client's default
      const amount = (requestedAmount && requestedAmount > 0)
        ? Number(requestedAmount)
        : Number(cl.contribution_amount);
      if (!amount || amount <= 0) return json({ error: "Enter an amount to contribute." }, 422);
      const ref            = genRef("AJO");
      // Each client has their own subaccount created at registration
      const subaccountCode = cl.paystack_subaccount_code ?? undefined;

      // Initialize transaction with Paystack
      const psRes = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: {
          Authorization:  `Bearer ${PAYSTACK_SECRET}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email:        cl.email,
          amount:       Math.round(amount * 100),
          reference:    ref,
          callback_url: "https://kudiai.app/",
          channels:     ["card", "bank", "ussd", "mobile_money", "bank_transfer"],
          subaccount:   subaccountCode,
          bearer:       subaccountCode ? "subaccount" : undefined,
          metadata: {
            client_id,
            owner_id:    ownerId,
            client_name: cl.full_name || "",
            type:        "ajo_contribution",
          },
        }),
      });

      const psData = await psRes.json();
      if (!psData.status || !psData.data?.access_code) {
        return json({ error: psData.message || "Failed to initialize payment" }, 422);
      }

      // Create a PENDING contribution record — confirmed by webhook
      const { error: insErr } = await sb.from("ajo_contributions").insert({
        aso_client_id:   client_id,
        owner_id:        ownerId,
        amount,
        type:            "contribution",
        payment_method:  "paystack",
        paystack_ref:    ref,
        paystack_status: "pending",
        initiated_by:    "client",
        status:          "pending",
        subaccount_code: subaccountCode || null,
        notes:           `Self-pay initiated by client · ref: ${ref}`,
      });
      if (insErr) return json({ error: `DB error: ${insErr.message}` }, 500);

      return json({
        access_code:       psData.data.access_code,
        authorization_url: psData.data.authorization_url,
        reference:         ref,
        amount,
        email:             cl.email,
        public_key:        PAYSTACK_PUBLIC,
        subaccount_code:   subaccountCode || null,
      });
    }

    // ── Confirm a Paystack contribution payment (client self-pay) ────────────
    if (action === "confirm-payment") {
      const { client_id, reference } = body as { client_id: string; reference: string };
      if (!client_id || !reference) return json({ error: "client_id and reference required" }, 400);
      if (!PAYSTACK_SECRET) return json({ error: "Paystack not configured" }, 503);

      // Verify the payment actually succeeded on Paystack's end
      const verRes = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
        { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, "Content-Type": "application/json" } },
      );
      const verData = await verRes.json();
      if (!verData.status || verData.data?.status !== "success") {
        return json({ error: "Payment not confirmed by Paystack" }, 422);
      }
      const paidAmount = Number(verData.data.amount) / 100; // kobo → naira

      // Find the pending contribution (created by initialize-payment)
      const { data: contrib } = await sb
        .from("ajo_contributions")
        .select("id, paystack_status")
        .eq("paystack_ref", reference)
        .eq("aso_client_id", client_id)
        .maybeSingle();

      // Idempotency: only update balance if not already processed by webhook
      if (contrib && contrib.paystack_status !== "success") {
        await sb.from("ajo_contributions").update({
          status:          "completed",
          paystack_status: "success",
        }).eq("id", contrib.id);

        const { data: cl } = await sb.from("aso_clients")
          .select("current_balance, total_saved, contribution_frequency, next_contribution_date, user_id, staff_id")
          .eq("id", client_id).maybeSingle();

        if (cl) {
          const freqDays: Record<string, number> = { daily: 1, weekly: 7, monthly: 30 };
          const days = freqDays[cl.contribution_frequency] || 30;
          const base = cl.next_contribution_date || new Date().toISOString().slice(0, 10);
          const nd = new Date(base);
          nd.setDate(nd.getDate() + days);
          await sb.from("aso_clients").update({
            current_balance:        (cl.current_balance || 0) + paidAmount,
            total_saved:            (cl.total_saved     || 0) + paidAmount,
            next_contribution_date: nd.toISOString().slice(0, 10),
          }).eq("id", client_id);

          // Resolve business name for the notification email
          let businessName = "";
          if (cl.user_id) {
            const { data: prof } = await sb.from("profiles").select("business_name").eq("id", cl.user_id).maybeSingle();
            businessName = prof?.business_name || "";
          }

          // Fire email notifications — non-blocking, never delays the response
          fetch("https://admin.kudiai.app/api/public/email-trigger", {
            method:  "POST",
            headers: {
              "Content-Type":     "application/json",
              "x-trigger-secret": EMAIL_TRIGGER_SECRET,
            },
            body: JSON.stringify({
              event: "ajo_contribution_paystack",
              data: {
                client_id,
                owner_id:      cl.user_id  || undefined,
                staff_id:      cl.staff_id || undefined,
                amount:        paidAmount,
                balance:       (cl.current_balance || 0) + paidAmount,
                date:          new Date().toLocaleDateString("en-NG"),
                business_name: businessName,
                paystack_ref:  reference,
              },
            }),
          }).catch(() => null);
        }
      }

      const { data: updatedClient } = await sb
        .from("aso_clients").select(CLIENT_SELECT).eq("id", client_id).maybeSingle();

      return json({ client: updatedClient, amount: paidAmount });
    }

    // ── Get Ajo groups for a business owner ───────────────────────────────
    if (action === "get-groups") {
      const { owner_id } = body as { owner_id: string };
      if (!owner_id) return json({ error: "owner_id required" }, 400);
      const { data } = await sb
        .from("ajo_groups")
        .select("*")
        .eq("owner_id", owner_id)
        .order("created_at", { ascending: true });
      return json({ groups: data || [] });
    }

    // ── Create an Ajo group (business portal) ─────────────────────────────
    if (action === "create-group") {
      const { owner_id, name, description, contribution_amount, contribution_frequency,
              bank_code, account_number, account_name } = body as {
        owner_id: string; name: string; description?: string;
        contribution_amount?: number; contribution_frequency?: string;
        bank_code?: string; account_number?: string; account_name?: string;
      };
      if (!owner_id || !name) return json({ error: "owner_id and name required" }, 400);

      const { data: grp, error: grpErr } = await sb.from("ajo_groups").insert({
        owner_id,
        name: name.trim(),
        description: description || null,
        contribution_amount: contribution_amount || null,
        contribution_frequency: contribution_frequency || "monthly",
        bank_code: bank_code || null,
        account_number: account_number || null,
        account_name: account_name || null,
      }).select().single();

      if (grpErr) return json({ error: grpErr.message }, 500);
      return json({ group: grp });
    }

    // ── Update an Ajo group (business portal) ─────────────────────────────
    if (action === "update-group") {
      const { group_id, owner_id, ...updates } = body as {
        group_id: string; owner_id: string;
        name?: string; description?: string;
        contribution_amount?: number; contribution_frequency?: string;
        bank_code?: string; account_number?: string; account_name?: string;
        paystack_subaccount_code?: string; paystack_subaccount_id?: string;
        is_active?: boolean;
      };
      if (!group_id || !owner_id) return json({ error: "group_id and owner_id required" }, 400);
      const { data: grp, error: grpErr } = await sb
        .from("ajo_groups")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", group_id)
        .eq("owner_id", owner_id)
        .select()
        .single();
      if (grpErr) return json({ error: grpErr.message }, 500);
      return json({ group: grp });
    }

    // ── Assign a client to an Ajo group ───────────────────────────────────
    if (action === "assign-group") {
      const { client_id, group_id, owner_id } = body as {
        client_id: string; group_id: string | null; owner_id: string;
      };
      if (!client_id || !owner_id) return json({ error: "client_id and owner_id required" }, 400);
      const { error: assignErr } = await sb
        .from("aso_clients")
        .update({ ajo_group_id: group_id })
        .eq("id", client_id)
        .eq("user_id", owner_id);
      if (assignErr) return json({ error: assignErr.message }, 500);
      return json({ success: true });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});
