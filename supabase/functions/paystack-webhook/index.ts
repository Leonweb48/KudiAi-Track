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

  // ── 4. Find the pending contribution record ────────────────────────────
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

  // ── 5. Mark contribution as confirmed ────────────────────────────────
  await sb.from("ajo_contributions").update({
    paystack_status: "success",
    paid_at:         paidAt,
    payment_channel: channel,
    status:          "completed",
  }).eq("id", contrib.id);

  // ── 6. Update client balance + next contribution date ─────────────────
  const resolvedClientId = contrib.aso_client_id ?? clientId;
  if (resolvedClientId) {
    await updateClientBalance(sb, resolvedClientId, amountNgn);
  }

  // ── 7. Fire email notification ────────────────────────────────────────
  const resolvedOwnerId = contrib.owner_id ?? ownerId;
  if (resolvedClientId) {
    await fireContributionEmail(sb, resolvedClientId, resolvedOwnerId, amountNgn, reference, paidAt);
  }

  console.log(`[paystack-webhook] Processed charge.success: ref=${reference} amount=₦${amountNgn}`);
  return ok("processed");
});

// ── Helpers ──────────────────────────────────────────────────────────────────

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
        "x-trigger-secret": "kuditrack-email-trigger-2026-amaya",
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
        "x-trigger-secret": "kuditrack-email-trigger-2026-amaya",
      },
      body: JSON.stringify({ event: "ajo_contribution", data: emailData }),
    }).catch(() => null);
  } catch (e) {
    console.error("[paystack-webhook] Email notification failed:", e);
  }
}
