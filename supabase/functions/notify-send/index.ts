import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// ── Rollup templates — aggregate title/body when the same dedupeKey fires N times ──
// Only applies when the UPDATE path fires (existing unread row with same key).
const ROLLUP: Record<string, { title: (n: number) => string; body: (n: number, total: number) => string }> = {
  staff_cash_in:    { title: n => `${n} Sales Recorded`,     body: (n, t) => `${n} sales — ₦${fmtN(t)} total` },
  staff_cash_out:   { title: n => `${n} Expenses Recorded`,  body: (n, t) => `${n} expenses — ₦${fmtN(t)} total` },
  credit_repayment: { title: n => `${n} Repayments`,         body: (n, t) => `${n} credit payments — ₦${fmtN(t)} received` },
  invoice_paid:     { title: n => `${n} Invoices Paid`,      body: (n, t) => `${n} invoices — ₦${fmtN(t)} total received` },
};

function fmtN(n: number): string {
  return Number(n).toLocaleString("en-NG");
}

// Anti-flood tuning constants (adjust here to change global behaviour)
const FLOOD_WINDOW_MS  = 3 * 60 * 1000; // 3 minutes — suppress repeat FCM within this window
const FLOOD_THRESHOLD  = 3;             // rollup body kicks in after this many collapsed events

// ── Category → preference field map ─────────────────────────────────────────
const CAT_PREF: Record<string, string> = {
  money:       "pref_money",
  savings:     "pref_savings",
  stock:       "pref_stock",
  permissions: "pref_permissions",
  approvals:   "pref_approvals",
};

// ── FCM HTTP v1 via OAuth2 service-account JWT ───────────────────────────────

// Module-level token cache — survives warm invocations (~55 min effective TTL)
let _fcmToken: string | null = null;
let _fcmExpiry = 0;

/** Convert PEM private key block to raw DER ArrayBuffer for WebCrypto. */
function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\r?\n/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Base64url-encode a Uint8Array or ArrayBuffer. */
function b64url(input: Uint8Array | ArrayBuffer): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

interface ServiceAccount {
  client_email: string;
  private_key:  string;
  project_id:   string;
}

/** Mint (or return cached) an OAuth2 Bearer token for FCM. */
async function getFCMToken(sa: ServiceAccount): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  if (_fcmToken && now < _fcmExpiry) return _fcmToken;

  const enc = new TextEncoder();
  const header  = b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = b64url(enc.encode(JSON.stringify({
    iss:   sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud:   "https://oauth2.googleapis.com/token",
    iat:   now,
    exp:   now + 3600,
  })));

  const signingInput = `${header}.${payload}`;

  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      "pkcs8",
      pemToDer(sa.private_key),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch (e) {
    console.error("[FCM] importKey failed:", e);
    return null;
  }

  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    enc.encode(signingInput),
  );

  const jwt = `${signingInput}.${b64url(sig)}`;

  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!tokenResp.ok) {
    console.error("[FCM] Token exchange failed:", await tokenResp.text());
    return null;
  }

  const { access_token, expires_in } = await tokenResp.json() as { access_token: string; expires_in: number };
  _fcmToken  = access_token;
  _fcmExpiry = now + (expires_in ?? 3600) - 300; // 5-min buffer → ~55-min cache
  return _fcmToken;
}

/**
 * Send via FCM HTTP v1 API.
 * Returns the raw response body string so callers can log it for acceptance checks.
 * Prunes UNREGISTERED tokens from push_tokens automatically.
 */
async function sendFCMv1(
  sb:            ReturnType<typeof createClient>,
  token:         string,
  title:         string,
  body:          string,
  deepLink:      Record<string, unknown> | null,
  priority:      string,
  unreadCount:   number,
): Promise<{ status: number; body: string }> {
  const saRaw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
  if (!saRaw) return { status: 0, body: "FIREBASE_SERVICE_ACCOUNT not set" };

  let sa: ServiceAccount;
  try { sa = JSON.parse(saRaw) as ServiceAccount; }
  catch { return { status: 0, body: "FIREBASE_SERVICE_ACCOUNT is not valid JSON" }; }

  const accessToken = await getFCMToken(sa);
  if (!accessToken) return { status: 0, body: "Could not obtain FCM access token" };

  // v1 requires ALL data values to be strings
  const data: Record<string, string> = { group: "kuditrack" };
  if (deepLink) data["deepLink"] = JSON.stringify(deepLink);
  if (unreadCount > 1) {
    // summary tap → open notification center
    data["groupSummary"] = "true";
    data["groupSummaryDeepLink"] = JSON.stringify({ tab: "home", openNotifications: true });
  }

  // Channels move under android.notification in v1
  const channelId = priority === "high" ? "money_alerts" : "updates";

  const resp = await fetch(
    `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
    {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body },
          data,
          android: {
            priority: priority === "high" ? "HIGH" : "NORMAL",
            notification: {
              icon:               "ic_notification",
              color:              "#3DA829",
              channel_id:         channelId,
              // Badge / shade count — shows total unread when > 1
              notification_count: unreadCount > 1 ? unreadCount : undefined,
            },
          },
        },
      }),
    },
  );

  const respText = await resp.text();

  if (!resp.ok) {
    // Parse errorCode to decide whether to prune the token
    let errCode = "";
    try {
      const errJson = JSON.parse(respText) as {
        error?: { status?: string; details?: Array<{ errorCode?: string }> }
      };
      errCode = errJson?.error?.details?.[0]?.errorCode
             ?? errJson?.error?.status
             ?? "";
    } catch { /* ignore parse failure */ }

    const stale = resp.status === 404
               || errCode === "UNREGISTERED"
               || errCode === "INVALID_ARGUMENT";

    if (stale) {
      await sb.from("push_tokens").delete().eq("token", token);
      console.log("[FCM] Pruned stale token:", token.slice(0, 20) + "…");
    } else {
      console.error("[FCM] Send failed:", respText);
    }
  }

  return { status: resp.status, body: respText };
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader  = req.headers.get("Authorization") ?? "";
  const callerToken = authHeader.replace("Bearer ", "").trim();
  const isServiceRole = callerToken === serviceKey;

  const sb = createClient(supabaseUrl, serviceKey);

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
    // Remove this token from any other user's rows — device must map to exactly one user
    await sb.from("push_tokens").delete().eq("token", token).neq("user_id", userId);
    return json({ ok: true });
  }

  // ── deregister-token ────────────────────────────────────────────────────────
  if (action === "deregister-token") {
    if (!callerId) return json({ error: "auth required" }, 401);
    const { token } = body as { token: string };
    if (!token) return json({ error: "token required" }, 400);
    await sb.from("push_tokens").delete().eq("user_id", callerId).eq("token", token);
    return json({ ok: true });
  }

  // ── notify ─────────────────────────────────────────────────────────────────
  if (action === "notify") {
    const {
      userId,
      type,
      title:       titleIn,
      body:        bodyTextIn,
      deepLink   = null,
      priority   = "normal",
      dedupeKey  = null,
      category   = "money",
      rollupAmount,
    } = body as {
      userId: string; type: string; title: string; body: string;
      deepLink?: Record<string, unknown> | null; priority?: string;
      dedupeKey?: string | null; category?: string;
      rollupAmount?: number;
    };

    if (!userId || !type || !titleIn) return json({ error: "userId, type, title required" }, 400);

    let title    = titleIn;
    let bodyText = bodyTextIn;

    // Cross-user auth guard
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
      .select("push_enabled, pref_money, pref_savings, pref_stock, pref_permissions, pref_approvals")
      .eq("user_id", userId).maybeSingle();

    const prefField = CAT_PREF[category];
    if (prefs && prefField && !(prefs as Record<string, boolean>)[prefField]) {
      return json({ ok: true, suppressed: "preference" });
    }

    // Dedupe: UPDATE existing unread row with same dedupe_key (rollup accumulation)
    if (dedupeKey) {
      const { data: existing } = await sb.from("notifications")
        .select("id, notif_count, notif_total")
        .eq("user_id", userId)
        .eq("dedupe_key", dedupeKey)
        .is("read_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing) {
        const prevCount = (existing.notif_count as number) ?? 1;
        const prevTotal = (existing.notif_total as number) ?? 0;
        const newCount  = prevCount + 1;
        const newTotal  = prevTotal + (rollupAmount ?? 0);

        // Override title/body with aggregate template after FLOOD_THRESHOLD events collapse
        const rollupTpl = ROLLUP[type];
        if (rollupTpl && newCount > FLOOD_THRESHOLD) {
          title    = rollupTpl.title(newCount);
          bodyText = rollupTpl.body(newCount, newTotal);
        }

        await sb.from("notifications")
          .update({ title, body: bodyText, deep_link: deepLink, notif_count: newCount, notif_total: newTotal })
          .eq("id", existing.id);
        return json({ ok: true, action: "updated", id: existing.id });
      }
    }

    // Anti-flood: check if FCM was fired within the flood window for this dedupeKey
    let suppressFCM = false;
    if (dedupeKey && priority === "high") {
      const windowStart = new Date(Date.now() - FLOOD_WINDOW_MS).toISOString();
      const { data: recentPush } = await sb.from("notifications")
        .select("id")
        .eq("user_id", userId)
        .eq("dedupe_key", dedupeKey)
        .not("last_push_at", "is", null)
        .gte("last_push_at", windowStart)
        .limit(1)
        .maybeSingle();
      if (recentPush) suppressFCM = true;
    }

    // INSERT new notification
    const { data: notif, error: insertErr } = await sb.from("notifications").insert({
      user_id:     userId,
      type,
      title,
      body:        bodyText,
      deep_link:   deepLink,
      priority,
      dedupe_key:  dedupeKey,
      notif_count: 1,
      notif_total: rollupAmount ?? 0,
    }).select("id").single();

    if (insertErr) return json({ error: insertErr.message }, 500);

    // FCM v1 push for high-priority (unless suppressed by flood window)
    let fcmResult: { status: number; body: string } | null = null;
    if (priority === "high" && !suppressFCM && (prefs?.push_enabled ?? true)) {
      const [tokensResult, unreadResult] = await Promise.all([
        sb.from("push_tokens")
          .select("token, platform")
          .eq("user_id", userId)
          .gte("last_seen", new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()),
        sb.from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .is("read_at", null),
      ]);

      const tokens      = tokensResult.data;
      const unreadCount = (unreadResult.count ?? 1);

      if (tokens?.length) {
        const results = await Promise.all(
          tokens.map(t => sendFCMv1(sb, t.token, title, bodyText ?? "", deepLink, priority, unreadCount))
        );
        fcmResult = results[0] ?? null;

        // Record when FCM was fired so the flood window check works across reads
        if (fcmResult && fcmResult.status >= 200 && fcmResult.status < 300 && notif?.id) {
          await sb.from("notifications")
            .update({ last_push_at: new Date().toISOString() })
            .eq("id", notif.id);
        }
      }
    }

    return json({ ok: true, action: "inserted", id: notif?.id, fcm: fcmResult });
  }

  return json({ error: "Unknown action" }, 400);
});
