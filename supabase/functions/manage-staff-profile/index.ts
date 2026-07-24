// manage-staff-profile — self-service profile actions for staff and managers.
// Actions: request_email_change, verify_email_change.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const EMAIL_TRIGGER_SECRET =
  Deno.env.get("EMAIL_TRIGGER_SECRET") ||
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  "";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

function genOtp(): string {
  const arr = new Uint8Array(4);
  crypto.getRandomValues(arr);
  // Map to 100000–999999 range without bias by using modulo on a large value
  const n = (arr[0] | (arr[1] << 8) | (arr[2] << 16) | (arr[3] << 24)) >>> 0;
  return String(100000 + (n % 900000));
}

async function fireEmail(event: string, data: Record<string, unknown>) {
  await fetch("https://admin.kudiai.app/api/public/email-trigger", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-trigger-secret": EMAIL_TRIGGER_SECRET,
    },
    body: JSON.stringify({ event, data }),
  }).catch(() => null);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl    = Deno.env.get("SUPABASE_URL");
  const anonKey        = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authHeader     = req.headers.get("Authorization");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "Supabase function secrets are not configured" }, 500);
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
  const authUserId = userData.user.id;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const action = String(body.action || "");

  // ── request_email_change ──────────────────────────────────────────────────
  if (action === "request_email_change") {
    const newEmail = String(body.new_email || "").trim().toLowerCase();
    if (!newEmail || !newEmail.includes("@")) {
      return json({ error: "A valid email address is required" }, 400);
    }

    // Ensure new email is not already used in auth
    const { data: existing } = await adminClient.auth.admin.listUsers();
    const alreadyTaken = existing?.users?.some(
      (u) => u.email?.toLowerCase() === newEmail && u.id !== authUserId,
    );
    if (alreadyTaken) {
      return json({ error: "This email address is already in use" }, 409);
    }

    // Get the staff row
    const { data: staffRow, error: staffErr } = await adminClient
      .from("staff")
      .select("id, full_name, email")
      .eq("user_id", authUserId)
      .eq("status", "active")
      .maybeSingle();

    if (staffErr || !staffRow) {
      return json({ error: "Active staff account not found" }, 404);
    }

    const otp = genOtp();
    const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min

    await adminClient.from("staff").update({
      email_change_pending:         newEmail,
      email_change_otp:             otp,
      email_change_otp_expires_at:  expires,
    }).eq("id", staffRow.id);

    // Send OTP to the NEW email address
    await fireEmail("staff_email_change_otp", {
      staff_name:  staffRow.full_name,
      staff_email: newEmail,
      otp_code:    otp,
    });

    return json({ ok: true });
  }

  // ── verify_email_change ───────────────────────────────────────────────────
  if (action === "verify_email_change") {
    const otp = String(body.otp || "").trim();
    if (!otp || otp.length !== 6) {
      return json({ error: "A 6-digit verification code is required" }, 400);
    }

    const { data: staffRow, error: staffErr } = await adminClient
      .from("staff")
      .select("id, owner_id, full_name, email, email_change_pending, email_change_otp, email_change_otp_expires_at")
      .eq("user_id", authUserId)
      .eq("status", "active")
      .maybeSingle();

    if (staffErr || !staffRow) {
      return json({ error: "Active staff account not found" }, 404);
    }
    if (!staffRow.email_change_otp || !staffRow.email_change_pending) {
      return json({ error: "No pending email change — request a new code first" }, 400);
    }
    if (staffRow.email_change_otp !== otp) {
      return json({ error: "Incorrect verification code" }, 400);
    }

    const expiry = staffRow.email_change_otp_expires_at
      ? new Date(staffRow.email_change_otp_expires_at)
      : null;
    if (!expiry || expiry < new Date()) {
      // Clear expired OTP
      await adminClient.from("staff").update({
        email_change_otp: null, email_change_otp_expires_at: null,
      }).eq("id", staffRow.id);
      return json({ error: "Verification code expired — request a new one" }, 400);
    }

    const newEmail = staffRow.email_change_pending;
    const oldEmail = staffRow.email;

    // Apply auth email change
    await adminClient.auth.admin.updateUserById(authUserId, { email: newEmail });

    // Apply staff table email change + clear OTP columns
    await adminClient.from("staff").update({
      email:                        newEmail,
      email_change_pending:         null,
      email_change_otp:             null,
      email_change_otp_expires_at:  null,
    }).eq("id", staffRow.id);

    // Audit log
    await adminClient.from("audit_logs").insert({
      staff_id: staffRow.id,
      owner_id: staffRow.owner_id,
      action:   "email_changed",
      details:  `${oldEmail} → ${newEmail}`,
      module:   "profile",
    });

    // Owner notification
    await adminClient.from("notifications").insert({
      user_id:    staffRow.owner_id,
      type:       "info",
      title:      "Staff Email Changed",
      body:       `${staffRow.full_name} changed their email to ${newEmail}`,
      priority:   "normal",
      dedupe_key: `email_change_${staffRow.id}_${Date.now()}`,
    }).select().maybeSingle().catch(() => null);

    return json({ ok: true, new_email: newEmail });
  }

  return json({ error: `Unknown action: ${action}` }, 400);
});
