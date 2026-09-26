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
import { bankEmail, esc, cleanSubject, nairaFromKobo, appLink, htmlToText } from "../_shared/bankEmail.ts";
import { loadAccounts, identifySigner, resolveActive, graceStatus, type FlwAccount, type AccountKey } from "../_shared/flwAccounts.ts";

const CORS = { "Access-Control-Allow-Origin": "*" };

// Wallet emails use the shared bank-grade layout (see _shared/bankEmail.ts): stored
// transaction reference, WAT timestamp, balance after, View Transaction button and
// the security notice. Sent by KudiAI, not Flutterwave, so the owner has a record
// that shows "KudiAI Track · a product of Amaya & Co. Technologies".
//
// Every value that came from a user, a bank or a database row is passed through
// esc() before it reaches the layout — the payer's name on a bank transfer is
// chosen by the payer.

// The email is BUILT inside the try as well: a template problem must never get in
// the way of crediting a wallet or finalising a transfer.
// deno-lint-ignore no-explicit-any
async function sendWalletEmail(sb: any, to: string, subject: string, build: () => string) {
  if (!to) return;
  try {
    const html = build();
    const { data: smtp } = await sb.from("smtp_config").select("*").limit(1).maybeSingle();
    if (!smtp) return;
    const transport = nodemailer.createTransport({
      host: smtp.host, port: smtp.port, secure: smtp.encryption === "ssl",
      auth: { user: smtp.username, pass: smtp.password },
    });
    await transport.sendMail({ from: `"${smtp.from_name || "KudiAI Track"}" <${smtp.from_email}>`, to, subject: cleanSubject(subject), html, text: htmlToText(html) });
  } catch (e) { console.warn("[flw-webhook] email failed:", (e as Error).message); }
}

// The stored facts about a ledger row — its database-issued reference, running
// balance and server timestamp — so the email matches the receipt in the app.
type LedgerFacts = { receipt_ref: string | null; balance_after_kobo: number | null; created_at: string | null };
// deno-lint-ignore no-explicit-any
async function ledgerFacts(sb: any, ledgerId?: string | null): Promise<LedgerFacts | null> {
  if (!ledgerId) return null;
  try {
    const { data } = await sb.from("wallet_ledger").select("receipt_ref, balance_after_kobo, created_at").eq("id", ledgerId).maybeSingle();
    return (data as LedgerFacts | null) ?? null;
  } catch { return null; }
}

async function sendSms(phone: string | null | undefined, message: string, opts: {
  category?: string; user_id?: string | null; related_type?: string; related_id?: string;
} = {}): Promise<void> {
  if (!phone) return;
  try {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/sms-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
      body: JSON.stringify({
        action: "send", phone, message,
        category: opts.category ?? "money",
        user_id: opts.user_id ?? null,
        related_type: opts.related_type ?? null,
        related_id: opts.related_id ?? null,
      }),
    });
  } catch { /* fire and forget */ }
}

// A wallet's user_id can belong to a business owner (profiles), an Ajo/Esusu
// client, or a staff/manager (neither of the latter two ever get a profiles
// row — see resolveIdentity() in flutterwave/index.ts, the same discriminator
// used here). profiles-only lookups were silently sending zero deposit/
// withdrawal emails to client and staff wallets, since sendWalletEmail()
// no-ops on an empty `to`.
// deno-lint-ignore no-explicit-any
async function resolveContact(sb: any, userId: string): Promise<{ email: string; phone: string; name: string }> {
  const { data: profile } = await sb.from("profiles").select("email, phone, business_name, owner_name").eq("id", userId).maybeSingle();
  if (profile?.email || profile?.phone) return { email: profile?.email || "", phone: profile?.phone || "", name: profile?.business_name || profile?.owner_name || "" };
  const { data: client } = await sb.from("aso_clients").select("email, phone, full_name").eq("client_user_id", userId).maybeSingle();
  if (client?.email || client?.phone) return { email: client?.email || "", phone: client?.phone || "", name: client?.full_name || "" };
  const { data: staff } = await sb.from("staff").select("email, phone, full_name").eq("user_id", userId).maybeSingle();
  return { email: staff?.email || "", phone: staff?.phone || "", name: staff?.full_name || "" };
}

const fmtNgn = (kobo: number) => `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
const ok  = (m = "ok") => new Response(m, { status: 200, headers: CORS });
const bad = (m: string, s = 400) =>
  new Response(JSON.stringify({ error: m }), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const FLW_TOKEN_URL = "https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token";

// Two Flutterwave accounts can send us webhooks (see _shared/flwAccounts.ts): the original "legacy" account and
// the business account the platform is moving to. Which one signed an event decides which credentials verify it
// and which wallets it can credit.
const ACCOUNTS = loadAccounts((k) => Deno.env.get(k));

const _toks: Partial<Record<AccountKey, { value: string; exp: number }>> = {};
async function flwToken(acct: FlwAccount): Promise<string> {
  const cached = _toks[acct.key];
  if (cached && cached.value && Date.now() < cached.exp - 60_000) return cached.value;
  const res = await fetch(FLW_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: acct.clientId,
      client_secret: acct.clientSecret,
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`FLW auth (${acct.key}) ${res.status}`);
  _toks[acct.key] = { value: j.access_token, exp: Date.now() + Number(j.expires_in || 600) * 1000 };
  return j.access_token as string;
}

// Find the wallet an event is for, given the customer id / virtual account number on it.
//  • the wallet's CURRENT number counts only when the wallet lives on the account that signed the event;
//  • a legacy event also matches the PREVIOUS number of a wallet that has since moved to the business account
//    (deposits made to the old number during the grace period must still credit the right wallet).
// Values come from a signed webhook, but are still reduced to id-safe characters before going into a filter.
// deno-lint-ignore no-explicit-any
async function findWallet(sb: any, source: AccountKey, custId: string, vaNo: string): Promise<Record<string, unknown> | null> {
  const safe = (s: string) => String(s || "").replace(/[^A-Za-z0-9_-]/g, "");
  const c = safe(custId), v = safe(vaNo);
  const parts: string[] = [];
  if (c) parts.push(`and(flw_account.eq.${source},flw_customer_id.eq.${c})`);
  if (v) parts.push(`and(flw_account.eq.${source},flw_account_number.eq.${v})`);
  if (source === "legacy") {
    if (c) parts.push(`legacy_flw_customer_id.eq.${c}`);
    if (v) parts.push(`legacy_flw_account_number.eq.${v}`);
  }
  if (!parts.length) return null;
  const { data } = await sb.from("wallets").select("*").or(parts.join(",")).limit(2);
  if (!data || !data.length) return null;
  if (data.length > 1) console.warn(`[flw-webhook] ${data.length} wallets match cust=${c} va=${v} on ${source} — using the first`);
  return data[0] as Record<string, unknown>;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return bad("Method not allowed", 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!ACCOUNTS.legacy.webhookHash && !ACCOUNTS.business.webhookHash) return bad("Webhook not configured", 503);

  const rawBody = await req.text();

  // ── verify signature — against each configured account's secret hash. The one that matches tells us which
  //    Flutterwave account this event came from. ─────────────────────────────────────────────────────────────
  const sig = req.headers.get("flutterwave-signature") ?? req.headers.get("verif-hash") ?? "";
  const source = identifySigner(sig, rawBody, ACCOUNTS, (secret, body) => createHmac("sha256", secret).update(body).digest("base64"));
  if (!source) {
    console.warn(`[flw-webhook] bad signature got=${sig.slice(0, 12)}…`);
    return bad("Invalid signature", 401);
  }
  const srcAcct = ACCOUNTS[source];

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
        // verify with the credentials of the account that SIGNED the event — a charge id only exists on its own account
        const token = await flwToken(srcAcct);
        const vr = await fetch(`${srcAcct.base}/charges/${chargeId}`, { headers: { Authorization: `Bearer ${token}` } });
        const vj = await vr.json().catch(() => ({}));
        if (vr.ok && vj?.data) {
          amountNaira = Number(vj.data.amount || amountNaira);
          status = String(vj.data.status || status);
        }
      } catch (e) { console.warn("[flw-webhook] verify failed, using payload:", (e as Error).message); }

      if (status !== "succeeded" && status !== "successful") return ok("ignored (not succeeded)");

      const amountKobo = Math.round(amountNaira * 100);

      // Deposits are always fee-free (wallet_credit, source 'topup', credits the
      // full gross amount unconditionally) — no levy estimate needed here.
      const netAmountKobo = amountKobo;

      // ── Is this a one-time bill payment (charge-bill), not a wallet top-up?
      //    Check first — a bill charge's dynamic VA isn't tied to any wallet, so
      //    it would otherwise fall through to "no wallet" and never fulfil. ──
      const billRef = String(data.reference || "").replace(/^kdtb-/, "");
      if (billRef) {
        const { data: pb } = await sb.from("pending_bills").select("id").eq("reference", billRef).maybeSingle();
        if (pb) {
          await handleBillPaymentFlw(sb, billRef, amountKobo, SUPABASE_URL, SERVICE_KEY);
          return ok("bill processed");
        }
      }

      // resolve the wallet
      const custId = String((data.customer as Record<string, unknown>)?.id || "");
      const vaNo   = String((pm.bank_transfer as Record<string, unknown>)?.virtual_account_number || "");
      const wallet = await findWallet(sb, source, custId, vaNo);
      if (!wallet) { console.warn(`[flw-webhook] no wallet for cust=${custId} va=${vaNo} (${source})`); return ok("no wallet"); }

      // ── Legacy account past its grace deadline: money still arrives on a number we told the customer to stop
      //    using. Don't credit it automatically (the funds are sitting on the OLD account and the wallet float is
      //    backed by the new one) — park it for a person. The full event is already in wallet_webhook_log, and
      //    extending platform_config.flw_legacy_grace_until re-opens the window if this needs to be honoured. ──
      if (source === "legacy") {
        const { data: cfgRows } = await sb.from("platform_config").select("key,value")
          .in("key", ["flw_active_account", "flw_legacy_grace_until"]);
        const cv = (k: string) => (cfgRows ?? []).find((r: { key: string }) => r.key === k)?.value as string | undefined;
        const active = resolveActive(ACCOUNTS, cv("flw_active_account"), (m) => console.warn(`[flw-webhook] ${m}`));
        if (graceStatus(active.key, cv("flw_legacy_grace_until")).retired) {
          console.warn(`[flw-webhook] legacy deposit after the grace deadline — held. charge=${chargeId} wallet=${wallet.id}`);
          await sb.from("admin_notifications").insert({
            type: "warning", category: "finance", target_roles: ["finance_admin", "super_admin"],
            title: "Deposit on the old Flutterwave account — NOT credited",
            message: `₦${amountNaira.toLocaleString("en-NG")} arrived on retired virtual account ${vaNo || "(unknown)"} for wallet ${wallet.id}. `
              + `The money is on the old Flutterwave account. It was not credited automatically — move the funds to the business account `
              + `and credit the wallet by hand, or extend flw_legacy_grace_until to accept it.`,
            metadata: { charge_id: chargeId, wallet_id: wallet.id, virtual_account: vaNo, amount_kobo: amountKobo, account: "legacy" },
          });
          return ok("legacy account retired — held for review");
        }
      }

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

      const owner = await resolveContact(sb, wallet.user_id as string);
      const originator = String((pm.bank_transfer as Record<string, unknown>)?.originator_name || "a customer");
      // The SENDER's bank, as the bank reports it ("WEMA BANK PLC"). Kept on the ledger row so the receipt can name that bank
      // and show its logo — the app cleans the spelling up when it shows it.
      const originatorBank = String((pm.bank_transfer as Record<string, unknown>)?.originator_bank_name || "").trim().slice(0, 80);

      if (pr) {
        const { data: saleRes, error: sErr } = await sb.rpc("wallet_record_sale", {
          p_request_id: pr.id,
          p_flw_charge_id: chargeId,
          p_amount_kobo: amountKobo,
        });
        if (sErr) { console.error("[flw-webhook] wallet_record_sale:", sErr.message); return bad("sale record failed", 500); }
        const saleLedgerId = (saleRes as { ledger_id?: string } | null)?.ledger_id;
        // wallet_record_sale has no meta argument, so stamp who paid (name + bank) onto its ledger row afterwards. The sale is
        // already recorded by now — a failure here only costs the receipt its sender-bank line.
        if (saleLedgerId && (originatorBank || originator !== "a customer")) {
          try {
            const { data: lr } = await sb.from("wallet_ledger").select("meta").eq("id", saleLedgerId).maybeSingle();
            const prev = ((lr?.meta ?? {}) as Record<string, unknown>);
            const stamp: Record<string, unknown> = {};
            if (originatorBank && !prev.originator_bank) stamp.originator_bank = originatorBank;
            if (originator !== "a customer" && !prev.originator) stamp.originator = originator;
            if (Object.keys(stamp).length) await sb.from("wallet_ledger").update({ meta: { ...prev, ...stamp } }).eq("id", saleLedgerId);
          } catch (e) { console.warn("[flw-webhook] sale meta stamp:", (e as Error).message); }
        }
        const saleFacts = await ledgerFacts(sb, saleLedgerId);
        // Awaited — same reason as the topup path below: the function returns
        // (and the Deno isolate can be torn down) right after sendWalletEmail
        // resolves, which was silently dropping this un-awaited fetch before
        // it ever reached notify-send. Email always arrived because it was
        // already awaited; the in-app bell/push never did.
        await fetch(`${SUPABASE_URL}/functions/v1/notify-send`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({
            action: "notify", userId: wallet.user_id, type: "wallet_sale",
            title: "Payment received", body: `₦${amountNaira.toLocaleString()} received — recorded as a sale`,
            category: "money", priority: "high", deepLink: { tab: "wallet", openWallet: true },
          }),
        }).catch(() => {});
        await sendWalletEmail(sb, owner.email, `Payment received — ${fmtNgn(amountKobo)}`, () =>
          bankEmail({
            title: "Payment Received", tone: "success",
            timestamp: saleFacts?.created_at,
            amount: nairaFromKobo(amountKobo), amountLabel: "Amount Received",
            preheader: `${nairaFromKobo(amountKobo)} received from ${esc(originator)}`,
            intro: "This payment was received through KudiAI Track and booked to your sales ledger.",
            rows: [
              ["Transaction Reference", saleFacts?.receipt_ref ? esc(saleFacts.receipt_ref) : "", { mono: true }],
              ["Payment Method", "Bank transfer"],
              ["From", esc(originator)],
              ["Into", `${esc(vaNo || wallet.flw_account_number)} · KudiAI Wallet`],
              ["Recorded as", "A sale in your books"],
              ["Transaction No.", esc(chargeId), { mono: true }],
              ["Business", owner.name ? esc(owner.name) : ""],
              ["Balance After", saleFacts?.balance_after_kobo != null ? nairaFromKobo(saleFacts.balance_after_kobo) : ""],
            ],
            button: { label: "View Transaction →", url: appLink({ tab: "wallet" }) },
          }));
        return ok("sale recorded");
      }

      // The wallet's TIER sets the ceiling (wallet_tier{n}_max_balance_kobo; 0 = unlimited). If the tier lookup is ever
      // unavailable we fall back to the old global cap, so a slip can never remove the limit.
      let maxBal = -1;
      const { data: tierCap, error: tierCapErr } = await sb.rpc("wallet_tier_cfg", { p_user_id: wallet.user_id, p_metric: "max_balance" });
      if (!tierCapErr && tierCap !== null && tierCap !== undefined) maxBal = Number(tierCap);
      if (!Number.isFinite(maxBal) || maxBal < 0) {
        const { data: cfg } = await sb.from("platform_config").select("value").eq("key", "wallet_max_balance_kobo").maybeSingle();
        maxBal = Number(cfg?.value || "20000000");
      }
      const tierNo = Number(wallet.tier || 1);
      if (maxBal > 0 && Number(wallet.balance_kobo || 0) + netAmountKobo > maxBal) {
        await sb.from("admin_notifications").insert({
          type: "warning", category: "finance", target_roles: ["finance_admin", "super_admin"],
          title: "Wallet top-up over cap — not credited",
          message: `A ₦${amountNaira} top-up for wallet ${wallet.id} would exceed its Tier ${tierNo} maximum balance of ₦${maxBal / 100}. Held — not credited.`,
          metadata: { charge_id: chargeId, wallet_id: wallet.id, tier: tierNo },
        });
        // tell the holder — otherwise money has arrived at the bank and nothing in the app says why it isn't in the wallet
        await fetch(`${SUPABASE_URL}/functions/v1/notify-send`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({
            action: "notify", userId: wallet.user_id, type: "wallet_deposit_held",
            title: "Deposit on hold",
            body: `₦${amountNaira.toLocaleString()} could not be added — it would take your wallet above the Tier ${tierNo} maximum balance of ₦${(maxBal / 100).toLocaleString()}. Upgrade your tier or contact support.`,
            category: "money", priority: "high", deepLink: { tab: "wallet", openWallet: true },
          }),
        }).catch(() => {});
        return ok("over cap");
      }

      // wallet_credit takes the GROSS amount for source='topup' and splits the
      // CBN levy internally (crediting it to the platform settlement wallet in
      // the same transaction) — pass the full received amount, not our estimate.
      const { data: creditRow, error } = await sb.rpc("wallet_credit", {
        p_user_id: wallet.user_id,
        p_amount_kobo: amountKobo,
        p_source: "topup",
        p_flw_reference: chargeId,
        p_narration: "Wallet top-up (bank transfer)",
        p_meta: {
          originator: (pm.bank_transfer as Record<string, unknown>)?.originator_name || null,
          originator_bank: originatorBank || null,
        },
      });
      if (error) { console.error("[flw-webhook] wallet_credit:", error.message); return bad("credit failed", 500); }

      // The RPC is authoritative on what was actually credited/levied — read it
      // back rather than trusting our pre-flight estimate above.
      const creditedKobo = Number((creditRow as Record<string, unknown> | null)?.amount_kobo ?? netAmountKobo);
      const creditedMeta = ((creditRow as Record<string, unknown> | null)?.meta ?? {}) as Record<string, unknown>;
      const actualFeeKobo = Number(creditedMeta.fee_kobo ?? 0);

      // notify the owner — awaited so the function doesn't return (and the
      // isolate get torn down) before these fire-and-forget requests actually
      // leave, which was silently dropping the SMS/push on some deliveries.
      await fetch(`${SUPABASE_URL}/functions/v1/notify-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({
          action: "notify", userId: wallet.user_id, type: "wallet_topup",
          title: "Wallet funded", body: `₦${(creditedKobo / 100).toLocaleString()} added to your KudiAI wallet`,
          category: "money", priority: "high", deepLink: { tab: "wallet", openWallet: true },
        }),
      }).catch(() => {});
      await sendSms(owner.phone, `₦${(creditedKobo / 100).toLocaleString("en-NG")} credited to your KudiAI wallet. — KudiAI`, {
        category: "money", user_id: wallet.user_id as string, related_type: "wallet_ledger", related_id: chargeId,
      });
      // wallet_credit returns the ledger row it wrote — its stored reference, running
      // balance and server timestamp are what the receipt in the app shows too.
      const fundedRow = (creditRow ?? {}) as Record<string, unknown>;
      await sendWalletEmail(sb, owner.email, `Wallet funded — ${fmtNgn(creditedKobo)}`, () =>
        bankEmail({
          title: "Wallet Funded", tone: "success",
          timestamp: (fundedRow.created_at as string | undefined) ?? undefined,
          amount: nairaFromKobo(creditedKobo), amountLabel: "Credited to Your Wallet",
          preheader: `${nairaFromKobo(creditedKobo)} added to your KudiAI wallet`,
          intro: "Your KudiAI wallet is ready to use for bills and transfers.",
          rows: [
            ["Transaction Reference", fundedRow.receipt_ref ? esc(fundedRow.receipt_ref) : "", { mono: true }],
            ["Payment Method", "Bank transfer"],
            ["From", esc(originator)],
            ...(actualFeeKobo > 0 ? [
              ["Amount Received", nairaFromKobo(amountKobo)] as [string, string],
              ["CBN electronic transfer levy", nairaFromKobo(actualFeeKobo)] as [string, string],
            ] : []),
            ["Transaction No.", esc(chargeId), { mono: true }],
            ["Business", owner.name ? esc(owner.name) : ""],
            ["Balance After", nairaFromKobo(fundedRow.balance_after_kobo != null ? fundedRow.balance_after_kobo : Number(wallet.balance_kobo || 0) + creditedKobo)],
          ],
          button: { label: "View Transaction →", url: appLink({ tab: "wallet" }) },
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
          .select("user_id, amount_kobo, fee_kobo, account_name, account_number, bank_code, ledger_id")
          .or(`flw_transfer_id.eq.${transferId}${ref ? `,id.eq.${ref}` : ""}`).limit(1).maybeSingle();
        if (wd) {
          const o = await resolveContact(sb, wd.user_id);
          const bankName = bankNm || wd.bank_code;
          // the debit row written when the transfer was initiated: it carries the
          // stored reference the app's receipt shows, and the balance after it.
          const wdFacts = await ledgerFacts(sb, wd.ledger_id);
          if (st === "successful") {
            // In-app bell + push — on the default channel, never wallet_credit
            // (that sound/channel is reserved for money coming IN, not out).
            await fetch(`${SUPABASE_URL}/functions/v1/notify-send`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
              body: JSON.stringify({
                action: "notify", userId: wd.user_id, type: "wallet_transfer_sent",
                title: "Transfer sent", body: `₦${(wd.amount_kobo / 100).toLocaleString()} sent to ${wd.account_name || wd.account_number}`,
                category: "money", priority: "high", deepLink: { tab: "wallet", openWallet: true },
              }),
            }).catch(() => {});
            await sendWalletEmail(sb, o.email, `Transfer sent — ${fmtNgn(wd.amount_kobo)}`, () =>
              bankEmail({
                title: "Transfer Successful", tone: "warning",
                timestamp: wdFacts?.created_at,
                amount: nairaFromKobo(wd.amount_kobo), amountLabel: "Amount Sent",
                preheader: `${nairaFromKobo(wd.amount_kobo)} sent to ${esc(wd.account_name || wd.account_number)}`,
                intro: "Sent from your KudiAI Track wallet.",
                rows: [
                  ["Transaction Reference", wdFacts?.receipt_ref ? esc(wdFacts.receipt_ref) : "", { mono: true }],
                  ["Payment Method", "KudiAI Wallet"],
                  ["To", esc(wd.account_name || wd.account_number)],
                  ["Account", `${esc(wd.account_number)} · ${esc(bankName)}`],
                  ["Fee", wd.fee_kobo ? nairaFromKobo(wd.fee_kobo) : ""],
                  ["Session ID", sessionId ? esc(sessionId) : "", { mono: true }],
                  ["Transaction No.", esc(transferId), { mono: true }],
                  ["Business", o.name ? esc(o.name) : ""],
                  ["Balance After", wdFacts?.balance_after_kobo != null ? nairaFromKobo(wdFacts.balance_after_kobo) : ""],
                ],
                button: { label: "View Transaction →", url: appLink({ tab: "wallet" }) },
              }));
            await sendSms(o.phone, `${fmtNgn(wd.amount_kobo)} transfer to ${wd.account_name || wd.account_number} completed. — KudiAI`, {
              category: "money", user_id: wd.user_id as string, related_type: "wallet_withdrawals", related_id: transferId,
            });
          } else {
            await fetch(`${SUPABASE_URL}/functions/v1/notify-send`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
              body: JSON.stringify({
                action: "notify", userId: wd.user_id, type: "wallet_transfer_failed",
                title: "Transfer returned", body: `₦${(wd.amount_kobo / 100).toLocaleString()} to ${wd.account_name || wd.account_number} could not be completed — returned to your wallet`,
                category: "money", priority: "high", deepLink: { tab: "wallet", openWallet: true },
              }),
            }).catch(() => {});
            // the wallet's balance now that the amount has been returned
            const { data: wNow } = await sb.from("wallets").select("balance_kobo").eq("user_id", wd.user_id).maybeSingle();
            await sendWalletEmail(sb, o.email, `Transfer ${st} — ${fmtNgn(wd.amount_kobo)} returned`, () =>
              bankEmail({
                title: st === "reversed" ? "Transfer Reversed" : "Transfer Unsuccessful", tone: "danger",
                timestamp: new Date(),
                amount: nairaFromKobo(wd.amount_kobo), amountLabel: "Returned to Your Wallet",
                preheader: `Your ${nairaFromKobo(wd.amount_kobo)} transfer could not be completed — it is back in your wallet`,
                intro: "The bank could not complete this transfer, so the full amount is back in your wallet.",
                rows: [
                  ["Transaction Reference", wdFacts?.receipt_ref ? esc(wdFacts.receipt_ref) : "", { mono: true }],
                  ["Payment Method", "KudiAI Wallet"],
                  ["To", esc(wd.account_name || wd.account_number)],
                  ["Status", "Returned to your wallet"],
                  ["Transaction No.", esc(transferId), { mono: true }],
                  ["Business", o.name ? esc(o.name) : ""],
                  ["Balance After", wNow?.balance_kobo != null ? nairaFromKobo(wNow.balance_kobo) : ""],
                ],
                button: { label: "View Transaction →", url: appLink({ tab: "wallet" }) },
              }));
            await sendSms(o.phone, `${fmtNgn(wd.amount_kobo)} transfer ${st} — returned to your KudiAI wallet. — KudiAI`, {
              category: "money", user_id: wd.user_id as string, related_type: "wallet_withdrawals", related_id: transferId,
            });
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

// ── Bill payment: fulfill via ClubKonnect for a Flutterwave-charged bill ─────
// Deliberately a standalone copy of paystack-webhook's handleBillPayment (not
// a shared import — this repo has no cross-function shared module, and copying
// keeps the live Paystack path completely untouched while this rolls out).
// deno-lint-ignore no-explicit-any
async function handleBillPaymentFlw(
  sb: any,
  reference: string,
  amountKobo: number,
  supabaseUrl: string,
  serviceKey: string,
) {
  const amountNgn = amountKobo / 100;

  const { data: pb } = await sb
    .from("pending_bills")
    .select("*")
    .eq("reference", reference)
    .maybeSingle();

  if (!pb) {
    console.warn(`[flw-webhook/bill] No pending_bills record for ref ${reference} — client must fulfill on return`);
    return;
  }
  if (pb.status !== "pending") {
    console.log(`[flw-webhook/bill] Already processed (status=${pb.status}): ${reference}`);
    return;
  }

  // Optimistic lock — prevents concurrent webhook invocations from double-fulfilling.
  const { error: lockErr } = await sb
    .from("pending_bills")
    .update({ status: "processing" })
    .eq("reference", reference)
    .eq("status", "pending");
  if (lockErr) {
    console.error(`[flw-webhook/bill] Lock failed for ${reference}:`, lockErr.message);
    return;
  }

  const cat      = pb.cat as string;
  const formData = (pb.form_data ?? {}) as Record<string, string>;

  const NET_ERR = /network|timeout|timed ?out|fetch failed|failed to fetch|connection|aborted|ECONNRESET|socket|dns|gateway|50[234]/i;
  const ckPost = async (payload: Record<string, unknown>, tries = 3): Promise<Record<string, unknown>> => {
    let lastErr: unknown;
    for (let i = 0; i < tries; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 3000 * i));
      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/clubkonnect`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${serviceKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        return await resp.json() as Record<string, unknown>;
      } catch (e) {
        lastErr = e;
        if (!NET_ERR.test((e as Error).message || "")) break;
      }
    }
    throw lastErr ?? new Error("clubkonnect unreachable");
  };

  try {
    const ck = await ckPost({ action: cat, requestId: reference, ...formData });

    if (ck?.error) throw new Error(String(ck.error));

    const apiRef      = String(ck.reference ?? "");
    const elecToken   = String(ck.token ?? ck.metertoken ?? ck.meter_token ?? ck.electricity_token ?? "");
    const elecUnits   = String(ck.units ?? ck.unit ?? ck.kwh ?? "");
    const elecOrderId = String(ck.reference ?? "");
    const cardDetails = String(ck.cardDetails ?? "");
    const pinsArr     = Array.isArray(ck.pins)
      ? (ck.pins as Record<string, unknown>[]).map(p => ({ ...p, network: formData.network ?? "" }))
      : [];

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
      payment_type:     "flutterwave",
      note,
      transaction_date: new Date().toISOString().slice(0, 10),
      bill_status:      "completed",
      client_txn_id:    reference,
    }).onConflict("client_txn_id").ignore();

    console.log(`[flw-webhook/bill] Fulfilled: ref=${reference} cat=${cat} amount=₦${amountNgn}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[flw-webhook/bill] ClubKonnect failed for ${reference}: ${msg}`);

    let verdict: "FAILED" | "SUCCESS" | "HOLD" = "FAILED";
    let vr: Record<string, unknown> = {};
    if (NET_ERR.test(msg) || /unreachable|non-2xx|edge function/i.test(msg)) {
      try {
        vr = await ckPost({ action: "verify", requestId: reference, service: cat }, 2);
        const vs = String(vr?.status ?? "").toUpperCase();
        if (vs === "SUCCESS")                       verdict = "SUCCESS";
        else if (vs === "PENDING" || vs === "UNKNOWN") verdict = "HOLD";
      } catch {
        verdict = "HOLD";
      }
    }

    const { data: uProf } = await sb.from("profiles")
      .select("email, owner_name, business_name")
      .eq("id", pb.user_id).maybeSingle();
    const uEmail = (uProf as Record<string, unknown> | null)?.email ?? null;
    const uName  = (uProf as Record<string, unknown> | null)?.owner_name
                ?? (uProf as Record<string, unknown> | null)?.business_name ?? null;

    if (verdict === "SUCCESS") {
      const apiRef = String(vr.reference ?? reference);
      const note   = `${cat} | recovered via requery${apiRef ? ` | Ref: ${apiRef}` : ""} | FLW: ${reference}`;
      await sb.from("pending_bills").update({
        status: "fulfilled",
        fulfillment: {
          ok: true, label: cat, detail: note, psRef: reference, apiRef, cat,
          amount: amountNgn, pinsArr: Array.isArray(vr.pins) ? vr.pins : [],
          cardDetails: String(vr.cardDetails ?? ""), elecToken: String(vr.token ?? ""),
          elecOrderId: "", elecUnits: "", txnHistoryPending: false, formSnap: formData,
        },
        fulfilled_at: new Date().toISOString(),
      }).eq("reference", reference);
      await sb.from("transactions").insert({
        user_id: pb.user_id, type: "expense", category: cat, amount: amountNgn,
        item_name: cat, payment_type: "flutterwave", note,
        transaction_date: new Date().toISOString().slice(0, 10),
        bill_status: "completed", client_txn_id: reference,
      }).onConflict("client_txn_id").ignore();
      console.log(`[flw-webhook/bill] Recovered via requery: ref=${reference} cat=${cat}`);
      return;
    }

    const hold = verdict === "HOLD";

    await sb.from("pending_bills").update({
      status: "failed",
      fulfillment: { detail: msg, _charged: true, _hold: hold },
    }).eq("reference", reference);

    await sb.from("transactions").insert({
      user_id:          pb.user_id,
      type:             "expense",
      category:         cat,
      amount:           amountNgn,
      item_name:        cat,
      payment_type:     "flutterwave",
      note:             hold
        ? `PENDING CONFIRMATION (webhook): ${msg} | FLW: ${reference}`
        : `FAILED (webhook): ${msg} | FLW: ${reference}`,
      transaction_date: new Date().toISOString().slice(0, 10),
      bill_status:      hold ? "pending" : "failed",
      client_txn_id:    `wh_${reference}`,
    }).onConflict("client_txn_id").ignore();

    try {
      await fetch(`${supabaseUrl}/functions/v1/clubkonnect`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action:     "bill-failure-alert",
          hold,
          user_id:    pb.user_id,
          user_email: uEmail,
          user_name:  uName,
          service:    cat,
          amount:     amountNgn,
          ps_ref:     reference,
          ck_error:   msg,
        }),
      });
    } catch (alertErr) {
      console.error(`[flw-webhook/bill] Failure alert error: ${(alertErr as Error).message}`);
    }
  }
}
