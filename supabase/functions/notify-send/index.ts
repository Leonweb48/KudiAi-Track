import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// ── Category → preference field map ─────────────────────────────────────────
const CAT_PREF: Record<string, string> = {
  money:   "pref_money",
  savings: "pref_savings",
  stock:   "pref_stock",
};

// ── FCM push via legacy API ──────────────────────────────────────────────────
async function sendFCM(token: string, title: string, body: string, deepLink: Record<string, unknown> | null) {
  const serverKey = Deno.env.get("FIREBASE_SERVER_KEY");
  if (!serverKey) return; // Firebase not configured; skip push silently

  await fetch("https://fcm.googleapis.com/fcm/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `key=${serverKey}`,
    },
    body: JSON.stringify({
      to: token,
      notification: {
        title,
        body,
        icon: "ic_notification",
        color: "#3DA829",
        android_channel_id: "money_alerts",
      },
      data: deepLink ? { deepLink: JSON.stringify(deepLink) } : {},
      android: { priority: "high" },
    }),
  }).catch(() => null);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")!;

  // Caller identity — service_role bypasses all ownership checks
  const authHeader = req.headers.get("Authorization") ?? "";
  const callerToken = authHeader.replace("Bearer ", "").trim();
  const isServiceRole = callerToken === serviceKey;

  const sb = createClient(supabaseUrl, serviceKey); // always service role for DB writes

  // Caller user (for ownership check on non-service-role calls)
  let callerId: string | null = null;
  if (!isServiceRole && callerToken && callerToken !== anonKey) {
    const { data: { user } } = await createClient(supabaseUrl, anonKey).auth.getUser(callerToken);
    callerId = user?.id ?? null;
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const action = body.action as string;

  // ── register-token ─────────────────────────────────────────────────────────
  if (action === "register-token") {
    const userId = callerId ?? (body.userId as string);
    if (!userId) return json({ error: "userId required" }, 400);
    const { token, platform = "android" } = body as { token: string; platform?: string };
    if (!token) return json({ error: "token required" }, 400);
    await sb.from("push_tokens").upsert(
      { user_id: userId, token, platform, last_seen: new Date().toISOString() },
      { onConflict: "user_id,token" },
    );
    return json({ ok: true });
  }

  // ── notify ─────────────────────────────────────────────────────────────────
  if (action === "notify") {
    const {
      userId,
      type,
      title,
      body: bodyText,
      deepLink = null,
      priority = "normal",
      dedupeKey = null,
      category = "money",
    } = body as {
      userId: string; type: string; title: string; body: string;
      deepLink?: Record<string, unknown> | null; priority?: string;
      dedupeKey?: string | null; category?: string;
    };

    if (!userId || !type || !title) return json({ error: "userId, type, title required" }, 400);

    // Cross-user auth guard: service_role OR caller is staff of that user's business
    if (!isServiceRole && callerId && callerId !== userId) {
      const { data: ownerProf } = await sb.from("profiles").select("id").eq("user_id", userId).maybeSingle();
      if (ownerProf) {
        const { data: staffRow } = await sb.from("staff")
          .select("id").eq("user_id", callerId).eq("owner_id", userId).eq("status", "active").maybeSingle();
        if (!staffRow) return json({ error: "Forbidden" }, 403);
      }
    }

    // Preference check
    const { data: prefs } = await sb.from("notification_preferences")
      .select("push_enabled, pref_money, pref_savings, pref_stock")
      .eq("user_id", userId).maybeSingle();

    const prefField = CAT_PREF[category];
    if (prefs && prefField && !(prefs as Record<string, boolean>)[prefField]) {
      return json({ ok: true, suppressed: "preference" });
    }

    // Dedupe: if an unread notification with the same dedupeKey exists, UPDATE it
    if (dedupeKey) {
      const { data: existing } = await sb.from("notifications")
        .select("id, title, body")
        .eq("user_id", userId)
        .eq("dedupe_key", dedupeKey)
        .is("read_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing) {
        await sb.from("notifications")
          .update({ title, body: bodyText, deep_link: deepLink })
          .eq("id", existing.id);
        return json({ ok: true, action: "updated", id: existing.id });
      }
    }

    // INSERT new notification
    const { data: notif, error: insertErr } = await sb.from("notifications").insert({
      user_id:    userId,
      type,
      title,
      body:       bodyText,
      deep_link:  deepLink,
      priority,
      dedupe_key: dedupeKey,
    }).select("id").single();

    if (insertErr) return json({ error: insertErr.message }, 500);

    // FCM push for high-priority when user has tokens and push is enabled
    if (priority === "high" && (prefs?.push_enabled ?? true)) {
      const { data: tokens } = await sb.from("push_tokens")
        .select("token, platform")
        .eq("user_id", userId)
        .gte("last_seen", new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString());

      if (tokens?.length) {
        await Promise.all(tokens.map(t => sendFCM(t.token, title, bodyText ?? "", deepLink)));
      }
    }

    return json({ ok: true, action: "inserted", id: notif?.id });
  }

  return json({ error: "Unknown action" }, 400);
});
