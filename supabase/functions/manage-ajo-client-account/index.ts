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
    const supabaseUrl    = Deno.env.get("SUPABASE_URL");
    const anonKey        = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const authHeader     = req.headers.get("Authorization");

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

    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) {
      return json({ error: "Invalid or expired session" }, 401);
    }

    const { clientId, password } = await req.json();
    if (!clientId || typeof clientId !== "string") {
      return json({ error: "Client ID is required" }, 400);
    }
    if (typeof password !== "string" || password.length < 8) {
      return json({ error: "Password must be at least 8 characters" }, 400);
    }

    // Load the ajo client, then verify caller is the owner or active staff for the owner
    const { data: client, error: clientError } = await adminClient
      .from("aso_clients")
      .select("id, user_id, client_user_id, email, full_name")
      .eq("id", clientId)
      .maybeSingle();

    if (clientError) throw clientError;
    if (!client) return json({ error: "Ajo client not found" }, 404);

    const callerId = userData.user.id;
    if (client.user_id !== callerId) {
      // Not the owner — check if caller is active staff for this owner
      const { data: staffRow } = await adminClient
        .from("staff")
        .select("id")
        .eq("user_id", callerId)
        .eq("owner_id", client.user_id)
        .eq("status", "active")
        .maybeSingle();
      if (!staffRow) return json({ error: "Ajo client not found" }, 404);
    }
    if (!client.email) return json({ error: "Client email is required to create a login account" }, 400);

    const userMetadata = {
      full_name:            client.full_name,
      account_type:         "ajo_client",
      aso_client_id:        client.id,
      owner_id:             client.user_id,
      must_change_password: true,
    };

    let authUserId = client.client_user_id;
    let created    = false;

    if (authUserId) {
      const { error } = await adminClient.auth.admin.updateUserById(
        authUserId,
        { password, email_confirm: true, user_metadata: userMetadata },
      );
      if (error) throw error;
    } else {
      const { data, error } = await adminClient.auth.admin.createUser({
        email:         client.email,
        password,
        email_confirm: true,
        user_metadata: userMetadata,
      });
      if (error) {
        if (error.message.toLowerCase().includes("already")) {
          throw new Error(
            "This email already has an account. Use a different email for this client.",
          );
        }
        throw error;
      }
      authUserId = data.user.id;
      created    = true;

      const { error: linkError } = await adminClient
        .from("aso_clients")
        .update({ client_user_id: authUserId })
        .eq("id", client.id)
        .eq("user_id", client.user_id);

      if (linkError) {
        await adminClient.auth.admin.deleteUser(authUserId);
        throw linkError;
      }
    }

    if (created) {
      // Fire welcome email to client + notifications to staff + business owner
      const emailData: Record<string, string> = {
        client_name: client.full_name || "",
        client_email: client.email,
        membership_number: "", // populated below
      };
      try {
        const { data: freshClient } = await adminClient
          .from("aso_clients")
          .select("membership_number, staff_id, user_id")
          .eq("id", client.id)
          .maybeSingle();
        if (freshClient?.membership_number) emailData.membership_number = freshClient.membership_number;
        if (freshClient?.staff_id) {
          const { data: staffRow } = await adminClient
            .from("staff")
            .select("email, full_name")
            .eq("id", freshClient.staff_id)
            .maybeSingle();
          if (staffRow?.email) emailData.staff_email = staffRow.email;
        }
        const { data: owner } = await adminClient
          .from("profiles")
          .select("email, business_name")
          .eq("id", client.user_id)
          .maybeSingle();
        if (owner?.email) { emailData.owner_email = owner.email; emailData.owner_name = owner.business_name || ""; }
      } catch { /* email data lookup is non-fatal */ }

      fetch("https://kuditrack-admin.vercel.app/api/public/email-trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-trigger-secret": "kuditrack-email-trigger-2026-amaya" },
        body: JSON.stringify({ event: "ajo_client_registered", data: emailData }),
      }).catch(() => null);
    }

    return json({
      success: true,
      created,
      userId: authUserId,
      message: created ? "Client login created" : "Client password reset successfully",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    return json({ error: message }, 400);
  }
});
