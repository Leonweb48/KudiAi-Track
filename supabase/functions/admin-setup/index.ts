import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  try {
    // Check if SuperAdmin already has a linked auth account
    const { data: existing } = await sb
      .from("admin_users")
      .select("id, username, user_id")
      .eq("username", "SuperAdmin")
      .maybeSingle();

    if (!existing) {
      return json({ error: "SuperAdmin record not found in admin_users. Run the admin_system migration first." }, 400);
    }

    if (existing.user_id) {
      return json({ ok: true, message: "SuperAdmin auth account already set up.", user_id: existing.user_id });
    }

    // Create Supabase Auth user for SuperAdmin
    const { data: authUser, error: createErr } = await sb.auth.admin.createUser({
      email: "superadmin@kuditrack.app",
      password: "HI2026@pass1word",
      email_confirm: true,
      user_metadata: {
        account_type: "super_admin",
        username: "SuperAdmin",
      },
    });

    if (createErr) {
      // If user already exists, fetch and link them
      if (createErr.message?.includes("already") || createErr.message?.includes("duplicate")) {
        const { data: users } = await sb.auth.admin.listUsers();
        const found = users?.users?.find(u => u.email === "superadmin@kuditrack.app");
        if (found) {
          await sb.from("admin_users").update({ user_id: found.id }).eq("username", "SuperAdmin");
          return json({ ok: true, message: "Linked existing auth account.", user_id: found.id });
        }
      }
      return json({ error: createErr.message }, 500);
    }

    // Link the new auth user to the admin_users record
    await sb.from("admin_users")
      .update({ user_id: authUser.user.id })
      .eq("username", "SuperAdmin");

    return json({ ok: true, message: "SuperAdmin auth account created and linked.", user_id: authUser.user.id });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return json({ error: msg }, 500);
  }
});
