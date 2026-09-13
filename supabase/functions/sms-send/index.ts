// sms-send — internal, service-role-only helper other edge functions call to
// deliver a message via Meta's WhatsApp Cloud API directly (no BSP/reseller in
// front of it). Modeled on notify-send/index.ts's shape; kept the "sms-send"
// name and its {phone, message, category, user_id, related_type, related_id}
// call shape so none of its 6 callers needed to change across either of this
// function's two provider migrations (SMS -> Sendchamp WhatsApp -> Meta
// direct).
//
// Why direct-to-Meta instead of a BSP: Sendchamp's WhatsApp channel wasn't
// reachable on this account (dashboard only showed a "test" option, no
// template/activation UI) — going direct to Meta's own Cloud API removes that
// reseller layer and its dashboard entirely.
//
// WhatsApp specifics that still apply regardless of provider: every message
// this app sends is business-initiated (the recipient hasn't just messaged
// us first), which per WhatsApp Business Platform policy requires a
// pre-approved template — free-form text only works inside a customer-opened
// session. That's a Meta policy, not a BSP one, so it doesn't go away by
// going direct. Rather than get a template approved per message type, this
// uses ONE generic template (created in Meta's own WhatsApp Manager) with a
// single body placeholder that echoes back whatever fully-composed `message`
// string the caller already built — so every existing call site keeps
// sending a plain message string unchanged. See META_WHATSAPP_TEMPLATE_NAME.
//
// Every attempt (sent, failed, rate-limited, suppressed by preference,
// invalid phone) is logged to sms_log — the same audit-trail role
// wallet_webhook_log/paystack_webhook_log play for their domains.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// A System User permanent access token (business_management +
// whatsapp_business_messaging + whatsapp_business_management scopes) —
// generated once in Meta Business Settings -> System Users, so it doesn't
// expire like the "temporary access token" shown during initial app setup.
const META_TOKEN           = Deno.env.get("META_WHATSAPP_TOKEN") ?? "";
const META_PHONE_NUMBER_ID = Deno.env.get("META_WHATSAPP_PHONE_NUMBER_ID") ?? "";
// The Meta WhatsApp Manager "name" of the one generic, Meta-approved
// template this app uses for every message (see comment above). No
// default — sends fail closed (logged, not thrown) until this is set.
const META_TEMPLATE_NAME = Deno.env.get("META_WHATSAPP_TEMPLATE_NAME") ?? "";
// The language the template was created in (Meta WhatsApp Manager shows this
// as e.g. "English (US)" -> code "en_US"). Must match exactly or Meta 404s.
const META_TEMPLATE_LANG = Deno.env.get("META_WHATSAPP_TEMPLATE_LANG") || "en_US";
const META_API_VERSION   = Deno.env.get("META_WHATSAPP_API_VERSION") || "v21.0";

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

// Meta's Cloud API expects E.164 digits with no "+": 234XXXXXXXXXX. Nigerian
// numbers in this app's DB show up as either "0803..." or "234803...".
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
    // someone mashing "resend OTP") turning into a runaway messaging bill.
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
    const { count } = await sb.from("sms_log")
      .select("id", { count: "exact", head: true })
      .eq("phone", normalized)
      .gte("created_at", windowStart);
    if ((count ?? 0) >= RATE_LIMIT_MAX) {
      await logSms(sb, { phone: normalized, message, category, related_type, related_id, status: "rate_limited" });
      return json({ ok: false, error: "Rate limited" });
    }

    if (!META_TOKEN || !META_PHONE_NUMBER_ID) {
      await logSms(sb, { phone: normalized, message, category, related_type, related_id, status: "failed", error: "META_WHATSAPP_TOKEN/META_WHATSAPP_PHONE_NUMBER_ID not configured" });
      return json({ ok: false, error: "WhatsApp not configured" });
    }
    if (!META_TEMPLATE_NAME) {
      await logSms(sb, { phone: normalized, message, category, related_type, related_id, status: "failed", error: "META_WHATSAPP_TEMPLATE_NAME not configured" });
      return json({ ok: false, error: "WhatsApp not configured" });
    }

    try {
      const resp = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${META_PHONE_NUMBER_ID}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${META_TOKEN}` },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: normalized,
          type: "template",
          template: {
            name: META_TEMPLATE_NAME,
            language: { code: META_TEMPLATE_LANG },
            components: [{ type: "body", parameters: [{ type: "text", text: message }] }],
          },
        }),
      });
      const respJson = await resp.json().catch(() => ({} as Record<string, unknown>));
      const ok = resp.ok && !!(respJson as { messages?: unknown[] })?.messages?.length;
      const reference = (respJson as { messages?: { id?: string }[] })?.messages?.[0]?.id ?? null;

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
