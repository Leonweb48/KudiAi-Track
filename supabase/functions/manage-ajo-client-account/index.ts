import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const EMAIL_TRIGGER_SECRET = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

function genOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function fireEmail(event: string, data: Record<string, unknown>) {
  await fetch("https://admin.kudiai.app/api/public/email-trigger", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
    body: JSON.stringify({ event, data }),
  }).catch(() => null);
}

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

    const body = await req.json() as Record<string, unknown>;
    const action = (body.action as string) || "create";

    // ── verify-otp: logged-in ajo client verifies their email OTP ────────
    if (action === "verify-otp") {
      const { otp_code } = body as { otp_code: string };
      if (!otp_code) return json({ error: "otp_code required" }, 400);

      const { data: clientRow } = await adminClient
        .from("aso_clients")
        .select("id, otp_code, otp_expires_at")
        .eq("client_user_id", userData.user.id)
        .maybeSingle();

      if (!clientRow) return json({ error: "Client account not found" }, 404);
      if (!clientRow.otp_code || clientRow.otp_code !== otp_code.trim()) {
        return json({ error: "Invalid verification code" }, 400);
      }
      if (clientRow.otp_expires_at && new Date() > new Date(clientRow.otp_expires_at)) {
        return json({ error: "Code has expired. Tap 'Resend' to get a new one." }, 400);
      }

      await adminClient.from("aso_clients").update({ otp_code: null, otp_expires_at: null }).eq("id", clientRow.id);
      const { temp_password: _tp, ...restMeta } = userData.user.user_metadata || {};
      await adminClient.auth.admin.updateUserById(userData.user.id, {
        user_metadata: { ...restMeta, email_verified: true },
      });

      return json({ success: true });
    }

    // ── resend-otp: regenerate and resend OTP to the logged-in ajo client ──
    if (action === "resend-otp") {
      const { data: clientRow } = await adminClient
        .from("aso_clients")
        .select("id, email, full_name")
        .eq("client_user_id", userData.user.id)
        .maybeSingle();

      if (!clientRow) return json({ error: "Client account not found" }, 404);

      const otp = genOtp();
      const otpExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      await adminClient.from("aso_clients").update({ otp_code: otp, otp_expires_at: otpExpiresAt }).eq("id", clientRow.id);

      await fireEmail("ajo_client_otp_resend", {
        client_name:  clientRow.full_name || "",
        client_email: clientRow.email,
        otp_code:     otp,
      });

      return json({ success: true });
    }

    // ── create (default): business owner sets up an ajo client login ──────
    const { clientId, password } = body as { clientId: string; password: string };
    if (!clientId || typeof clientId !== "string") {
      return json({ error: "Client ID is required" }, 400);
    }
    if (typeof password !== "string" || password.length < 8) {
      return json({ error: "Password must be at least 8 characters" }, 400);
    }

    const { data: client, error: clientError } = await adminClient
      .from("aso_clients")
      .select("id, user_id, client_user_id, email, full_name")
      .eq("id", clientId)
      .maybeSingle();

    if (clientError) throw clientError;
    if (!client) return json({ error: "Ajo client not found" }, 404);

    const callerId = userData.user.id;
    if (client.user_id !== callerId) {
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
      email_verified:       false,
      temp_password:        password,
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
          throw new Error("This email already has an account. Use a different email for this client.");
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

    // Send credentials-only email; OTP is generated and sent when client first logs in
    const emailData: Record<string, string> = {
      client_name:       client.full_name || "",
      client_email:      client.email,
      membership_number: "",
      temp_password:     password,
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
    } catch { /* non-fatal */ }

    await fireEmail("ajo_client_credentials", emailData);

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
