// sms-send — internal, service-role-only helper other edge functions call to
// deliver a message via Sendchamp's WhatsApp channel. Modeled on
// notify-send/index.ts's shape; kept the "sms-send" name and its {phone,
// message, category, user_id, related_type, related_id} call shape so none
// of its 6 callers needed to change when this switched channels from SMS.
//
// Why WhatsApp instead of SMS: Sendchamp's SMS "dnd" route (needed so
// transactional messages reach DND-registered numbers, the common case in
// Nigeria) requires a business-verification review that was taking too long.
// WhatsApp's shared sender number works immediately with no such wait.
//
// WhatsApp specifics that matter here: every message this app sends is
// business-initiated (the recipient hasn't just messaged us first), which
// per WhatsApp Business policy requires a pre-approved template — free-form
// text only works inside a customer-opened session. Rather than get a
// template approved per message type, this uses ONE generic template with a
// single placeholder that echoes back whatever fully-composed `message`
// string the caller already built (see WHATSAPP_TEMPLATE_CODE below) — so
// every existing call site keeps sending a plain message string unchanged.
//
// Before sending, checks Sendchamp's WhatsApp Number Validation endpoint so a
// number confirmed NOT on WhatsApp is skipped (logged "not_on_whatsapp")
// instead of wasting a template send on a guaranteed failure — see
// isOnWhatsApp() below.
//
// Every attempt (sent, failed, rate-limited, suppressed by preference,
// invalid phone, not on WhatsApp) is logged to sms_log — the same
// audit-trail role wallet_webhook_log/paystack_webhook_log play for their
// domains.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const SENDCHAMP_API_KEY = Deno.env.get("SENDCHAMP_API_KEY") ?? "";
// Sendchamp's shared/default WhatsApp sender — works with no activation wait.
// Set SENDCHAMP_WHATSAPP_SENDER once a dedicated KudiAI number is activated.
const WHATSAPP_SENDER       = Deno.env.get("SENDCHAMP_WHATSAPP_SENDER") || "2348120678278";
// The Sendchamp dashboard "template_code" for the one generic, Meta-approved
// template this app uses for every message (see comment above). No default —
// sends fail closed (logged, not thrown) until this is set post-approval.
const WHATSAPP_TEMPLATE_CODE = Deno.env.get("SENDCHAMP_WHATSAPP_TEMPLATE_CODE") ?? "";
const SENDCHAMP_URL          = "https://api.sendchamp.com/api/v1/whatsapp/message/send";
const WHATSAPP_VALIDATE_URL  = "https://api.sendchamp.com/api/v1/whatsapp/validate";

// Reuses the exact category set notify-send already has, plus "otp" — OTP
// codes are never suppressed by a category preference (a user can't "opt
// out" of receiving their own verification code).
const CAT_PREF: Record<string, string> = {
  money:       "pref_money",
  savings:     "pref_savings",
  stock:       "pref_stock",
  permissions: "pref_permissions",
  approvals:   "pref_approvals",
};

const RATE_LIMIT_MAX    = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// Sendchamp's WhatsApp API expects the same international format as SMS did:
// 234XXXXXXXXXX — no "+", no leading "0". Nigerian numbers in this app's DB
// show up as either "0803..." or "234803...".
function normalizeNgPhone(raw: string): string | null {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("234") && digits.length === 13) return digits;
  if (digits.startsWith("0")   && digits.length === 11) return "234" + digits.slice(1);
  if (digits.length === 10) return "234" + digits; // e.g. stored without any prefix at all
  return null;
}

// deno-lint-ignore no-explicit-any
async function logSms(sb: any, row: Record<string, unknown>) {
  try { await sb.from("sms_log").insert({ channel: "whatsapp", ...row }); } catch { /* logging must never break the caller */ }
}

// true/false when Sendchamp could check; null when the check itself failed
// (network error, non-2xx, unexpected shape) — callers should fail OPEN on
// null (still attempt the send) rather than silently drop a real message
// because the validation endpoint had a hiccup.
async function isOnWhatsApp(phone: string): Promise<boolean | null> {
  try {
    const resp = await fetch(WHATSAPP_VALIDATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SENDCHAMP_API_KEY}` },
      body: JSON.stringify({ phone_number: phone }),
    });
    const data = await resp.json().catch(() => ({} as Record<string, unknown>));
    if (!resp.ok || (data as { status?: string })?.status !== "success") return null;
    return !!(data as { data?: { is_valid?: boolean } })?.data?.is_valid;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader  = req.headers.get("Authorization") ?? "";
  const callerToken = authHeader.replace("Bearer ", "").trim();

  // Internal, server-to-server helper only — every caller is another edge
  // function holding the service-role key, mirroring how ajo-write calls
  // notify-send. No end-user-facing action needs this directly today.
  if (callerToken !== serviceKey) return json({ error: "Forbidden" }, 403);

  const sb = createClient(supabaseUrl, serviceKey);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const action = body.action as string;

  if (action === "send") {
    const {
      phone, message, category = "money", user_id = null,
      related_type = null, related_id = null,
    } = body as {
      phone: string; message: string; category?: string; user_id?: string | null;
      related_type?: string | null; related_id?: string | null;
    };

    if (!phone || !message) return json({ error: "phone and message required" }, 400);

    const normalized = normalizeNgPhone(phone);
    if (!normalized) {
      await logSms(sb, { phone, message, category, related_type, related_id, status: "invalid_phone" });
      return json({ ok: false, error: "Invalid phone number" });
    }

    // Preference check — skipped entirely for OTP (see CAT_PREF comment above).
    if (category !== "otp" && user_id) {
      const { data: prefs } = await sb.from("notification_preferences")
        .select("sms_enabled, pref_money, pref_savings, pref_stock, pref_permissions, pref_approvals")
        .eq("user_id", user_id).maybeSingle();
      if (prefs) {
        const prefsRec = prefs as Record<string, boolean>;
        const prefField = CAT_PREF[category];
        const suppressed = prefsRec.sms_enabled === false || (prefField && prefsRec[prefField] === false);
        if (suppressed) {
          await logSms(sb, { phone: normalized, message, category, related_type, related_id, status: "suppressed_preference" });
          return json({ ok: true, suppressed: "preference" });
        }
      }
    }

    // Rate limit — real-money safety rail against a spam/abuse loop (e.g.
    // someone mashing "resend OTP") turning into a runaway Sendchamp bill.
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
    const { count } = await sb.from("sms_log")
      .select("id", { count: "exact", head: true })
      .eq("phone", normalized)
      .gte("created_at", windowStart);
    if ((count ?? 0) >= RATE_LIMIT_MAX) {
      await logSms(sb, { phone: normalized, message, category, related_type, related_id, status: "rate_limited" });
      return json({ ok: false, error: "Rate limited" });
    }

    if (!SENDCHAMP_API_KEY) {
      await logSms(sb, { phone: normalized, message, category, related_type, related_id, status: "failed", error: "SENDCHAMP_API_KEY not configured" });
      return json({ ok: false, error: "WhatsApp not configured" });
    }
    if (!WHATSAPP_TEMPLATE_CODE) {
      await logSms(sb, { phone: normalized, message, category, related_type, related_id, status: "failed", error: "SENDCHAMP_WHATSAPP_TEMPLATE_CODE not configured" });
      return json({ ok: false, error: "WhatsApp not configured" });
    }

    // Skip the send (and its cost) when the number is confirmed NOT on
    // WhatsApp — a guaranteed failure otherwise. Fails open (proceeds to
    // send) if the validation call itself errors — see isOnWhatsApp().
    const onWhatsApp = await isOnWhatsApp(normalized);
    if (onWhatsApp === false) {
      await logSms(sb, { phone: normalized, message, category, related_type, related_id, status: "not_on_whatsapp" });
      return json({ ok: false, error: "This number is not on WhatsApp" });
    }

    try {
      const resp = await fetch(SENDCHAMP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SENDCHAMP_API_KEY}` },
        body: JSON.stringify({
          sender: WHATSAPP_SENDER,
          recipient: normalized,
          type: "template",
          template_code: WHATSAPP_TEMPLATE_CODE,
          custom_data: { body: { "1": message } },
        }),
      });
      const respJson = await resp.json().catch(() => ({} as Record<string, unknown>));
      const ok = resp.ok && (respJson as { status?: string })?.status === "success";
      const reference = (respJson as { data?: { provider_reference?: string } })?.data?.provider_reference ?? null;

      await logSms(sb, {
        phone: normalized, message, category, related_type, related_id,
        status: ok ? "sent" : "failed",
        provider_reference: reference,
        error: ok ? null : JSON.stringify(respJson),
      });
      return json({ ok, reference });
    } catch (e) {
      await logSms(sb, { phone: normalized, message, category, related_type, related_id, status: "failed", error: (e as Error).message });
      return json({ ok: false, error: "Send failed" });
    }
  }

  return json({ error: "Unknown action" }, 400);
});
