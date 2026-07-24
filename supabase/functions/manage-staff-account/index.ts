// v2 — credentials-only email at registration; OTP sent on first login
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const EMAIL_TRIGGER_SECRET = Deno.env.get("EMAIL_TRIGGER_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

function genTempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const values = new Uint8Array(12);
  crypto.getRandomValues(values);
  return Array.from(values, n => chars[n % chars.length]).join("");
}

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

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
    const { data: userData, error: userError } = await adminClient.auth.getUser(jwt);
    if (userError || !userData.user) {
      return json({ error: "Invalid or expired session" }, 401);
    }

    const body = await req.json() as Record<string, unknown>;
    const action = (body.action as string) || "create";

    // ── verify-otp: logged-in staff member verifies their email OTP ──────
    if (action === "verify-otp") {
      const { otp_code } = body as { otp_code: string };
      if (!otp_code) return json({ error: "otp_code required" }, 400);

      const { data: staffRow } = await adminClient
        .from("staff")
        .select("id, otp_code, otp_expires_at")
        .eq("user_id", userData.user.id)
        .maybeSingle();

      if (!staffRow) return json({ error: "Staff account not found" }, 404);
      if (!staffRow.otp_code || staffRow.otp_code !== otp_code.trim()) {
        return json({ error: "Invalid verification code" }, 400);
      }
      if (staffRow.otp_expires_at && new Date() > new Date(staffRow.otp_expires_at)) {
        return json({ error: "Code has expired. Tap 'Resend' to get a new one." }, 400);
      }

      await adminClient.from("staff").update({ otp_code: null, otp_expires_at: null }).eq("id", staffRow.id);
      const { temp_password: _tp, ...restMeta } = userData.user.user_metadata || {};
      await adminClient.auth.admin.updateUserById(userData.user.id, {
        user_metadata: { ...restMeta, email_verified: true, staff_otp_verified: true },
      });

      return json({ success: true });
    }

    // ── resend-otp: regenerate and resend OTP to the logged-in staff member ──
    if (action === "resend-otp") {
      const { data: staffRow } = await adminClient
        .from("staff")
        .select("id, email, full_name")
        .eq("user_id", userData.user.id)
        .maybeSingle();

      if (!staffRow) return json({ error: "Staff account not found" }, 404);

      const otp = genOtp();
      const otpExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      await adminClient.from("staff").update({ otp_code: otp, otp_expires_at: otpExpiresAt }).eq("id", staffRow.id);

      await fireEmail("staff_otp_resend", {
        staff_name: staffRow.full_name || "",
        staff_email: staffRow.email,
        otp_code: otp,
      });

      return json({ success: true });
    }

    // ── create (default): business owner sets up a staff login ───────────
    const { staffId, password } = body as { staffId: string; password: string };
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
      full_name:            staff.full_name,
      account_type:         "staff",
      staff_id:             staff.id,
      owner_id:             staff.owner_id,
      must_change_password: true,
      email_verified:       false,
      staff_otp_verified:   false,
      temp_password:        password,
    };

    let authUserId = staff.user_id;
    let created    = false;

    if (authUserId) {
      const { error } = await adminClient.auth.admin.updateUserById(
        authUserId,
        { password, email_confirm: true, user_metadata: userMetadata },
      );
      if (error) throw error;
    } else {
      const { data, error } = await adminClient.auth.admin.createUser({
        email:         staff.email,
        password,
        email_confirm: true,
        user_metadata: userMetadata,
      });
      if (error) {
        if (error.message.toLowerCase().includes("already")) {
          throw new Error("This email already has an account. Use a different staff email.");
        }
        throw error;
      }
      authUserId = data.user.id;
      created    = true;

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

    // Send credentials-only email to staff; OTP is sent separately when they first log in
    const emailData: Record<string, string> = {
      staff_name:    staff.full_name || "",
      staff_email:   staff.email,
      role:          "Staff",
      temp_password: password,
    };
    try {
      const { data: owner } = await adminClient
        .from("profiles")
        .select("email, business_name")
        .eq("id", staff.owner_id)
        .maybeSingle();
      if (owner?.email) {
        emailData.owner_email    = owner.email;
        emailData.business_name  = owner.business_name || "";
      }
    } catch { /* non-fatal */ }

    await fireEmail("staff_credentials", emailData);

    // Push only for new accounts so the staff member knows they've been invited.
    // Password resets skip this — the staff member already knows about their account.
    if (created && authUserId) {
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/notify-send`, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""}`,
        },
        body: JSON.stringify({
          action:   "notify",
          userId:   authUserId,
          type:     "staff_invite",
          title:    "You've Been Invited",
          body:     `${emailData.business_name || "A business"} added you as Staff — tap to set up your account`,
          priority: "normal",
          deepLink: { tab: "me" },
          category: "permissions",
        }),
      }).catch(() => null);
    }

    return json({
      success: true,
      created,
      userId: authUserId,
      message: created ? "Staff login created" : "Staff password reset successfully",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    return json({ error: message }, 400);
  }
});
