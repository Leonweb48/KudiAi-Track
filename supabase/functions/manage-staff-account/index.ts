import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const authHeader = req.headers.get("Authorization");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error("Supabase function secrets are not configured");
    }
    if (!authHeader) return json({ error: "Authentication required" }, 401);

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } =
      await callerClient.auth.getUser();
    if (userError || !userData.user) {
      return json({ error: "Invalid or expired session" }, 401);
    }

    const { staffId, password } = await req.json();
    if (!staffId || typeof staffId !== "string") {
      return json({ error: "Staff member is required" }, 400);
    }
    if (typeof password !== "string" || password.length < 8) {
      return json({ error: "Password must be at least 8 characters" }, 400);
    }

    const { data: staff, error: staffError } = await adminClient
      .from("staff")
      .select("id, owner_id, user_id, email, full_name, status")
      .eq("id", staffId)
      .eq("owner_id", userData.user.id)
      .maybeSingle();

    if (staffError) throw staffError;
    if (!staff) return json({ error: "Staff member not found" }, 404);
    if (staff.status !== "active") {
      return json({ error: "Activate this staff member before enabling login" }, 400);
    }

    const userMetadata = {
      full_name: staff.full_name,
      account_type: "staff",
      staff_id: staff.id,
      owner_id: staff.owner_id,
      must_change_password: true,
    };

    let authUserId = staff.user_id;
    let created = false;

    if (authUserId) {
      const { error } = await adminClient.auth.admin.updateUserById(
        authUserId,
        { password, email_confirm: true, user_metadata: userMetadata },
      );
      if (error) throw error;
    } else {
      const { data, error } = await adminClient.auth.admin.createUser({
        email: staff.email,
        password,
        email_confirm: true,
        user_metadata: userMetadata,
      });
      if (error) {
        if (error.message.toLowerCase().includes("already")) {
          throw new Error(
            "This email already has an account. Use a different staff email.",
          );
        }
        throw error;
      }
      authUserId = data.user.id;
      created = true;

      const { error: linkError } = await adminClient
        .from("staff")
        .update({ user_id: authUserId })
        .eq("id", staff.id)
        .eq("owner_id", userData.user.id);

      if (linkError) {
        await adminClient.auth.admin.deleteUser(authUserId);
        throw linkError;
      }
    }

    return json({
      success: true,
      created,
      userId: authUserId,
      message: created
        ? "Staff login created"
        : "Staff password reset successfully",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    return json({ error: message }, 400);
  }
});
