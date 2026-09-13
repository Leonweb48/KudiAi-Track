// sms-send — internal, service-role-only helper other edge functions call to
// deliver an SMS via Sendchamp. Modeled on notify-send/index.ts's shape, but
// simpler: no template system — callers pass the finished message text.
//
// Temporarily reverted here from a WhatsApp channel (Sendchamp, then Meta's
// Cloud API directly) back to this proven, working Sendchamp SMS path —
// WhatsApp setup is paused (stuck on Meta business-portfolio access) and
// this app can't ship with zero message delivery (OTPs, wallet alerts) in
// the meantime. Revisit switching back once Meta's WhatsApp setup is sorted.
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

const SENDCHAMP_API_KEY = Deno.env.get("SENDCHAMP_API_KEY") ?? "";
const SENDCHAMP_SENDER  = Deno.env.get("SENDCHAMP_SENDER_NAME") || "Sendchamp";
const SENDCHAMP_URL     = "https://api.sendchamp.com/api/v1/sms/send";

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

// Sendchamp expects international format: 234XXXXXXXXXX — no "+", no leading "0".
// Nigerian numbers in this app's DB show up as either "0803..." or "234803...".
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
  // channel is explicit (not left to the column default) — that default was
  // changed to 'whatsapp' by the since-reverted WhatsApp migration, and would
  // otherwise mislabel these SMS-era rows.
  try { await sb.from("sms_log").insert({ channel: "sms", ...row }); } catch { /* logging must never break the caller */ }
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
      return json({ ok: false, error: "SMS not configured" });
    }

    // Transactional messages (OTP, money alerts) use the "dnd" route so they
    // still reach DND-registered numbers — the common case in Nigeria.
    // Lower-priority categories use "non_dnd" to save cost.
    const route = (category === "otp" || category === "money") ? "dnd" : "non_dnd";

    try {
      const resp = await fetch(SENDCHAMP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SENDCHAMP_API_KEY}` },
        body: JSON.stringify({ to: [normalized], message, sender_name: SENDCHAMP_SENDER, route }),
      });
      const respJson = await resp.json().catch(() => ({} as Record<string, unknown>));
      const ok = resp.ok && (respJson as { status?: string })?.status === "success";
      const reference = (respJson as { data?: { reference?: string } })?.data?.reference ?? null;

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
