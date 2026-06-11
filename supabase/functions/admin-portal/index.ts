import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const PLAN_PRICES: Record<string, number> = { starter: 0, basic: 2000, professional: 5000, enterprise: 15000 };

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // ── Auth: verify caller is an active admin ────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const { data: adminRow } = await sb
    .from("admin_users")
    .select("id, username, role, can_create_admins")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (!adminRow) return json({ error: "Forbidden" }, 403);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* no body on some GETs */ }
  const { action } = body;

  try {

    // ── GET STATS ──────────────────────────────────────────────────────────
    if (action === "get-stats") {
      const [
        { count: businesses },
        { count: orgs },
        { count: staff },
        { count: ajoClients },
        { count: orgMembers },
        { data: activeSubs },
        { count: securityOpen },
        { count: errorsOpen },
      ] = await Promise.all([
        sb.from("profiles").select("*", { count: "exact", head: true }),
        sb.from("organizations").select("*", { count: "exact", head: true }).eq("status", "active"),
        sb.from("staff").select("*", { count: "exact", head: true }),
        sb.from("aso_clients").select("*", { count: "exact", head: true }),
        sb.from("org_members").select("*", { count: "exact", head: true }).eq("status", "active"),
        sb.from("subscriptions").select("plan").eq("status", "active"),
        sb.from("security_events").select("*", { count: "exact", head: true }).eq("resolved", false),
        sb.from("system_errors").select("*", { count: "exact", head: true }).eq("resolved", false),
      ]);

      const mrr = activeSubs?.reduce((s, r) => s + (PLAN_PRICES[r.plan] || 0), 0) || 0;
      const planCounts: Record<string, number> = {};
      activeSubs?.forEach(r => { planCounts[r.plan] = (planCounts[r.plan] || 0) + 1; });

      return json({
        businesses:   businesses  || 0,
        orgs:         orgs        || 0,
        staff:        staff       || 0,
        ajoClients:   ajoClients  || 0,
        orgMembers:   orgMembers  || 0,
        activeSubs:   activeSubs?.length || 0,
        mrr,
        planCounts,
        openAlerts:   (securityOpen || 0) + (errorsOpen || 0),
      });
    }

    // ── GET USERS ─────────────────────────────────────────────────────────
    if (action === "get-users") {
      const search = (body.search as string) || "";
      const page   = parseInt((body.page as string) || "1");
      const limit  = 25;
      const from   = (page - 1) * limit;

      let q = sb
        .from("profiles")
        .select("id, business_name, owner_name, email, phone, created_at, subscriptions(plan, status)", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, from + limit - 1);

      if (search) {
        q = q.or(`business_name.ilike.%${search}%,owner_name.ilike.%${search}%,email.ilike.%${search}%`);
      }

      const { data, count, error } = await q;
      if (error) return json({ error: error.message }, 500);
      return json({ users: data || [], total: count || 0, page, limit });
    }

    // ── GET SUBSCRIPTIONS ─────────────────────────────────────────────────
    if (action === "get-subscriptions") {
      const { data } = await sb
        .from("subscriptions")
        .select("id, user_id, plan, status, created_at, updated_at, profiles(business_name, owner_name, email)")
        .order("created_at", { ascending: false })
        .limit(100);
      return json({ subs: data || [] });
    }

    // ── GET ORGANIZATIONS ─────────────────────────────────────────────────
    if (action === "get-orgs") {
      const { data } = await sb
        .from("organizations")
        .select("id, name, type, status, member_count, wallet_balance, total_savings, created_at, profiles(business_name)")
        .order("created_at", { ascending: false })
        .limit(100);
      return json({ orgs: data || [] });
    }

    // ── GET STAFF ─────────────────────────────────────────────────────────
    if (action === "get-staff") {
      const { data } = await sb
        .from("staff")
        .select("id, full_name, email, role, status, created_at, profiles(business_name)")
        .order("created_at", { ascending: false })
        .limit(100);
      return json({ staff: data || [] });
    }

    // ── GET ASO CLIENTS ───────────────────────────────────────────────────
    if (action === "get-aso-clients") {
      const { data } = await sb
        .from("aso_clients")
        .select("id, full_name, email, status, current_balance, total_saved, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      return json({ clients: data || [] });
    }

    // ── GET SECURITY EVENTS ───────────────────────────────────────────────
    if (action === "get-security") {
      const { data } = await sb
        .from("security_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      return json({ events: data || [] });
    }

    // ── GET SYSTEM ERRORS ─────────────────────────────────────────────────
    if (action === "get-errors") {
      const { data } = await sb
        .from("system_errors")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      return json({ errors: data || [] });
    }

    // ── GET AUDIT LOG ─────────────────────────────────────────────────────
    if (action === "get-audit") {
      const { data } = await sb
        .from("admin_audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      return json({ log: data || [] });
    }

    // ── GET ADMINS ────────────────────────────────────────────────────────
    if (action === "get-admins") {
      const { data } = await sb
        .from("admin_users")
        .select("id, username, email, role, can_create_admins, is_active, last_login, created_at")
        .order("created_at", { ascending: true });
      return json({ admins: data || [] });
    }

    // ── GET BROADCASTS ────────────────────────────────────────────────────
    if (action === "get-broadcasts") {
      const { data } = await sb
        .from("admin_broadcasts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      return json({ broadcasts: data || [] });
    }

    // ── USER ACTION (suspend / activate / delete) ─────────────────────────
    if (action === "user-action") {
      const { target_id, user_action } = body as Record<string, string>;
      if (!target_id || !user_action) return json({ error: "target_id and user_action required" }, 400);

      if (user_action === "suspend") {
        await sb.auth.admin.updateUserById(target_id, { ban_duration: "876600h" });
      } else if (user_action === "activate") {
        await sb.auth.admin.updateUserById(target_id, { ban_duration: "none" });
      } else if (user_action === "delete") {
        await sb.auth.admin.deleteUser(target_id);
      } else {
        return json({ error: "Unknown user_action" }, 400);
      }

      await sb.from("admin_audit_log").insert({
        admin_id:       adminRow.id,
        admin_username: adminRow.username,
        action:         `user_${user_action}`,
        target_type:    "auth_user",
        target_id,
        details:        `Admin ${adminRow.username} performed ${user_action} on user ${target_id}`,
      });

      return json({ ok: true });
    }

    // ── RESOLVE SECURITY EVENT ────────────────────────────────────────────
    if (action === "resolve-security") {
      const { event_id } = body as Record<string, string>;
      if (!event_id) return json({ error: "event_id required" }, 400);
      await sb.from("security_events").update({ resolved: true }).eq("id", event_id);
      return json({ ok: true });
    }

    // ── RESOLVE ERROR ─────────────────────────────────────────────────────
    if (action === "resolve-error") {
      const { error_id } = body as Record<string, string>;
      if (!error_id) return json({ error: "error_id required" }, 400);
      await sb.from("system_errors").update({ resolved: true, resolved_at: new Date().toISOString() }).eq("id", error_id);
      return json({ ok: true });
    }

    // ── SEND BROADCAST ────────────────────────────────────────────────────
    if (action === "send-broadcast") {
      const b = body as Record<string, string>;
      if (!b.title || !b.message) return json({ error: "title and message required" }, 400);
      const { data } = await sb.from("admin_broadcasts").insert({
        title:   b.title,
        message: b.message,
        segment: b.segment || "all",
        channel: b.channel || "in_app",
        status:  "sent",
        sent_at: new Date().toISOString(),
      }).select().single();

      await sb.from("admin_audit_log").insert({
        admin_id:       adminRow.id,
        admin_username: adminRow.username,
        action:         "send_broadcast",
        target_type:    "broadcast",
        target_id:      data?.id,
        details:        `Broadcast "${b.title}" sent to ${b.segment || "all"} via ${b.channel || "in_app"}`,
      });

      return json({ ok: true, broadcast: data });
    }

    // ── CREATE ADMIN ──────────────────────────────────────────────────────
    if (action === "create-admin") {
      if (!adminRow.can_create_admins) return json({ error: "Insufficient permissions" }, 403);
      const b = body as Record<string, string>;
      if (!b.username || !b.password) return json({ error: "username and password required" }, 400);

      // Create Supabase Auth account
      const { data: newAuth, error: authErr } = await sb.auth.admin.createUser({
        email:         b.email || `${b.username.toLowerCase()}@kuditrack.app`,
        password:      b.password,
        email_confirm: true,
        user_metadata: { account_type: "super_admin", username: b.username },
      });
      if (authErr) return json({ error: authErr.message }, 500);

      // Hash password and insert into admin_users
      const { data: pwHash } = await sb.rpc("hash_admin_password", { p_password: b.password });
      const { error: insertErr } = await sb.from("admin_users").insert({
        username:          b.username,
        password_hash:     pwHash,
        email:             b.email || `${b.username.toLowerCase()}@kuditrack.app`,
        role:              b.role || "support_admin",
        can_create_admins: b.can_create_admins === "true",
        user_id:           newAuth.user.id,
      });
      if (insertErr) return json({ error: insertErr.message }, 500);

      await sb.from("admin_audit_log").insert({
        admin_id:       adminRow.id,
        admin_username: adminRow.username,
        action:         "create_admin",
        target_type:    "admin_user",
        details:        `Created admin account: ${b.username} (${b.role || "support_admin"})`,
      });

      return json({ ok: true });
    }

    // ── TOGGLE ADMIN STATUS ───────────────────────────────────────────────
    if (action === "toggle-admin") {
      if (!adminRow.can_create_admins) return json({ error: "Insufficient permissions" }, 403);
      const { target_admin_id, is_active } = body as Record<string, unknown>;
      if (!target_admin_id) return json({ error: "target_admin_id required" }, 400);
      await sb.from("admin_users").update({ is_active: Boolean(is_active) }).eq("id", target_admin_id);
      return json({ ok: true });
    }

    // ── LOG AUDIT ─────────────────────────────────────────────────────────
    if (action === "log-audit") {
      const b = body as Record<string, string>;
      await sb.from("admin_audit_log").insert({
        admin_id:       adminRow.id,
        admin_username: adminRow.username,
        action:         b.audit_action || "view",
        target_type:    b.target_type,
        target_id:      b.target_id,
        details:        b.details,
      });
      return json({ ok: true });
    }

    return json({ error: `Unknown action: ${action}` }, 400);

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return json({ error: msg }, 500);
  }
});
