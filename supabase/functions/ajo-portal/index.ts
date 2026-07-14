import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EMAIL_TRIGGER_SECRET = Deno.env.get("EMAIL_TRIGGER_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// High-value withdrawal threshold for 24h security hold after a PIN change.
// Withdrawals at or above this amount, submitted within 24h of a PIN reset, are
// auto-held for manual owner review. May become owner-configurable in a future release.
const HIGH_VALUE_HOLD_THRESHOLD = 50_000;

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
  registration_charge, withdrawal_fee_percent,
  nin, next_of_kin_name, next_of_kin_phone, next_of_kin_email, next_of_kin_address,
  portal_pin_changed_at, created_at,
  ajo_groups(name)
`;

function normalizeClient(client: Record<string, unknown> | null) {
  if (!client) return null;
  const grp = client.ajo_groups as { name?: string } | null;
  const out = { ...client, group_name: grp?.name ?? "" };
  delete out.ajo_groups;
  return out;
}

function genOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

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
    // ── Refresh client data by ID (session already validated) ─────
    if (action === "get-client") {
      const { client_id } = body as { client_id: string };
      const { data: clientRaw, error: clientErr } = await sb
        .from("aso_clients")
        .select(CLIENT_SELECT)
        .eq("id", client_id)
        .maybeSingle();
      // If the ajo_groups join fails (e.g. FK not yet in PostgREST schema cache),
      // retry without the join so ajo_group_id is still returned and the portal loads.
      let client: Record<string, unknown> | null = clientRaw as Record<string, unknown> | null;
      if (clientErr && !client) {
        const { data: fallback } = await sb
          .from("aso_clients")
          .select(CLIENT_SELECT.replace(/,?\s*ajo_groups\(name\)/, ""))
          .eq("id", client_id)
          .maybeSingle();
        client = fallback as Record<string, unknown> | null;
      }
      if (!client) return json({ error: "Client not found" }, 404);
      return json({ client: normalizeClient(client) });
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

    // ── Active cycle for card view ────────────────────────────────
    if (action === "get-active-cycle") {
      const { client_id } = body as { client_id: string };
      if (!client_id) return json({ error: "client_id required" }, 400);
      const { data: cycle } = await sb
        .from("ajo_cycles")
        .select("*")
        .eq("client_id", client_id)
        .eq("status", "active")
        .maybeSingle();
      return json({ cycle: cycle || null });
    }

    // ── Owner + assigned-staff info ───────────────────────────────
    if (action === "get-owner-info") {
      const { owner_id, client_id } = body as { owner_id: string; client_id: string };

      const [ownerRes, clientRes, invoiceRes] = await Promise.all([
        sb.from("profiles").select("business_name, full_name, phone, email, profile_image_url, bank_name, bank_account_number, bank_account_name").eq("id", owner_id).maybeSingle(),
        sb.from("aso_clients").select("staff_id, account_number, account_name, bank_name").eq("id", client_id).maybeSingle(),
        sb.from("invoice_settings").select("logo_url").eq("user_id", owner_id).maybeSingle(),
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

      const cd = clientRes.data;
      const clientBank = cd?.account_number
        ? { account_number: cd.account_number, account_name: cd.account_name, bank_name: cd.bank_name }
        : null;

      const ownerData = ownerRes.data
        ? { ...ownerRes.data, logo_url: invoiceRes.data?.logo_url || null }
        : null;

      return json({ owner: ownerData, staff: staffInfo, client_bank: clientBank });
    }

    // ── Client requests a withdrawal ─────────────────────────────
    if (action === "request-withdrawal") {
      const { client_id, owner_id, amount } = body as { client_id: string; owner_id: string; amount: number };
      if (!client_id || !amount || amount <= 0) return json({ error: "client_id and amount are required" }, 400);

      const { data: cl } = await sb.from("aso_clients")
        .select("full_name, email, user_id, current_balance, total_withdrawn, registration_charge, withdrawal_fee_percent, portal_pin_changed_at")
        .eq("id", client_id)
        .maybeSingle();

      if (!cl) return json({ error: "Client not found" }, 404);
      if (amount > (cl.current_balance || 0)) return json({ error: "Insufficient balance" }, 400);

      // 24h security hold: high-value withdrawals after a PIN reset get status "held_24h"
      const pinChangedAt = (cl as Record<string, unknown>).portal_pin_changed_at as string | null;
      const withinPinHold = pinChangedAt
        ? (Date.now() - new Date(pinChangedAt).getTime()) < 24 * 60 * 60 * 1000
        : false;
      const isHighValue = amount >= HIGH_VALUE_HOLD_THRESHOLD;

      // First withdrawal uses flat registration_charge; subsequent use withdrawal_fee_percent
      const isFirst    = (cl.total_withdrawn || 0) === 0;
      const feeType    = isFirst ? "registration_fee" : "withdrawal_fee";
      const feeAmount  = isFirst
        ? (cl.registration_charge || 0)
        : (amount * (cl.withdrawal_fee_percent || 0)) / 100;
      const netAmount  = amount - feeAmount;

      if (netAmount <= 0) return json({ error: "Amount too small after fee deduction" }, 400);

      const resolvedOwnerId = cl.user_id || owner_id;

      const withdrawalStatus = (withinPinHold && isHighValue) ? "held_24h" : "pending";

      const { data: request, error: reqErr } = await sb.from("ajo_withdrawal_requests").insert({
        aso_client_id: client_id,
        owner_id: resolvedOwnerId,
        amount,
        fee_type:   feeType,
        fee_amount: feeAmount,
        net_amount: netAmount,
        status:     withdrawalStatus,
      }).select().single();

      if (reqErr) return json({ error: "Couldn't process your request — please try again" }, 500);

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

    // ── Client submits a manual bank-transfer claim ───────────────
    if (action === "submit-manual-claim") {
      const { client_id, owner_id, amount, payer_name, notes, proof_url, contribution_context = "personal_savings" } = body as {
        client_id: string; owner_id: string; amount: number;
        payer_name?: string; notes?: string; proof_url?: string; contribution_context?: string;
      };

      if (!client_id || !owner_id) return json({ error: "client_id and owner_id required" }, 400);
      const numAmt = Number(amount);
      if (!numAmt || numAmt <= 0) return json({ error: "Amount must be greater than zero" }, 400);

      const { data: rpcResult } = await sb.rpc("ajo_submit_manual_claim", {
        p_client_id:             client_id,
        p_owner_id:              owner_id,
        p_amount:                numAmt,
        p_payer_name:            payer_name             || null,
        p_notes:                 notes                  || null,
        p_proof_url:             proof_url              || null,
        p_contribution_context:  contribution_context,
      });

      if (!rpcResult?.ok) return json({ error: rpcResult?.error || "Failed to submit claim" }, 400);

      // Notify owner — non-blocking
      const [cl, ownerProf] = await Promise.all([
        sb.from("aso_clients").select("full_name, email").eq("id", client_id).maybeSingle().then(r => r.data),
        sb.from("profiles").select("email, business_name").eq("id", owner_id).maybeSingle().then(r => r.data),
      ]);
      fetch("https://admin.kudiai.app/api/public/email-trigger", {
        method:  "POST",
        headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
        body: JSON.stringify({
          event: "ajo_manual_deposit_claimed",
          data: {
            client_name:   cl?.full_name     || "",
            client_email:  cl?.email         || "",
            owner_email:   ownerProf?.email  || "",
            business_name: ownerProf?.business_name || "",
            amount:        numAmt,
            payer_name:    payer_name || "",
            notes:         notes     || "",
            date:          new Date().toLocaleDateString("en-NG"),
          },
        }),
      }).catch(() => null);

      return json({ ok: true, claim_id: rpcResult.claim_id, amount: numAmt });
    }

    // ── Initialize a Paystack contribution payment (client self-pay) ─────
    if (action === "initialize-payment") {
      const { client_id, amount: requestedAmount, contribution_context = "personal_savings" } = body as {
        client_id: string; amount?: number; contribution_context?: string;
      };
      if (!client_id) return json({ error: "client_id required" }, 400);
      if (!PAYSTACK_SECRET) return json({ error: "Payments are temporarily unavailable — please try again later" }, 503);

      const { data: cl, error: clErr } = await sb
        .from("aso_clients")
        .select("id, email, contribution_amount, contribution_frequency, user_id, paystack_subaccount_code, full_name, next_contribution_date, ajo_group_id")
        .eq("id", client_id)
        .maybeSingle();

      if (clErr) return json({ error: "Something went wrong — please try again" }, 500);
      if (!cl) return json({ error: "Client not found" }, 404);
      if (!cl.email) {
        return json({ error: "Your account has no email address. Ask your savings agent to add one." }, 422);
      }

      const ownerId = cl.user_id;
      if (!ownerId) return json({ error: "We couldn't start your payment — please contact your savings agent" }, 422);

      const amount = (requestedAmount && requestedAmount > 0)
        ? Number(requestedAmount)
        : Number(cl.contribution_amount);
      if (!amount || amount <= 0) return json({ error: "Enter an amount to contribute." }, 422);
      const ref = genRef("AJO");

      // Route to group subaccount for group_savings / esusu_rotation;
      // fall back to the client's personal subaccount for personal_savings.
      let subaccountCode: string | undefined = cl.paystack_subaccount_code ?? undefined;
      if ((contribution_context === "group_savings" || contribution_context === "esusu_rotation") && cl.ajo_group_id) {
        const { data: grp } = await sb
          .from("ajo_groups")
          .select("paystack_subaccount_code")
          .eq("id", cl.ajo_group_id)
          .maybeSingle();
        if (grp?.paystack_subaccount_code) subaccountCode = grp.paystack_subaccount_code;
      }

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
            owner_id:             ownerId,
            client_name:          cl.full_name || "",
            type:                 "ajo_contribution",
            contribution_context,
          },
        }),
      });

      const psData = await psRes.json();
      if (!psData.status || !psData.data?.access_code) {
        return json({ error: "Payment couldn't be started — please try again" }, 422);
      }

      const { error: insErr } = await sb.from("ajo_contributions").insert({
        aso_client_id:        client_id,
        owner_id:             ownerId,
        amount,
        type:                 "contribution",
        payment_method:       "paystack",
        paystack_ref:         ref,
        paystack_status:      "pending",
        initiated_by:         "client",
        status:               "pending",
        subaccount_code:      subaccountCode || null,
        contribution_context,
        notes:                `Self-pay (${contribution_context}) initiated by client · ref: ${ref}`,
      });
      if (insErr) return json({ error: "Something went wrong — please try again" }, 500);

      return json({
        access_code:          psData.data.access_code,
        authorization_url:    psData.data.authorization_url,
        reference:            ref,
        amount,
        email:                cl.email,
        public_key:           PAYSTACK_PUBLIC,
        subaccount_code:      subaccountCode || null,
      });
    }

    // ── Confirm a Paystack contribution payment (client self-pay) ────────────
    if (action === "confirm-payment") {
      const { client_id, reference } = body as { client_id: string; reference: string };
      if (!client_id || !reference) return json({ error: "client_id and reference required" }, 400);
      if (!PAYSTACK_SECRET) return json({ error: "Payments are temporarily unavailable — please try again later" }, 503);

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
      const paidAt    = (verData.data.paid_at as string | undefined) || new Date().toISOString();
      const channel   = (verData.data.channel as string | undefined) || "card";

      // Route through the same atomic RPC used by the webhook.
      // ajo_confirm_payment uses SELECT FOR UPDATE WHERE status='pending',
      // eliminating the TOCTOU race between this path and the webhook path.
      // If the webhook already ran → returns {ok:false}, no double-credit.
      const { data: rpcResult } = await sb.rpc("ajo_confirm_payment", {
        p_paystack_ref: reference,
        p_paid_at:      paidAt,
        p_channel:      channel,
      });

      // Fire email only if this call actually credited the balance (webhook may have beaten us)
      if (rpcResult?.ok) {
        const { data: cl } = await sb.from("aso_clients")
          .select("full_name, email, current_balance, user_id, staff_id")
          .eq("id", client_id).maybeSingle();
        if (cl) {
          let businessName = "";
          if (cl.user_id) {
            const { data: prof } = await sb.from("profiles").select("business_name").eq("id", cl.user_id).maybeSingle();
            businessName = prof?.business_name || "";
          }
          await fetch("https://admin.kudiai.app/api/public/email-trigger", {
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
                balance:       cl.current_balance || 0,
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

    // ── Create an Ajo group (business portal) ─────────────────────────────
    if (action === "create-group") {
      const { owner_id, name, description, contribution_amount, contribution_frequency,
              bank_code, account_number, account_name,
              group_mode, privacy_show_names, privacy_show_amounts } = body as {
        owner_id: string; name: string; description?: string;
        contribution_amount?: number; contribution_frequency?: string;
        bank_code?: string; account_number?: string; account_name?: string;
        group_mode?: string; privacy_show_names?: boolean; privacy_show_amounts?: boolean;
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
        group_mode: group_mode || "savings",
        privacy_show_names:   privacy_show_names  !== false,
        privacy_show_amounts: privacy_show_amounts === true,
      }).select().single();

      if (grpErr) return json({ error: "Couldn't create the group — please try again" }, 500);
      return json({ group: grp });
    }

    // ── Get group rotation data (owner + member portal) ──────────────────
    if (action === "get-rotation") {
      const { group_id: grGroupId, client_id: grClientId } =
        body as { group_id?: string; client_id?: string };
      if (!grGroupId) return json({ error: "group_id required" }, 400);

      // Fetch group
      const { data: grGroup } = await sb.from("ajo_groups").select("*").eq("id", grGroupId).maybeSingle();
      if (!grGroup) return json({ error: "Group not found" }, 404);

      // If client_id provided, validate the client belongs to this group
      const isOwnerRequest = !grClientId;
      if (grClientId) {
        const { data: grCl } = await sb.from("aso_clients").select("ajo_group_id").eq("id", grClientId).maybeSingle();
        if (!grCl || grCl.ajo_group_id !== grGroupId) return json({ error: "Access denied" }, 403);
      }

      // Group members
      const { data: grMembers } = await sb.from("aso_clients")
        .select("id, full_name")
        .eq("ajo_group_id", grGroupId)
        .eq("status", "active");

      const showFull = isOwnerRequest || (grGroup.privacy_show_names !== false);

      const memberList = (grMembers || []).map((m: { id: string; full_name: string }) => ({
        id:           m.id,
        display_name: showFull
          ? m.full_name
          : (m.full_name || "").split(" ").map((w: string, i: number) => i === 0 ? w : w[0] + ".").join(" "),
      }));

      // Active round
      const { data: grRound } = await sb.from("ajo_group_rounds")
        .select("*")
        .eq("group_id", grGroupId)
        .eq("status", "active")
        .maybeSingle();

      let turns: unknown[] = [];
      let contribution_ticks: Record<string, boolean> = {};
      let pot_size = 0;

      if (grRound) {
        const { data: grTurns } = await sb.from("ajo_group_turns")
          .select("*")
          .eq("round_id", grRound.id)
          .order("position", { ascending: true });

        // Look up client names for turns
        const turnClientIds = [...new Set((grTurns || []).map((t: { client_id: string }) => t.client_id))];
        const { data: turnClients } = await sb.from("aso_clients").select("id, full_name").in("id", turnClientIds);
        const clientNameMap: Record<string, string> = {};
        (turnClients || []).forEach((c: { id: string; full_name: string }) => { clientNameMap[c.id] = c.full_name; });

        turns = (grTurns || []).map((t: Record<string, unknown>) => {
          const fullName = clientNameMap[t.client_id as string] || "";
          return {
            ...t,
            client_name: showFull
              ? fullName
              : fullName.split(" ").map((w: string, i: number) => i === 0 ? w : w[0] + ".").join(" "),
          };
        });

        // Pot + ticks from the current turn's period_start
        const currentTurn = (turns as Array<{ status: string; period_start?: string }>).find(t => t.status === "current");
        if (currentTurn?.period_start) {
          const memberIds = memberList.map((m: { id: string }) => m.id);
          if (memberIds.length > 0) {
            const { data: grContribs } = await sb.from("ajo_contributions")
              .select("aso_client_id, amount")
              .in("aso_client_id", memberIds)
              .eq("type", "contribution")
              .eq("status", "completed")
              .gte("created_at", currentTurn.period_start);

            pot_size = (grContribs || []).reduce(
              (s: number, c: { amount: number }) => s + Number(c.amount || 0), 0
            );
            const paidSet = new Set((grContribs || []).map((c: { aso_client_id: string }) => c.aso_client_id));
            for (const m of memberList) {
              contribution_ticks[m.id] = paidSet.has(m.id);
            }
          }
        }
      }

      // Pending Esusu debts for the active round (show to owner; member sees own only)
      let pending_debts: unknown[] = [];
      if (grRound) {
        const { data: dbDebts } = await sb
          .from("ajo_esusu_debts")
          .select("id, debtor_client_id, amount, created_at")
          .eq("round_id", grRound.id)
          .eq("status", "pending");

        if (isOwnerRequest) {
          pending_debts = dbDebts || [];
        } else if (grClientId) {
          pending_debts = (dbDebts || []).filter(
            (d: { debtor_client_id: string }) => d.debtor_client_id === grClientId
          );
        }
      }

      return json({ group: grGroup, round: grRound || null, turns, members: memberList, contribution_ticks, pot_size, pending_debts });
    }

    // ── Submit a dispute ticket for a contribution ────────────────────────
    if (action === "submit-dispute") {
      const { client_id, owner_id, contribution_id, description } = body as {
        client_id: string; owner_id: string; contribution_id: string; description?: string;
      };
      if (!client_id || !owner_id || !contribution_id) {
        return json({ error: "client_id, owner_id, and contribution_id are required" }, 400);
      }
      const { data: contrib } = await sb
        .from("ajo_contributions")
        .select("id, aso_client_id, amount, type, created_at, dispute_ticket_no")
        .eq("id", contribution_id)
        .eq("aso_client_id", client_id)
        .maybeSingle();
      if (!contrib) return json({ error: "Contribution not found" }, 404);
      if (contrib.dispute_ticket_no) return json({ ticket_no: contrib.dispute_ticket_no, existing: true });

      const { data: clientRow } = await sb
        .from("aso_clients").select("full_name, email").eq("id", client_id).maybeSingle();

      const entryDate = new Date(contrib.created_at).toLocaleDateString("en-NG");
      const detail = (description as string | undefined)?.trim()
        ? `Client reported: ${description}`
        : "Client reported an issue with this entry.";
      const fullDesc = `${detail}\n\nEntry ref: ${contribution_id}\nAmount: ₦${contrib.amount}\nType: ${contrib.type}\nDate: ${new Date(contrib.created_at).toLocaleString("en-NG")}`;

      const { data: ticket, error: ticketErr } = await sb
        .from("support_tickets")
        .insert({
          user_id:     null,
          user_email:  clientRow?.email ?? "",
          user_name:   clientRow?.full_name ?? "Ajo Client",
          subject:     `Ajo entry dispute — ${entryDate}`,
          description: fullDesc,
          type:        "ajo",
          priority:    "medium",
          status:      "open",
        })
        .select("ticket_no")
        .single();
      if (ticketErr) return json({ error: "Couldn't submit your dispute — please try again" }, 500);

      await sb.from("ajo_contributions")
        .update({ dispute_ticket_no: ticket.ticket_no })
        .eq("id", contribution_id);

      return json({ ticket_no: ticket.ticket_no });
    }

    // ── Savings goal: read ────────────────────────────────────────────────
    if (action === "get-goal") {
      const { client_id } = body as { client_id: string };
      if (!client_id) return json({ error: "client_id required" }, 400);
      const { data } = await sb
        .from("ajo_client_goals")
        .select("target_amount, label")
        .eq("aso_client_id", client_id)
        .maybeSingle();
      return json({ goal: data ? parseFloat(String(data.target_amount)) : 0, label: data?.label ?? "" });
    }

    // ── Savings goal: write ───────────────────────────────────────────────
    if (action === "set-goal") {
      const { client_id, target_amount, label } = body as {
        client_id: string; target_amount: number; label?: string;
      };
      if (!client_id || !target_amount || Number(target_amount) <= 0) {
        return json({ error: "client_id and target_amount > 0 required" }, 400);
      }
      const { error } = await sb.from("ajo_client_goals").upsert(
        { aso_client_id: client_id, target_amount: Number(target_amount), label: (label as string | undefined) ?? null, updated_at: new Date().toISOString() },
        { onConflict: "aso_client_id" },
      );
      if (error) return json({ error: "Couldn't update your goal — please try again" }, 500);
      return json({ ok: true });
    }

    // ── Savings goal: delete ──────────────────────────────────────────────
    if (action === "delete-goal") {
      const { client_id } = body as { client_id: string };
      if (!client_id) return json({ error: "client_id required" }, 400);
      await sb.from("ajo_client_goals").delete().eq("aso_client_id", client_id);
      return json({ ok: true });
    }

    // ── Transaction PIN ──────────────────────────────────────────────────────
    if (action === "get-txn-pin-status") {
      const { client_id } = body as { client_id: string };
      if (!client_id) return json({ error: "client_id required" }, 400);
      const { data: cl } = await sb.from("aso_clients").select("portal_pin").eq("id", client_id).maybeSingle();
      return json({ pin_set: !!cl?.portal_pin });
    }

    if (action === "set-txn-pin") {
      const { client_id, old_pin, new_pin } = body as { client_id: string; old_pin?: string | null; new_pin: string };
      if (!new_pin || !/^\d{4}$/.test(new_pin)) return json({ error: "PIN must be exactly 4 digits" }, 400);
      if (!client_id) return json({ error: "client_id required" }, 400);
      const { data: cl } = await sb.from("aso_clients").select("portal_pin").eq("id", client_id).maybeSingle();
      if (!cl) return json({ error: "Client not found" }, 404);
      if (cl.portal_pin) {
        if (!old_pin || String(old_pin).trim() !== cl.portal_pin) return json({ error: "Current PIN is incorrect" }, 401);
      }
      await sb.from("aso_clients").update({ portal_pin: new_pin, portal_pin_changed_at: new Date().toISOString() }).eq("id", client_id);
      return json({ success: true });
    }

    // ── Avatar upload (service-role bypasses storage RLS) ────────────────────
    if (action === "upload-avatar") {
      const { client_id, ext, base64, mime } = body as { client_id: string; ext: string; base64: string; mime: string };
      if (!client_id || !base64) return json({ error: "client_id and base64 required" }, 400);
      const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/jpg"];
      if (!ALLOWED_MIME.includes(mime)) return json({ error: "Invalid image type — use JPEG, PNG, or WebP" }, 400);
      const safeExt = (ext || "jpg").replace(/[^a-zA-Z0-9]/g, "").slice(0, 5);
      const path = `ajo/${client_id}/avatar.${safeExt}`;
      const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const { error: storageErr } = await sb.storage.from("avatars").upload(path, binary, { contentType: mime, upsert: true });
      if (storageErr) {
        console.error("[upload-avatar] storage error:", storageErr.message);
        return json({ error: storageErr.message }, 500);
      }
      const url = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/avatars/${path}?v=${Date.now()}`;
      return json({ url });
    }

    // ── Profile update (service-role so client RLS doesn't block) ────────────
    if (action === "update-profile") {
      const { client_id, fields } = body as { client_id: string; fields: Record<string, unknown> };
      if (!client_id || !fields) return json({ error: "client_id and fields required" }, 400);

      // Allowlist — clients may never touch balance, owner, PIN, or status fields
      const ALLOWED = new Set([
        "full_name", "phone", "address", "state", "lga", "ward", "nin",
        "next_of_kin_name", "next_of_kin_phone", "next_of_kin_email",
        "next_of_kin_address", "profile_image_url", "email",
        "bank_code", "bank_name", "account_number", "account_name",
      ]);
      const safePayload: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fields)) {
        if (ALLOWED.has(k)) safePayload[k] = v;
      }
      if (Object.keys(safePayload).length === 0) return json({ error: "No valid fields to update" }, 400);

      const { error: upErr } = await sb.from("aso_clients").update(safePayload).eq("id", client_id);
      if (upErr) {
        console.error("[update-profile] DB error:", upErr.message, "code:", upErr.code, "details:", upErr.details, "hint:", upErr.hint);
        return json({ error: upErr.message }, 500);
      }
      return json({ ok: true });
    }

    // ── Profile audit log ──────────────────────────────────────────────────
    if (action === "log-profile-update") {
      const { client_id, fields_changed } = body as { client_id: string; fields_changed?: string[] };
      if (!client_id) return json({ error: "client_id required" }, 400);

      await sb.from("aso_client_profile_logs").insert({
        client_id,
        changed_by: "client",
        fields_changed: fields_changed ?? [],
      });

      // Resolve owner to notify via email
      const { data: cl } = await sb.from("aso_clients")
        .select("full_name, email, user_id")
        .eq("id", client_id)
        .maybeSingle();
      if (cl) {
        const resolvedOwner = (cl as Record<string, unknown>).user_id as string | null;
        if (resolvedOwner) {
          const { data: owner } = await sb.from("profiles")
            .select("email, business_name").eq("id", resolvedOwner).maybeSingle();
          if (owner?.email) {
            await fetch("https://admin.kudiai.app/api/public/email-trigger", {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
              body: JSON.stringify({
                event: "ajo_profile_updated",
                data: {
                  client_id,
                  client_name:   (cl as Record<string, unknown>).full_name as string || "",
                  client_email:  (cl as Record<string, unknown>).email as string || "",
                  owner_email:   owner.email,
                  business_name: (owner as Record<string, unknown>).business_name as string || "",
                  fields_changed: (fields_changed ?? []).join(", "),
                  date: new Date().toLocaleDateString("en-NG"),
                },
              }),
            }).catch(() => null);
          }
        }
      }
      return json({ ok: true });
    }

    // ── Profile OTP: send ──────────────────────────────────────────────────
    if (action === "send-profile-otp") {
      const { client_id, field, new_value } = body as { client_id: string; field: string; new_value: string };
      if (!client_id || !field || !new_value) return json({ error: "client_id, field, new_value required" }, 400);

      const { data: cl } = await sb.from("aso_clients")
        .select("full_name, email").eq("id", client_id).maybeSingle();
      if (!cl) return json({ error: "Client not found" }, 404);

      const otp = genOtp();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min
      await sb.from("aso_clients").update({ pending_otp: otp, pending_otp_expires_at: expiresAt }).eq("id", client_id);

      // Send to new email for email changes; current email for phone changes
      const toEmail = field === "email" ? new_value : (cl as Record<string, unknown>).email as string;
      await fetch("https://admin.kudiai.app/api/public/email-trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
        body: JSON.stringify({
          event: "ajo_profile_otp",
          data: {
            name:    (cl as Record<string, unknown>).full_name as string || "",
            email:   toEmail,
            otp,
            field,
            expires_in: "10 minutes",
          },
        }),
      }).catch(() => null);

      return json({ ok: true });
    }

    // ── Profile OTP: verify and apply ─────────────────────────────────────
    if (action === "verify-profile-otp") {
      const { client_id, field, new_value, otp } = body as { client_id: string; field: string; new_value: string; otp: string };
      if (!client_id || !field || !new_value || !otp) return json({ error: "client_id, field, new_value, otp required" }, 400);

      const { data: cl } = await sb.from("aso_clients")
        .select("pending_otp, pending_otp_expires_at").eq("id", client_id).maybeSingle();
      if (!cl) return json({ error: "Client not found" }, 404);

      const storedOtp = (cl as Record<string, unknown>).pending_otp as string | null;
      const expiresAt = (cl as Record<string, unknown>).pending_otp_expires_at as string | null;
      if (!storedOtp || storedOtp !== otp) return json({ error: "Invalid OTP — check and try again" }, 401);
      if (!expiresAt || new Date(expiresAt) < new Date()) return json({ error: "OTP has expired — request a new one" }, 401);

      // Apply the field change and clear OTP
      const updatePayload: Record<string, string | null> = { pending_otp: null, pending_otp_expires_at: null };
      if (field === "email") updatePayload.email = new_value;
      if (field === "phone") updatePayload.phone = new_value;
      await sb.from("aso_clients").update(updatePayload).eq("id", client_id);

      return json({ ok: true });
    }

    // ── Transaction PIN OTP: send ──────────────────────────────────────────
    if (action === "send-txn-pin-otp") {
      const { client_id } = body as { client_id: string };
      if (!client_id) return json({ error: "client_id required" }, 400);

      const { data: cl } = await sb.from("aso_clients")
        .select("full_name, email").eq("id", client_id).maybeSingle();
      if (!cl) return json({ error: "Client not found" }, 404);

      const clEmail = (cl as Record<string, unknown>).email as string | null;
      if (!clEmail) return json({ error: "No email on file — contact your agent" }, 400);

      const otp = genOtp();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await sb.from("aso_clients").update({ pending_otp: otp, pending_otp_expires_at: expiresAt }).eq("id", client_id);

      await fetch("https://admin.kudiai.app/api/public/email-trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
        body: JSON.stringify({
          event: "ajo_txn_pin_otp",
          data: {
            name:    (cl as Record<string, unknown>).full_name as string || "",
            email:   clEmail,
            otp,
            expires_in: "10 minutes",
          },
        }),
      }).catch(() => null);

      return json({ ok: true });
    }

    // ── Transaction PIN OTP: verify ────────────────────────────────────────
    if (action === "verify-txn-pin-otp") {
      const { client_id, otp } = body as { client_id: string; otp: string };
      if (!client_id || !otp) return json({ error: "client_id and otp required" }, 400);

      const { data: cl } = await sb.from("aso_clients")
        .select("pending_otp, pending_otp_expires_at").eq("id", client_id).maybeSingle();
      if (!cl) return json({ error: "Client not found" }, 404);

      const storedOtp = (cl as Record<string, unknown>).pending_otp as string | null;
      const expiresAt = (cl as Record<string, unknown>).pending_otp_expires_at as string | null;
      if (!storedOtp || storedOtp !== otp) return json({ error: "Invalid OTP — check and try again" }, 401);
      if (!expiresAt || new Date(expiresAt) < new Date()) return json({ error: "OTP has expired — request a new one" }, 401);

      await sb.from("aso_clients").update({ pending_otp: null, pending_otp_expires_at: null }).eq("id", client_id);
      return json({ ok: true });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    console.error("[ajo-portal]", err);
    return json({ error: "Something went wrong — please try again" }, 500);
  }
});
