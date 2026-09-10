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
import nodemailer        from "npm:nodemailer@6";

const CORS = { "Access-Control-Allow-Origin": "*" };

// Branded wallet receipt — sent by KudiAI, not Flutterwave, so the owner has a
// record that shows "KudiAI Track · a product of Amaya & Co. Technologies".
const walletEmailHtml = (opts: { icon: string; accent: string; title: string; rows: [string, string][]; foot?: string }) => `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;background:#f8fafc;padding:16px;">
  <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#0F1D42 0%,#1B2A5E 100%);padding:22px;text-align:center;">
      <img src="https://kudiai.app/logo.png" width="46" style="display:block;margin:0 auto 10px;border-radius:9px;"/>
      <div style="color:#fff;font-size:18px;font-weight:900;">KudiAI Track</div>
      <div style="color:rgba(255,255,255,.45);font-size:9px;letter-spacing:2px;text-transform:uppercase;">Business Wallet</div>
    </div>
    <div style="background:${opts.accent};padding:16px;text-align:center;">
      <div style="font-size:24px;">${opts.icon}</div>
      <div style="color:#fff;font-size:17px;font-weight:800;margin-top:2px;">${opts.title}</div>
    </div>
    <div style="padding:22px 24px;background:#fff;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        ${opts.rows.map(([k, v]) => `<tr><td style="padding:7px 0;color:#64748b;">${k}</td><td style="padding:7px 0;text-align:right;font-weight:700;color:#1e293b;">${v}</td></tr>`).join("")}
      </table>
      ${opts.foot ? `<p style="margin:14px 0 0;color:#94a3b8;font-size:12px;">${opts.foot}</p>` : ""}
    </div>
    <div style="background:#f8fafc;padding:16px;text-align:center;border-top:1px solid #e2e8f0;">
      <p style="margin:0 0 3px;color:#94a3b8;font-size:11px;">A product of AMAYA &amp; Co. Technologies — &copy; ${new Date().getFullYear()}</p>
      <p style="margin:0;color:#cbd5e1;font-size:10px;">Automated message — please do not reply.</p>
    </div>
  </div>
</div>`;

// deno-lint-ignore no-explicit-any
async function sendWalletEmail(sb: any, to: string, subject: string, html: string) {
  if (!to) return;
  try {
    const { data: smtp } = await sb.from("smtp_config").select("*").limit(1).maybeSingle();
    if (!smtp) return;
    const transport = nodemailer.createTransport({
      host: smtp.host, port: smtp.port, secure: smtp.encryption === "ssl",
      auth: { user: smtp.username, pass: smtp.password },
    });
    await transport.sendMail({ from: `"${smtp.from_name || "KudiAI Track"}" <${smtp.from_email}>`, to, subject, html });
  } catch (e) { console.warn("[flw-webhook] email failed:", (e as Error).message); }
}

const fmtNgn = (kobo: number) => `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
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

      const { data: owner } = await sb.from("profiles").select("email, full_name, business_name").eq("id", wallet.user_id).maybeSingle();
      const originator = String((pm.bank_transfer as Record<string, unknown>)?.originator_name || "a customer");

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
        await sendWalletEmail(sb, owner?.email || "", `Payment received — ${fmtNgn(amountKobo)}`,
          walletEmailHtml({
            icon: "💰", accent: "#16a34a", title: "Payment received",
            rows: [["Amount", fmtNgn(amountKobo)], ["From", originator], ["Into", `${wallet.flw_account_number} · KudiAI wallet`],
                   ["Recorded as", "a sale in your books"], ["Reference", `KDT-${chargeId}`], ["Time", new Date().toLocaleString("en-NG")]],
            foot: "This payment was received through KudiAI Track and booked to your sales ledger.",
          }));
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
      await sendWalletEmail(sb, owner?.email || "", `Wallet funded — ${fmtNgn(amountKobo)}`,
        walletEmailHtml({
          icon: "⬆️", accent: "#2E8020", title: "Wallet funded",
          rows: [["Amount", fmtNgn(amountKobo)], ["From", originator], ["Wallet balance", fmtNgn(Number(wallet.balance_kobo || 0) + amountKobo)],
                 ["Reference", `KDT-${chargeId}`], ["Time", new Date().toLocaleString("en-NG")]],
          foot: "Your KudiAI wallet is ready to use for bills and transfers.",
        }));

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

      // stamp the bank name + NIP session id onto the row for the receipt.
      // Flutterwave puts the session id in a few different places depending on
      // the rail — take the first that looks right.
      const bankObj  = (data.bank ?? {}) as Record<string, unknown>;
      const metaObj  = (data.meta ?? {}) as Record<string, unknown>;
      const sessionId = String(
        data.session_id || data.nip_session_id || data.reference_number ||
        metaObj.session_id || metaObj.sessionId || metaObj.nip_session_id || "",
      ).trim();
      const bankNm = String(bankObj.name || "").trim();
      try {
        const patch: Record<string, string> = {};
        if (bankNm)    patch.bank_name  = bankNm;
        if (sessionId) patch.session_id = sessionId;
        if (Object.keys(patch).length) {
          await sb.from("wallet_withdrawals").update(patch)
            .or(`flw_transfer_id.eq.${transferId}${ref ? `,id.eq.${ref}` : ""}`);
        }
      } catch (e) { console.warn("[flw-webhook] wd meta patch:", (e as Error).message); }

      // branded receipt to the sender (the wallet owner)
      try {
        const { data: wd } = await sb.from("wallet_withdrawals")
          .select("user_id, amount_kobo, fee_kobo, account_name, account_number, bank_code")
          .or(`flw_transfer_id.eq.${transferId}${ref ? `,id.eq.${ref}` : ""}`).limit(1).maybeSingle();
        if (wd) {
          const { data: o } = await sb.from("profiles").select("email").eq("id", wd.user_id).maybeSingle();
          const bankName = bankNm || wd.bank_code;
          if (st === "successful") {
            await sendWalletEmail(sb, o?.email || "", `Transfer sent — ${fmtNgn(wd.amount_kobo)}`,
              walletEmailHtml({
                icon: "✅", accent: "#0F1D42", title: "Transfer completed",
                rows: [["Amount", fmtNgn(wd.amount_kobo)], ["To", wd.account_name || wd.account_number],
                       ["Account", `${wd.account_number} · ${bankName}`],
                       ...(wd.fee_kobo ? [["Fee", fmtNgn(wd.fee_kobo)] as [string, string]] : []),
                       ...(sessionId ? [["Session ID", sessionId] as [string, string]] : []),
                       ["Transaction No.", transferId],
                       ["Reference", `KDT-${transferId}`], ["Time", new Date().toLocaleString("en-NG")]],
                foot: "Sent from your KudiAI Track wallet. The recipient's bank will show \"KudiAI Track\" and this reference.",
              }));
          } else {
            await sendWalletEmail(sb, o?.email || "", `Transfer ${st} — ${fmtNgn(wd.amount_kobo)} returned`,
              walletEmailHtml({
                icon: "↩️", accent: "#b91c1c", title: `Transfer ${st}`,
                rows: [["Amount", fmtNgn(wd.amount_kobo)], ["To", wd.account_name || wd.account_number],
                       ["Status", "returned to your wallet"], ["Reference", `KDT-${transferId}`]],
                foot: "The bank could not complete this transfer, so the full amount is back in your wallet.",
              }));
          }
        }
      } catch (e) { console.warn("[flw-webhook] transfer email:", (e as Error).message); }

      return ok(`withdrawal ${st}`);
    }

    if (type === "refund.completed") { console.log("[flw-webhook] refund.completed", data.id); return ok("logged"); }

    return ok(`ignored (${type})`);
  } catch (e) {
    console.error("[flw-webhook]", e);
    return bad("handler error", 500);
  }
});
