// Paystack webhook receiver — deployed with --no-verify-jwt
// Register this URL in your Paystack dashboard under Settings → Webhooks:
//   https://<project-ref>.supabase.co/functions/v1/paystack-webhook
//
// Handles charge.success to:
//   1. Verify HMAC-SHA512 signature (security)
//   2. Deduplicate via paystack_webhook_log (idempotency)
//   3. Update the pending ajo_contributions record to completed
//   4. Update client's current_balance, total_saved, next_contribution_date
//   5. Fire email notification

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac }   from "https://deno.land/std@0.168.0/node/crypto.ts";

const CORS = { "Access-Control-Allow-Origin": "*" };
const EMAIL_TRIGGER_SECRET = Deno.env.get("EMAIL_TRIGGER_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function ok(msg = "ok") {
  return new Response(msg, { status: 200, headers: CORS });
}
function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return err("Method not allowed", 405);

  const SECRET_KEY   = Deno.env.get("PAYSTACK_SECRET_KEY")       ?? "";
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")              ?? "";
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!SECRET_KEY) return err("Webhook not configured", 503);

  // ── 1. Read raw body for HMAC verification ────────────────────────────
  const rawBody = await req.text();

  // ── 2. Verify Paystack HMAC-SHA512 signature ──────────────────────────
  const signature = req.headers.get("x-paystack-signature") ?? "";
  const expected  = createHmac("sha512", SECRET_KEY).update(rawBody).digest("hex");
  if (signature !== expected) {
    console.warn(`[paystack-webhook] Bad signature: got=${signature.slice(0,16)}… expected=${expected.slice(0,16)}…`);
    return err("Invalid signature", 401);
  }

  let payload: Record<string, unknown>;
  try { payload = JSON.parse(rawBody); } catch { return err("Invalid JSON", 400); }

  const event      = payload.event as string;
  const data       = payload.data  as Record<string, unknown>;
  const reference  = (data.reference ?? "") as string;
  const amountKobo = Number(data.amount ?? 0);
  const amountNgn  = amountKobo / 100;
  const meta       = (data.metadata ?? {}) as Record<string, unknown>;

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // ── Handle failed / disrupted charges ────────────────────────────────
  if (event === "charge.failed") {
    const customer   = (data.customer ?? {}) as Record<string, unknown>;
    const userEmail  = customer.email as string | undefined;
    const metaFields = (meta.custom_fields ?? []) as Array<Record<string, string>>;
    const planField  = metaFields.find(f => f.variable_name === "plan");
    const planName   = planField?.value || "";
    if (userEmail) {
      await firePaymentFailureEmail(userEmail, planName, reference, amountNgn);
    }
    return ok("failure handled");
  }

  if (event !== "charge.success") return ok("ignored");

  const channel  = (data.channel ?? data.payment_channel ?? "card") as string;
  const paidAt   = (data.paid_at ?? data.created_at ?? new Date().toISOString()) as string;
  const clientId = meta.client_id as string | undefined;
  const ownerId  = meta.owner_id  as string | undefined;

  if (!reference) return err("Missing reference", 400);

  // ── 3. Idempotency — skip if already processed ────────────────────────
  const { data: existing } = await sb
    .from("paystack_webhook_log")
    .select("id")
    .eq("reference", reference)
    .maybeSingle();

  if (existing) {
    console.log(`[paystack-webhook] Already processed: ${reference}`);
    return ok("already processed");
  }

  // Log first so concurrent calls are deduplicated even if later steps fail
  await sb.from("paystack_webhook_log").insert({
    event,
    reference,
    payload,
  }).onConflict("reference").ignore();

  // ── Route by payment type ────────────────────────────────────────────────
  const paymentType = (meta.payment_type ?? "") as string;
  if (paymentType === "subscription") {
    await handleSubscriptionPayment(sb, meta, reference, paidAt);
    return ok("subscription processed");
  }

  if (paymentType === "bill") {
    await handleBillPayment(sb, reference, amountKobo, SUPABASE_URL, SERVICE_KEY);
    return ok("bill processed");
  }

  if (paymentType === "org_registration") {
    await handleOrgRegistrationPayment(sb, meta, paidAt);
    return ok("org registration processed");
  }

  // ── 4. Find the pending contribution record (Ajo) ────────────────────────
  const { data: contrib, error: contribErr } = await sb
    .from("ajo_contributions")
    .select("id, aso_client_id, owner_id, amount, paystack_status")
    .eq("paystack_ref", reference)
    .maybeSingle();

  if (contribErr) {
    console.error(`[paystack-webhook] Error fetching contribution: ${contribErr.message}`);
    return ok("db error logged");
  }

  if (!contrib) {
    // Contribution record not found — this can happen when the record was created
    // before our pending flow (e.g. older cash records). Log and move on.
    console.warn(`[paystack-webhook] No contribution found for ref: ${reference}`);
    // If metadata has client_id, try to create the record
    if (clientId && ownerId) {
      await recordNewContribution(sb, clientId, ownerId, amountNgn, reference, channel, paidAt);
    }
    return ok("no record — attempted fallback");
  }

  if (contrib.paystack_status === "success") {
    return ok("already confirmed");
  }

  // ── 5 & 6. Atomic confirmation via RPC (flips status + updates balance) ──
  // ajo_confirm_payment is SECURITY DEFINER — service role can call it.
  // It locks on the pending row then updates aso_clients in one transaction.
  const { error: rpcErr } = await sb.rpc("ajo_confirm_payment", {
    p_paystack_ref: reference,
    p_paid_at:      paidAt,
    p_channel:      channel,
  });
  if (rpcErr) {
    console.error(`[paystack-webhook] ajo_confirm_payment failed: ${rpcErr.message}`);
    return ok("rpc error logged");
  }

  const resolvedClientId = contrib.aso_client_id ?? clientId;

  // ── 7. Fire email notification ────────────────────────────────────────
  const resolvedOwnerId = contrib.owner_id ?? ownerId;
  if (resolvedClientId) {
    await fireContributionEmail(sb, resolvedClientId, resolvedOwnerId, amountNgn, reference, paidAt);
  }

  console.log(`[paystack-webhook] Processed charge.success: ref=${reference} amount=₦${amountNgn}`);
  return ok("processed");
});

// ── Helpers ──────────────────────────────────────────────────────────────────

// ── Bill payment: fulfill via ClubKonnect if the user never returned to the app ──
async function handleBillPayment(
  sb: ReturnType<typeof createClient>,
  reference: string,
  amountKobo: number,
  supabaseUrl: string,
  serviceKey: string,
) {
  const amountNgn = amountKobo / 100;

  // Look up the pending_bills record written by the client at init time.
  const { data: pb } = await sb
    .from("pending_bills")
    .select("*")
    .eq("reference", reference)
    .maybeSingle();

  if (!pb) {
    console.warn(`[webhook/bill] No pending_bills record for ref ${reference} — client must fulfill on return`);
    return;
  }
  if (pb.status !== "pending") {
    console.log(`[webhook/bill] Already processed (status=${pb.status}): ${reference}`);
    return;
  }

  // Optimistic lock — prevents concurrent webhook invocations from double-fulfilling.
  const { error: lockErr } = await sb
    .from("pending_bills")
    .update({ status: "processing" })
    .eq("reference", reference)
    .eq("status", "pending");
  if (lockErr) {
    console.error(`[webhook/bill] Lock failed for ${reference}:`, lockErr.message);
    return;
  }

  const cat      = pb.cat as string;
  const formData = (pb.form_data ?? {}) as Record<string, string>;

  try {
    // Call the ClubKonnect edge function using the service role key (bypasses user JWT check).
    const ckResp = await fetch(`${supabaseUrl}/functions/v1/clubkonnect`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: cat, ...formData }),
    });
    const ck = await ckResp.json() as Record<string, unknown>;

    if (ck?.error) throw new Error(String(ck.error));

    // Construct the fulfillment result in the same shape fulfillAfterPayment uses
    // so the client can display it when the user eventually opens the app.
    const apiRef      = String(ck.reference ?? "");
    const elecToken   = String(ck.token ?? ck.metertoken ?? ck.meter_token ?? ck.electricity_token ?? "");
    const elecUnits   = String(ck.units ?? ck.unit ?? ck.kwh ?? "");
    const elecOrderId = String(ck.reference ?? "");
    const cardDetails = String(ck.cardDetails ?? "");
    const pinsArr     = Array.isArray(ck.pins)
      ? (ck.pins as Record<string, unknown>[]).map(p => ({ ...p, network: formData.network ?? "" }))
      : [];

    // Build item label and note for the transaction record.
    let itemName = "", note = "";
    const phone = formData.phone ?? "";
    const network = formData.network ?? "";
    if (cat === "airtime")    { itemName = `${network} Airtime`; note = `Phone: ${phone} | Network: ${network}${apiRef ? ` | Ref: ${apiRef}` : ""}`; }
    else if (cat === "data")  { itemName = `${network} ${formData.planName ?? ""} Data`; note = `Phone: ${phone} | Network: ${network}${apiRef ? ` | Ref: ${apiRef}` : ""}`; }
    else if (cat === "cable") { itemName = `${formData.provider ?? ""} ${formData.packageName ?? ""}`; note = `Provider: ${formData.provider ?? ""} | Smartcard: ${formData.smartcard ?? ""}${apiRef ? ` | Ref: ${apiRef}` : ""}`; }
    else if (cat === "electricity") { itemName = `${formData.company ?? ""} Electric`; note = `Meter: ${formData.meterNo ?? ""}${elecToken ? ` | Token: ${elecToken}` : ""}${apiRef ? ` | Ref: ${apiRef}` : ""}`; }
    else if (cat === "betting")     { itemName = `${formData.company ?? ""} Wallet`; note = `Customer: ${formData.customerId ?? ""}${apiRef ? ` | Ref: ${apiRef}` : ""}`; }
    else { itemName = cat; note = `${cat}${apiRef ? ` | Ref: ${apiRef}` : ""}`; }

    const fulfillment = {
      ok:               true,
      label:            itemName,
      detail:           note,
      pinsArr,
      psRef:            reference,
      apiRef,
      cardDetails,
      cat,
      amount:           amountNgn,
      txnHistoryPending: false,
      elecToken,
      elecOrderId:      ck.status === "PENDING" ? elecOrderId : "",
      elecUnits,
      formSnap:         formData,
    };

    // Persist fulfillment result and record the transaction.
    await sb.from("pending_bills").update({
      status: "fulfilled",
      fulfillment,
      fulfilled_at: new Date().toISOString(),
    }).eq("reference", reference);

    await sb.from("transactions").insert({
      user_id:          pb.user_id,
      type:             "expense",
      category:         cat,
      amount:           amountNgn,
      item_name:        itemName,
      payment_type:     "paystack",
      note,
      transaction_date: new Date().toISOString().slice(0, 10),
      bill_status:      "completed",
      client_txn_id:    reference,
    }).onConflict("client_txn_id").ignore();

    console.log(`[webhook/bill] Fulfilled: ref=${reference} cat=${cat} amount=₦${amountNgn}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[webhook/bill] ClubKonnect failed for ${reference}: ${msg}`);
    await sb.from("pending_bills").update({
      status: "failed",
      fulfillment: { detail: msg },
    }).eq("reference", reference);
  }
}

async function updateClientBalance(
  sb: ReturnType<typeof createClient>,
  clientId: string,
  amount: number,
) {
  const { data: cl } = await sb
    .from("aso_clients")
    .select("current_balance, total_saved, contribution_frequency, next_contribution_date")
    .eq("id", clientId)
    .maybeSingle();
  if (!cl) return;

  const freqDays: Record<string, number> = { daily: 1, weekly: 7, monthly: 30 };
  const days = freqDays[cl.contribution_frequency] || 30;
  const base = cl.next_contribution_date || new Date().toISOString().slice(0, 10);
  const nd   = new Date(base);
  nd.setDate(nd.getDate() + days);

  await sb.from("aso_clients").update({
    current_balance:        (cl.current_balance || 0) + amount,
    total_saved:            (cl.total_saved     || 0) + amount,
    next_contribution_date: nd.toISOString().slice(0, 10),
  }).eq("id", clientId);
}

async function recordNewContribution(
  sb: ReturnType<typeof createClient>,
  clientId: string,
  ownerId: string,
  amount: number,
  reference: string,
  channel: string,
  paidAt: string,
) {
  await sb.from("ajo_contributions").insert({
    aso_client_id:   clientId,
    owner_id:        ownerId,
    amount,
    type:            "contribution",
    payment_method:  "paystack",
    paystack_ref:    reference,
    paystack_status: "success",
    payment_channel: channel,
    paid_at:         paidAt,
    status:          "completed",
    initiated_by:    "client",
    notes:           `Self-pay via Paystack · ref: ${reference}`,
  });
  await updateClientBalance(sb, clientId, amount);
}

async function firePaymentFailureEmail(
  userEmail: string,
  planName: string,
  reference: string,
  amount: number,
) {
  try {
    await fetch("https://admin.kudiai.app/api/public/email-trigger", {
      method:  "POST",
      headers: {
        "Content-Type":     "application/json",
        "x-trigger-secret": EMAIL_TRIGGER_SECRET,
      },
      body: JSON.stringify({
        event: "payment_failed",
        data: { user_email: userEmail, plan_name: planName, amount, reference },
      }),
    }).catch(() => null);
  } catch (e) {
    console.error("[paystack-webhook] Payment failure email failed:", e);
  }
}

async function handleSubscriptionPayment(
  sb: ReturnType<typeof createClient>,
  meta: Record<string, unknown>,
  reference: string,
  paidAt: string,
) {
  const userId   = meta.user_id   as string | undefined;
  const planSlug = meta.plan_slug as string | undefined;
  const isYearly = !!(meta.yearly);

  if (!userId || !planSlug) {
    console.warn("[paystack-webhook] subscription missing user_id or plan_slug:", meta);
    return;
  }

  const expiresAt = new Date(
    Date.now() + (isYearly ? 365 : 30) * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: existing } = await sb
    .from("subscriptions")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    await sb.from("subscriptions").update({
      plan:               planSlug,
      status:             "active",
      paystack_reference: reference,
      expires_at:         expiresAt,
      billing_cycle:      isYearly ? "yearly" : "monthly",
    }).eq("id", existing.id);
  } else {
    await sb.from("subscriptions").insert({
      user_id:            userId,
      plan:               planSlug,
      status:             "active",
      paystack_reference: reference,
      expires_at:         expiresAt,
      billing_cycle:      isYearly ? "yearly" : "monthly",
    });
  }

  console.log(`[paystack-webhook] subscription activated: user=${userId} plan=${planSlug} ref=${reference}`);
}

async function handleOrgRegistrationPayment(
  sb: ReturnType<typeof createClient>,
  meta: Record<string, unknown>,
  paidAt: string,
) {
  const orgId = meta.org_id as string | undefined;
  if (!orgId) {
    console.warn("[paystack-webhook] org_registration missing org_id in metadata:", meta);
    return;
  }

  const { data: org, error } = await sb
    .from("organizations")
    .select("id, name, status, owner_id")
    .eq("id", orgId)
    .maybeSingle();

  if (error || !org) {
    console.warn(`[paystack-webhook] org_registration: org ${orgId} not found`);
    return;
  }

  if (org.status !== "pending_payment") {
    console.log(`[paystack-webhook] org_registration: org ${orgId} already active (idempotent skip)`);
    return;
  }

  await sb.from("organizations").update({
    status:                    "active",
    registration_fee_paid_at:  paidAt,
  }).eq("id", orgId).eq("status", "pending_payment");

  console.log(`[paystack-webhook] org_registration: activated org ${orgId} (${org.name})`);
}

async function fireContributionEmail(
  sb: ReturnType<typeof createClient>,
  clientId: string,
  ownerId: string | undefined,
  amount: number,
  reference: string,
  paidAt: string,
) {
  try {
    const { data: cl } = await sb
      .from("aso_clients")
      .select("full_name, email, current_balance, staff_id")
      .eq("id", clientId)
      .maybeSingle();
    if (!cl) return;

    const emailData: Record<string, unknown> = {
      client_id:   clientId,
      client_name: cl.full_name  || "",
      client_email: cl.email     || "",
      amount,
      balance:     cl.current_balance || 0,
      date:        new Date(paidAt).toLocaleDateString("en-NG"),
      paystack_ref: reference,
    };

    if (ownerId) {
      const { data: owner } = await sb
        .from("profiles")
        .select("email, business_name")
        .eq("id", ownerId)
        .maybeSingle();
      if (owner?.email)         emailData.owner_email    = owner.email;
      if (owner?.email)         emailData.user_email     = owner.email;
      if (owner?.business_name) emailData.business_name  = owner.business_name;
      emailData.owner_id = ownerId;
    }

    if (cl.staff_id) {
      const { data: staff } = await sb
        .from("staff")
        .select("email, full_name")
        .eq("id", cl.staff_id)
        .maybeSingle();
      if (staff?.email)     emailData.staff_email = staff.email;
      if (staff?.full_name) emailData.staff_name  = staff.full_name;
    }

    await fetch("https://admin.kudiai.app/api/public/email-trigger", {
      method:  "POST",
      headers: {
        "Content-Type":   "application/json",
        "x-trigger-secret": EMAIL_TRIGGER_SECRET,
      },
      body: JSON.stringify({ event: "ajo_contribution", data: emailData }),
    }).catch(() => null);
  } catch (e) {
    console.error("[paystack-webhook] Email notification failed:", e);
  }
}
