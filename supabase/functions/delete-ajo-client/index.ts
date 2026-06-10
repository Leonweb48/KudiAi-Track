import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

    if (!supabaseUrl || !anonKey || !serviceRoleKey) throw new Error("Supabase secrets not configured");
    if (!authHeader) return json({ error: "Authentication required" }, 401);

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) return json({ error: "Invalid or expired session" }, 401);

    const { clientId } = await req.json();
    if (!clientId || typeof clientId !== "string") return json({ error: "clientId is required" }, 400);

    // Load the client
    const { data: client, error: clientErr } = await adminClient
      .from("aso_clients")
      .select("id, user_id, client_user_id, full_name")
      .eq("id", clientId)
      .maybeSingle();

    if (clientErr) throw clientErr;
    if (!client) return json({ error: "Ajo client not found" }, 404);

    // Verify caller is owner or active staff for owner
    const callerId = userData.user.id;
    if (client.user_id !== callerId) {
      const { data: staffRow } = await adminClient
        .from("staff")
        .select("id")
        .eq("user_id", callerId)
        .eq("owner_id", client.user_id)
        .eq("status", "active")
        .maybeSingle();
      if (!staffRow) return json({ error: "Not authorised to delete this client" }, 403);
    }

    // Delete contributions
    await adminClient.from("ajo_contributions").delete().eq("aso_client_id", clientId);

    // Delete the client record
    const { error: deleteErr } = await adminClient.from("aso_clients").delete().eq("id", clientId);
    if (deleteErr) throw deleteErr;

    // Delete auth user if they have one
    if (client.client_user_id) {
      const { error: authErr } = await adminClient.auth.admin.deleteUser(client.client_user_id);
      if (authErr) console.error("Auth user deletion failed (non-fatal):", authErr.message);
    }

    return json({ success: true, deleted: client.full_name });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    return json({ error: message }, 400);
  }
});
