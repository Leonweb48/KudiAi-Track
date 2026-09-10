// Flutterwave webhook receiver — deployed with --no-verify-jwt
// Register in the Flutterwave dashboard (Settings → Webhooks):
//   https://<project-ref>.supabase.co/functions/v1/flutterwave-webhook
// Set the dashboard "secret hash" to the same value as FLW_WEBHOOK_SECRET_HASH.
//
// Handles:
//   charge.completed  (bank_transfer) → verify → credit the wallet (wallet_credit)
//   transfer.disburse                 → finalise a withdrawal
//   transfer.reversal                 → reverse a withdrawal (refund the wallet)
//   refund.completed                  → log only

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient }  from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac }    from "https://deno.land/std@0.168.0/node/crypto.ts";

const CORS = { "Access-Control-Allow-Origin": "*" };
const ok  = (m = "ok") => new Response(m, { status: 200, headers: CORS });
const bad = (m: string, s = 400) =>
  new Response(JSON.stringify({ error: m }), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const FLW_TOKEN_URL = "https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token";
const FLW_BASE      = Deno.env.get("FLW_BASE_URL") || "https://developersandbox-api.flutterwave.com";

let _tok = { value: "", exp: 0 };
async function flwToken(): Promise<string> {
  if (_tok.value && Date.now() < _tok.exp - 60_000) return _tok.value;
  const res = await fetch(FLW_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: Deno.env.get("FLW_CLIENT_ID") ?? "",
      client_secret: Deno.env.get("FLW_CLIENT_SECRET") ?? "",
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`FLW auth ${res.status}`);
  _tok = { value: j.access_token, exp: Date.now() + Number(j.expires_in || 600) * 1000 };
  return _tok.value;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return bad("Method not allowed", 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const SECRET_HASH  = Deno.env.get("FLW_WEBHOOK_SECRET_HASH") ?? "";
  if (!SECRET_HASH) return bad("Webhook not configured", 503);

  const rawBody = await req.text();

  // ── verify signature ──────────────────────────────────────────────────────
  const sig = req.headers.get("flutterwave-signature") ?? req.headers.get("verif-hash") ?? "";
  const hmac = createHmac("sha256", SECRET_HASH).update(rawBody).digest("base64");
  if (sig !== hmac && sig !== SECRET_HASH) {
    console.warn(`[flw-webhook] bad signature got=${sig.slice(0, 12)}…`);
    return bad("Invalid signature", 401);
  }

  let payload: Record<string, unknown>;
  try { payload = JSON.parse(rawBody); } catch { return bad("Invalid JSON", 400); }

  const type      = String(payload.type || "");
  const data      = (payload.data ?? {}) as Record<string, unknown>;
  const webhookId = String(payload.webhook_id || payload.id || `${type}-${data.id || Date.now()}`);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // ── idempotency ───────────────────────────────────────────────────────────
  const { data: seen } = await sb.from("wallet_webhook_log")
    .select("id").eq("flw_webhook_id", webhookId).maybeSingle();
  if (seen) return ok("already processed");
  await sb.from("wallet_webhook_log").upsert(
    { event: type, flw_webhook_id: webhookId, flw_reference: String(data.id || ""), payload },
    { onConflict: "flw_webhook_id", ignoreDuplicates: true },
  );

  try {
    // ═══ charge.completed → wallet top-up ═══════════════════════════════════
    if (type === "charge.completed") {
      const pm = (data.payment_method ?? {}) as Record<string, unknown>;
      if (String(pm.type || "") !== "bank_transfer") return ok("ignored (not a transfer)");

      const chargeId = String(data.id || "");
      // re-verify with Flutterwave before giving value
      let amountNaira = Number(data.amount || 0);
      let status = String(data.status || "");
      try {
        const token = await flwToken();
        const vr = await fetch(`${FLW_BASE}/charges/${chargeId}`, { headers: { Authorization: `Bearer ${token}` } });
        const vj = await vr.json().catch(() => ({}));
        if (vr.ok && vj?.data) { amountNaira = Number(vj.data.amount || amountNaira); status = String(vj.data.status || status); }
      } catch (e) { console.warn("[flw-webhook] verify failed, using payload:", (e as Error).message); }

      if (status !== "succeeded" && status !== "successful") return ok("ignored (not succeeded)");

      // resolve the wallet
      const custId = String((data.customer as Record<string, unknown>)?.id || "");
      const vaNo   = String((pm.bank_transfer as Record<string, unknown>)?.virtual_account_number || "");
      let wallet: Record<string, unknown> | null = null;
      if (custId) {
        const { data: w } = await sb.from("wallets").select("*").eq("flw_customer_id", custId).maybeSingle();
        wallet = w;
      }
      if (!wallet && vaNo) {
        const { data: w } = await sb.from("wallets").select("*").eq("flw_account_number", vaNo).maybeSingle();
        wallet = w;
      }
      if (!wallet) { console.warn(`[flw-webhook] no wallet for cust=${custId} va=${vaNo}`); return ok("no wallet"); }

      const amountKobo = Math.round(amountNaira * 100);

      // ── Is this a customer paying for a sale? Match a pending payment request
      //    for this wallet with the exact amount, still within its 30-min window.
      const { data: pr } = await sb.from("wallet_payment_requests")
        .select("id")
        .eq("wallet_id", wallet.id)
        .eq("status", "pending")
        .eq("amount_kobo", amountKobo)
        .gte("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (pr) {
        const { error: sErr } = await sb.rpc("wallet_record_sale", {
          p_request_id: pr.id,
          p_flw_charge_id: chargeId,
          p_amount_kobo: amountKobo,
        });
        if (sErr) { console.error("[flw-webhook] wallet_record_sale:", sErr.message); return bad("sale record failed", 500); }
        fetch(`${SUPABASE_URL}/functions/v1/notify-send`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({
            action: "notify", userId: wallet.user_id, type: "wallet_sale",
            title: "Payment received", body: `₦${amountNaira.toLocaleString()} received — recorded as a sale`,
            category: "finance", deepLink: { screen: "wallet" },
          }),
        }).catch(() => {});
        return ok("sale recorded");
      }

      const { data: cfg } = await sb.from("platform_config").select("value").eq("key", "wallet_max_balance_kobo").maybeSingle();
      const maxBal = Number(cfg?.value || "20000000");
      if (Number(wallet.balance_kobo || 0) + amountKobo > maxBal) {
        await sb.from("admin_notifications").insert({
          type: "warning", category: "finance", target_roles: ["finance_admin", "super_admin"],
          title: "Wallet top-up over cap — not credited",
          message: `A ₦${amountNaira} top-up for wallet ${wallet.id} would exceed the ₦${maxBal / 100} cap. Held — not credited.`,
          metadata: { charge_id: chargeId, wallet_id: wallet.id },
        });
        return ok("over cap");
      }

      const { error } = await sb.rpc("wallet_credit", {
        p_user_id: wallet.user_id,
        p_amount_kobo: amountKobo,
        p_source: "topup",
        p_flw_reference: chargeId,
        p_narration: "Wallet top-up (bank transfer)",
        p_meta: { originator: (pm.bank_transfer as Record<string, unknown>)?.originator_name || null },
      });
      if (error) { console.error("[flw-webhook] wallet_credit:", error.message); return bad("credit failed", 500); }

      // notify the owner
      fetch(`${SUPABASE_URL}/functions/v1/notify-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({
          action: "notify", userId: wallet.user_id, type: "wallet_topup",
          title: "Wallet funded", body: `₦${amountNaira.toLocaleString()} added to your KudiAI wallet`,
          category: "finance", deepLink: { screen: "wallet" },
        }),
      }).catch(() => {});

      return ok("credited");
    }

    // ═══ transfer.disburse / transfer.reversal → withdrawal finalisers ══════
    if (type === "transfer.disburse" || type === "transfer.reversal") {
      const transferId = String(data.id || "");
      const ref = String(data.reference || "");   // = our wallet_withdrawals.id
      const st = type === "transfer.reversal"
        ? "reversed"
        : ["SUCCESSFUL", "successful", "COMPLETED"].includes(String(data.status || "")) ? "successful" : "failed";
      const { error } = await sb.rpc("wallet_mark_withdrawal", { p_flw_transfer_id: transferId, p_status: st, p_reference: ref });
      if (error) console.error("[flw-webhook] wallet_mark_withdrawal:", error.message);
      return ok(`withdrawal ${st}`);
    }

    if (type === "refund.completed") { console.log("[flw-webhook] refund.completed", data.id); return ok("logged"); }

    return ok(`ignored (${type})`);
  } catch (e) {
    console.error("[flw-webhook]", e);
    return bad("handler error", 500);
  }
});
