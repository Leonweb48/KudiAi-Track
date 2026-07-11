import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EMAIL_TRIGGER_SECRET = Deno.env.get("EMAIL_TRIGGER_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const ORG_SELECT = `id, owner_id, portal_user_id, name, type, reg_number, description, purpose, vision, mission,
  address, state_name, lga, phone, email, website, logo_url,
  social_instagram, social_facebook, social_twitter, date_established, registration_fee,
  wallet_balance, total_savings, total_loans_out, interest_earned, member_count, status, created_at,
  bank_code, account_number, account_name, paystack_subaccount_code, paystack_subaccount_id, percentage_charge`;

const MEMBER_SELECT = `id, org_id, membership_id, full_name, email, phone, role, status,
  profile_image_url, address, occupation, gender, date_of_birth, joined_date,
  next_of_kin, next_of_kin_phone, user_id,
  privacy_balance, privacy_contributions, privacy_activities,
  suspended_at, suspension_reason, savings_balance, created_at`;

function genTempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const values = new Uint8Array(12);
  crypto.getRandomValues(values);
  return Array.from(values, n => chars[n % chars.length]).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const { action } = body;

  // Fire-and-forget in-app notification insert (bypasses RLS via service role)
  const insertNotif = (
    orgId: string,
    recipientType: "member" | "org",
    type: "info" | "success" | "warning" | "error" | "alert",
    category: string,
    title: string,
    bodyText: string,
    actionTab?: string | null,
    recipientId?: string | null,
  ) => {
    sb.from("coop_notifications").insert({
      org_id: orgId, recipient_id: recipientId || null,
      recipient_type: recipientType, type, category,
      title, body: bodyText, action_tab: actionTab || null,
    }).then(() => null).catch(() => null);
  };

  try {

    // ══════════════════════════════════════════════════
    //  ORGANIZATION MANAGEMENT
    // ══════════════════════════════════════════════════

    // ── Setup org portal login (business owner grants org its own credentials) ─
    if (action === "setup-org-portal") {
      const { org_id, owner_id } = body as { org_id: string; owner_id: string };
      if (!org_id || !owner_id) return json({ error: "org_id and owner_id required" }, 400);

      const { data: org } = await sb.from("organizations")
        .select("id, name, email, owner_id, portal_user_id, reg_number, type")
        .eq("id", org_id).maybeSingle();
      if (!org) return json({ error: "Organisation not found" }, 404);
      if (org.owner_id !== owner_id) return json({ error: "Unauthorized" }, 403);
      if (!org.email) return json({ error: "Please add an organisation email in Settings first" }, 400);

      const tempPwd = genTempPassword();

      // Remove old portal user if it exists
      if (org.portal_user_id) {
        await sb.auth.admin.deleteUser(org.portal_user_id).catch(() => null);
      }

      const freshMeta = {
        account_type:         "organisation",
        org_id,
        org_name:             org.name,
        must_change_password: true,
        email_verified:       false,
        org_otp_verified:     false,
        temp_password:        tempPwd,
      };

      const { data: authData, error: authError } = await sb.auth.admin.createUser({
        email: org.email,
        password: tempPwd,
        email_confirm: true,
        user_metadata: freshMeta,
      });
      if (authError) return json({ error: authError.message }, 400);

      // Hard-reset the OTP flag after creation — email_confirm:true internal
      // processing can sometimes merge/overwrite user_metadata in Supabase.
      // This ensures org_otp_verified is definitively false for every fresh account.
      await sb.auth.admin.updateUserById(authData.user.id, {
        user_metadata: freshMeta,
      }).catch(() => null);

      const { error: linkError } = await sb.from("organizations").update({
        portal_user_id: authData.user.id,
        status: "active",
      }).eq("id", org_id);
      if (linkError) {
        await sb.auth.admin.deleteUser(authData.user.id).catch(() => null);
        return json({ error: `Portal user created but could not be linked: ${linkError.message}` }, 400);
      }

      // Send credentials-only email; OTP is generated and sent when org first logs in
      await fetch("https://admin.kudiai.app/api/public/email-trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
        body: JSON.stringify({
          event: "org_portal_credentials",
          data: { org_name: org.name, email: org.email, temp_password: tempPwd, reg_number: org.reg_number },
        }),
      }).catch(() => null);

      return json({ success: true, email: org.email, temp_password: tempPwd });
    }

    // ── verify-org-otp: logged-in org verifies their email OTP ──────────
    if (action === "verify-org-otp") {
      const authHeader = req.headers.get("Authorization");
      const jwt = authHeader?.replace("Bearer ", "") || "";
      const { data: { user }, error: jwtErr } = await sb.auth.getUser(jwt);
      if (!user || jwtErr) return json({ error: "Not authenticated" }, 401);

      const { otp_code } = body as { otp_code: string };
      if (!otp_code) return json({ error: "otp_code required" }, 400);

      const orgId = user.user_metadata?.org_id as string | undefined;
      if (!orgId) return json({ error: "Organisation not found" }, 404);

      const { data: orgRow } = await sb.from("organizations")
        .select("id, otp_code, otp_expires_at")
        .eq("id", orgId)
        .maybeSingle();

      if (!orgRow) return json({ error: "Organisation not found" }, 404);
      if (!orgRow.otp_code || orgRow.otp_code !== otp_code.trim()) {
        return json({ error: "Invalid verification code" }, 400);
      }
      if (orgRow.otp_expires_at && new Date() > new Date(orgRow.otp_expires_at)) {
        return json({ error: "Code has expired. Tap 'Resend' to get a new one." }, 400);
      }

      await sb.from("organizations").update({ otp_code: null, otp_expires_at: null }).eq("id", orgRow.id);
      const { temp_password: _tp, ...restMeta } = user.user_metadata || {};
      await sb.auth.admin.updateUserById(user.id, {
        user_metadata: { ...restMeta, email_verified: true, org_otp_verified: true },
      });

      return json({ success: true });
    }

    // ── resend-org-otp: regenerate and resend OTP to the logged-in org ───
    if (action === "resend-org-otp") {
      const authHeader = req.headers.get("Authorization");
      const jwt = authHeader?.replace("Bearer ", "") || "";
      const { data: { user }, error: jwtErr } = await sb.auth.getUser(jwt);
      if (!user || jwtErr) return json({ error: "Not authenticated" }, 401);

      const orgId = user.user_metadata?.org_id as string | undefined;
      if (!orgId) return json({ error: "Organisation not found" }, 404);

      const { data: orgRow } = await sb.from("organizations")
        .select("id, name, email")
        .eq("id", orgId)
        .maybeSingle();

      if (!orgRow) return json({ error: "Organisation not found" }, 404);

      const otp = String(Math.floor(100000 + Math.random() * 900000));
      const otpExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      await sb.from("organizations").update({ otp_code: otp, otp_expires_at: otpExpiresAt }).eq("id", orgRow.id);

      await fetch("https://admin.kudiai.app/api/public/email-trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
        body: JSON.stringify({
          event: "org_portal_otp_resend",
          data: { org_name: orgRow.name, email: orgRow.email, otp_code: otp },
        }),
      }).catch(() => null);

      return json({ success: true });
    }

    if (action === "delete-org") {
      const { org_id, owner_id } = body as { org_id: string; owner_id: string };
      if (!org_id || !owner_id) return json({ error: "org_id and owner_id required" }, 400);

      const { data: org } = await sb.from("organizations")
        .select("id, owner_id, portal_user_id").eq("id", org_id).maybeSingle();
      if (!org) return json({ error: "Organisation not found" }, 404);
      if (org.owner_id !== owner_id) return json({ error: "Unauthorized" }, 403);

      // Delete portal auth user if one exists
      if (org.portal_user_id) {
        await sb.auth.admin.deleteUser(org.portal_user_id).catch(() => null);
      }

      // Delete org_members first — the sync_org_member_count AFTER DELETE trigger on
      // org_members tries to UPDATE organizations. If org_members cascade-delete fires
      // AFTER the org row is already staged for deletion the UPDATE can fail in some
      // Postgres versions. Pre-deleting members here lets the trigger run while the org
      // row is still fully alive, then the subsequent org delete cascades cleanly.
      await sb.from("org_members").delete().eq("org_id", org_id);

      // Delete org — remaining cascades (notifications, savings, loans, etc.) run cleanly.
      const { error } = await sb.from("organizations").delete().eq("id", org_id);
      if (error) return json({ error: error.message }, 400);

      return json({ success: true });
    }

    if (action === "create-org") {
      const b = body as Record<string, string>;
      if (!b.owner_id || !b.name || !b.type) return json({ error: "owner_id, name, type required" }, 400);
      const PREFIX: Record<string,string> = {
        cooperative:"COOP", market_association:"MKT", church:"CHU", ngo:"NGO",
        youth_group:"YTH", savings_group:"SAV", community_group:"COM",
        professional_association:"PRO", savings_club:"SCL",
      };
      const reg_number = `${PREFIX[b.type] || "ORG"}-${Date.now().toString(36).toUpperCase().slice(-6)}`;
      const { data: org, error } = await sb.from("organizations")
        .insert({ owner_id: b.owner_id, name: b.name, type: b.type, reg_number,
          description: b.description, purpose: b.purpose, vision: b.vision, mission: b.mission,
          address: b.address, state_name: b.state_name, lga: b.lga,
          phone: b.phone, email: b.email, website: b.website,
          date_established: b.date_established || null,
          registration_fee: parseFloat(b.registration_fee || "0") || 0,
          status: "active",
        })
        .select(ORG_SELECT).single();
      if (error) return json({ error: error.message }, 400);
      return json({ org });
    }

    if (action === "get-orgs") {
      const { owner_id } = body as { owner_id: string };
      const { data: orgs } = await sb.from("organizations")
        .select(ORG_SELECT).eq("owner_id", owner_id).order("created_at", { ascending: false });
      return json({ orgs: orgs || [] });
    }

    if (action === "get-org") {
      const { org_id } = body as { org_id: string };
      const { data: org } = await sb.from("organizations").select(ORG_SELECT).eq("id", org_id).maybeSingle();
      if (!org) return json({ error: "Not found" }, 404);
      return json({ org });
    }

    if (action === "update-org") {
      const { org_id, ...fields } = body as Record<string, unknown>;
      const allowed = ["name","description","purpose","vision","mission","address","state_name","lga",
                       "phone","email","website","logo_url","social_instagram","social_facebook",
                       "social_twitter","date_established","registration_fee","status"];
      const update: Record<string, unknown> = {};
      for (const k of allowed) if (fields[k] !== undefined) update[k] = fields[k];
      const { data: org, error } = await sb.from("organizations").update(update)
        .eq("id", org_id).select(ORG_SELECT).single();
      if (error) return json({ error: error.message }, 400);
      return json({ org });
    }

    // ── Leaders ──────────────────────────────────────────

    if (action === "get-leaders") {
      const { org_id } = body as { org_id: string };
      const { data: leaders } = await sb.from("org_leaders").select("*")
        .eq("org_id", org_id).order("sort_order").order("created_at");
      return json({ leaders: leaders || [] });
    }

    if (action === "add-leader") {
      const { org_id, name, position, phone, email, sort_order } = body as Record<string, unknown>;
      if (!org_id || !name || !position) return json({ error: "org_id, name, position required" }, 400);
      const { data: leader, error } = await sb.from("org_leaders")
        .insert({ org_id, name, position, phone: phone || null, email: email || null,
          sort_order: parseInt(String(sort_order || 0)) })
        .select("*").single();
      if (error) return json({ error: error.message }, 400);
      return json({ leader });
    }

    if (action === "update-leader") {
      const { leader_id, name, position, phone, email, sort_order } = body as Record<string, unknown>;
      const { data: leader, error } = await sb.from("org_leaders")
        .update({ name, position, phone: phone || null, email: email || null,
          sort_order: parseInt(String(sort_order || 0)) })
        .eq("id", leader_id).select("*").single();
      if (error) return json({ error: error.message }, 400);
      return json({ leader });
    }

    if (action === "delete-leader") {
      const { leader_id } = body as { leader_id: string };
      await sb.from("org_leaders").delete().eq("id", leader_id);
      return json({ success: true });
    }

    // ══════════════════════════════════════════════════
    //  MEMBER MANAGEMENT
    // ══════════════════════════════════════════════════

    if (action === "add-member") {
      const b = body as Record<string, string>;
      if (!b.org_id || !b.full_name || !b.email) return json({ error: "org_id, full_name and email required" }, 400);
      // Count ALL members (including removed) so removed IDs are never reused
      const { count } = await sb.from("org_members").select("id", { count: "exact", head: true })
        .eq("org_id", b.org_id);
      const seq = String((count || 0) + 1).padStart(4, "0");
      const { data: orgRow } = await sb.from("organizations").select("name,reg_number").eq("id", b.org_id).single();
      const prefix = (orgRow?.reg_number || "ORG").split("-")[0];
      const membership_id = `${prefix}-${seq}`;
      const { data: member, error } = await sb.from("org_members")
        .insert({ org_id: b.org_id, membership_id, full_name: b.full_name,
          email: b.email, phone: b.phone || null, role: b.role || "member",
          address: b.address || null, occupation: b.occupation || null,
          gender: b.gender || null, date_of_birth: b.date_of_birth || null,
          joined_date: b.joined_date || null,
          next_of_kin: b.next_of_kin || null,
          next_of_kin_phone: b.next_of_kin_phone || null,
        })
        .select(MEMBER_SELECT).single();
      if (error) return json({ error: error.message }, 400);
      await sb.from("organizations").update({ member_count: (count || 0) + 1 }).eq("id", b.org_id);

      // Create Supabase Auth account. email_confirm: true lets member sign in immediately
      // with the temp password. member_otp_verified: false (our custom flag, never auto-set
      // by Supabase) controls the in-app OTP step — avoids collision with email_confirm.
      const temp_password = genTempPassword();
      const memberMeta = {
        account_type: "org_member",
        org_member_id: member.id,
        org_id: b.org_id,
        must_change_password: true,
        email_verified: false,
        member_otp_verified: false,
        full_name: b.full_name,
        temp_password, // shown on OTP screen; cleared after email verification
      };
      const { data: authData, error: authErr } = await sb.auth.admin.createUser({
        email: b.email,
        password: temp_password,
        user_metadata: memberMeta,
        email_confirm: true,
      });
      if (authErr) {
        return json({ member, temp_password: null, auth_error: authErr.message });
      }
      if (authData?.user) {
        // Hard-reset: email_confirm:true can re-merge metadata, overwriting member_otp_verified.
        await sb.auth.admin.updateUserById(authData.user.id, {
          user_metadata: memberMeta,
        }).catch(() => null);
        await sb.from("org_members").update({ user_id: authData.user.id }).eq("id", member.id);
        (member as Record<string, unknown>).user_id = authData.user.id;
      }
      // Fire credentials-only email to member + notification to org owner; OTP sent on first login
      if (b.email) {
        let orgOwnerEmail = "";
        const { data: orgOwnerRow } = await sb
          .from("organizations").select("owner_id, email").eq("id", b.org_id).maybeSingle();
        if (orgOwnerRow?.owner_id) {
          const { data: ownerProfile } = await sb
            .from("profiles").select("email").eq("id", orgOwnerRow.owner_id).maybeSingle();
          orgOwnerEmail = ownerProfile?.email || "";
          if (!orgOwnerEmail && orgOwnerRow.email) orgOwnerEmail = orgOwnerRow.email;
          if (!orgOwnerEmail) {
            const { data: authUser } = await sb.auth.admin.getUserById(orgOwnerRow.owner_id);
            orgOwnerEmail = authUser?.user?.email || "";
          }
        }
        await fetch("https://admin.kudiai.app/api/public/email-trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
          body: JSON.stringify({
            event: "org_member_credentials",
            data: {
              member_name: b.full_name,
              member_email: b.email,
              org_name: orgRow?.name || "",
              membership_id,
              role: b.role || "member",
              temp_password,
              owner_email: orgOwnerEmail,
            },
          }),
        }).catch(() => null);
      }

      return json({ member, temp_password });
    }

    // Called by the logged-in member from the OTP verification screen.
    // Verifies the OTP stored in org_members, then marks email_verified: true in user metadata.
    if (action === "verify-member-otp") {
      const authHeader = req.headers.get("Authorization");
      const jwt = authHeader?.replace("Bearer ", "") || "";
      const { data: { user }, error: jwtErr } = await sb.auth.getUser(jwt);
      if (!user || jwtErr) return json({ error: "Not authenticated" }, 401);

      const { otp_code } = body as { otp_code: string };
      if (!otp_code) return json({ error: "otp_code required" }, 400);

      const { data: member } = await sb.from("org_members")
        .select("id, otp_code, otp_expires_at")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!member) return json({ error: "Member account not found" }, 404);
      if (!member.otp_code || member.otp_code !== otp_code.trim()) {
        return json({ error: "Invalid verification code" }, 400);
      }
      if (member.otp_expires_at && new Date() > new Date(member.otp_expires_at)) {
        return json({ error: "Code has expired. Tap 'Resend' to get a new one." }, 400);
      }

      // Clear OTP and mark email as verified; also remove temp_password from metadata
      await sb.from("org_members").update({ otp_code: null, otp_expires_at: null }).eq("id", member.id);
      const { temp_password: _tp, ...restMeta } = user.user_metadata || {};
      await sb.auth.admin.updateUserById(user.id, {
        user_metadata: { ...restMeta, email_verified: true, member_otp_verified: true },
      });

      return json({ success: true });
    }

    // Called by the admin during registration to verify the OTP sent to the member's email.
    // Sets email_verified: true on the member's auth account so they skip the OTP screen on login.
    if (action === "verify-member-registration-otp") {
      const { member_id, otp_code } = body as { member_id: string; otp_code: string };
      if (!member_id || !otp_code) return json({ error: "member_id and otp_code required" }, 400);

      const { data: member } = await sb.from("org_members")
        .select("id, user_id, otp_code, otp_expires_at")
        .eq("id", member_id)
        .maybeSingle();

      if (!member) return json({ error: "Member not found" }, 404);
      if (!member.otp_code || member.otp_code !== otp_code.trim()) {
        return json({ error: "Invalid verification code" }, 400);
      }
      if (member.otp_expires_at && new Date() > new Date(member.otp_expires_at)) {
        return json({ error: "Code has expired. Tap 'Resend' to get a new one." }, 400);
      }

      // Admin-side check: just confirm the code is correct. Do NOT mark email_verified or
      // clear the OTP — the member must verify themselves on their first login.
      return json({ success: true });
    }

    // Called by the admin during registration to resend the OTP to the member's email.
    if (action === "resend-registration-otp") {
      const { member_id } = body as { member_id: string };
      if (!member_id) return json({ error: "member_id required" }, 400);

      const { data: member } = await sb.from("org_members")
        .select("id, email, full_name, org_id")
        .eq("id", member_id)
        .maybeSingle();
      if (!member) return json({ error: "Member not found" }, 404);

      const otp = String(Math.floor(100000 + Math.random() * 900000));
      const otpExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      await sb.from("org_members").update({ otp_code: otp, otp_expires_at: otpExpiresAt }).eq("id", member.id);

      const { data: orgRow } = await sb.from("organizations").select("name").eq("id", member.org_id).maybeSingle();

      await fetch("https://admin.kudiai.app/api/public/email-trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
        body: JSON.stringify({
          event: "org_member_otp_resend",
          data: { member_name: member.full_name, member_email: member.email, org_name: orgRow?.name || "", otp_code: otp },
        }),
      }).catch(() => null);

      return json({ success: true });
    }

    // Called by the logged-in member to get a fresh OTP sent to their email.
    if (action === "resend-member-otp") {
      const authHeader = req.headers.get("Authorization");
      const jwt = authHeader?.replace("Bearer ", "") || "";
      const { data: { user }, error: jwtErr } = await sb.auth.getUser(jwt);
      if (!user || jwtErr) return json({ error: "Not authenticated" }, 401);

      const { data: member } = await sb.from("org_members")
        .select("id, email, full_name, org_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!member) return json({ error: "Member not found" }, 404);

      const otp = String(Math.floor(100000 + Math.random() * 900000));
      const otpExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      await sb.from("org_members").update({ otp_code: otp, otp_expires_at: otpExpiresAt }).eq("id", member.id);

      const { data: orgRow } = await sb.from("organizations").select("name").eq("id", member.org_id).maybeSingle();

      await fetch("https://admin.kudiai.app/api/public/email-trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
        body: JSON.stringify({
          event: "org_member_otp_resend",
          data: {
            member_name: member.full_name,
            member_email: member.email,
            org_name: orgRow?.name || "",
            otp_code: otp,
          },
        }),
      }).catch(() => null);

      return json({ success: true });
    }

    if (action === "get-members") {
      const { org_id, include_removed } = body as { org_id: string; include_removed?: boolean };
      let q = sb.from("org_members").select(MEMBER_SELECT).eq("org_id", org_id);
      if (!include_removed) q = q.neq("status", "removed");
      const { data: members } = await q.order("full_name");
      return json({ members: members || [] });
    }

    if (action === "get-member") {
      const { member_id } = body as { member_id: string };
      const { data: member } = await sb.from("org_members").select(MEMBER_SELECT).eq("id", member_id).maybeSingle();
      if (!member) return json({ error: "Not found" }, 404);
      return json({ member });
    }

    if (action === "update-member") {
      const { member_id, org_id, ...fields } = body as Record<string, unknown>;
      const allowed = ["full_name","email","phone","role","status","address","occupation",
                       "gender","date_of_birth","joined_date","next_of_kin","next_of_kin_phone",
                       "suspension_reason","privacy_balance","privacy_contributions",
                       "privacy_activities","portal_pin"];
      const update: Record<string, unknown> = {};
      for (const k of allowed) if (fields[k] !== undefined) update[k] = fields[k];
      if (update.status === "suspended") update.suspended_at = new Date().toISOString();
      if (update.status === "removed")   update.removed_at   = new Date().toISOString();
      if (update.status === "active")  { update.suspended_at = null; update.suspension_reason = null; }
      const { data: member, error } = await sb.from("org_members").update(update)
        .eq("id", member_id).select(MEMBER_SELECT).single();
      if (error) return json({ error: error.message }, 400);
      if (update.status && org_id) {
        const { count } = await sb.from("org_members").select("id", { count: "exact", head: true })
          .eq("org_id", org_id).eq("status", "active");
        await sb.from("organizations").update({ member_count: count || 0 }).eq("id", org_id);
      }
      return json({ member });
    }

    if (action === "reset-member-pin") {
      const { member_id, org_id } = body as { member_id: string; org_id: string };
      if (!member_id || !org_id) return json({ error: "member_id and org_id required" }, 400);
      const new_pin = String(Math.floor(1000 + Math.random() * 9000));
      await sb.from("org_members")
        .update({ portal_pin: new_pin })
        .eq("id", member_id).eq("org_id", org_id);
      return json({ new_pin });
    }

    if (action === "reset-member-password") {
      const { member_id, org_id } = body as { member_id: string; org_id: string };
      if (!member_id || !org_id) return json({ error: "member_id and org_id required" }, 400);
      const { data: m } = await sb.from("org_members")
        .select("user_id, email, full_name").eq("id", member_id).eq("org_id", org_id).single();
      if (!m?.user_id) return json({ error: "This member has no login account" }, 400);
      const temp_password = genTempPassword();
      // Fetch current metadata to preserve account_type and email_verified
      const { data: authUser } = await sb.auth.admin.getUserById(m.user_id as string);
      const existingMeta = authUser?.user?.user_metadata || {};
      // Generate a fresh OTP so the member must verify email before accessing the portal
      const resetOtp = String(Math.floor(100000 + Math.random() * 900000));
      const resetOtpExpiry = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      await sb.from("org_members").update({ otp_code: resetOtp, otp_expires_at: resetOtpExpiry }).eq("id", member_id);

      const { error } = await sb.auth.admin.updateUserById(m.user_id as string, {
        password: temp_password,
        email_confirm: true,
        user_metadata: {
          ...existingMeta,
          account_type: "org_member",
          must_change_password: true,
          email_verified: false,
          member_otp_verified: false, // force OTP re-verification on next login
          temp_password, // shown on OTP screen; cleared after email verification
        },
      });
      if (error) return json({ error: error.message }, 400);

      // Send OTP to member's email
      await fetch("https://admin.kudiai.app/api/public/email-trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
        body: JSON.stringify({
          event: "org_member_otp_resend",
          data: { member_name: m.full_name, member_email: m.email, otp_code: resetOtp },
        }),
      }).catch(() => null);

      return json({ temp_password, email: m.email });
    }

    if (action === "delete-member") {
      const { member_id, org_id } = body as { member_id: string; org_id: string };
      // Fetch user_id before removal so we can delete the auth account
      const { data: memberRow } = await sb.from("org_members")
        .select("user_id").eq("id", member_id).eq("org_id", org_id).maybeSingle();
      await sb.from("org_members").update({ status: "removed", removed_at: new Date().toISOString() })
        .eq("id", member_id).eq("org_id", org_id);
      const { count } = await sb.from("org_members").select("id", { count: "exact", head: true })
        .eq("org_id", org_id).eq("status", "active");
      await sb.from("organizations").update({ member_count: count || 0 }).eq("id", org_id);
      // Delete the Supabase Auth account so the member can no longer sign in
      if (memberRow?.user_id) {
        await sb.auth.admin.deleteUser(memberRow.user_id as string).catch(() => null);
      }
      return json({ success: true });
    }

    if (action === "get-member-directory") {
      const { org_id } = body as { org_id: string };
      const { data: members } = await sb.from("org_members")
        .select("id, membership_id, full_name, role, status, profile_image_url, phone, email, occupation, gender, joined_date, privacy_balance, privacy_contributions, privacy_activities, savings_balance")
        .eq("org_id", org_id).eq("status", "active").order("full_name");
      return json({ members: members || [] });
    }

    // ══════════════════════════════════════════════════
    //  CONTRIBUTION PROGRAMS
    // ══════════════════════════════════════════════════

    if (action === "get-programs") {
      const { org_id } = body as { org_id: string };
      const { data: programs } = await sb.from("org_contribution_programs").select("*")
        .eq("org_id", org_id).order("created_at", { ascending: false });

      const result = await Promise.all((programs || []).map(async (p: Record<string, unknown>) => {
        const { data: stats } = await sb.from("org_savings")
          .select("amount")
          .eq("org_id", org_id)
          .eq("program_id", p.id)
          .eq("type", "deposit");
        const total = (stats || []).reduce((s: number, r: { amount: number }) => s + (r.amount || 0), 0);
        return { ...p, total_collected: total };
      }));

      return json({ programs: result });
    }

    if (action === "add-program") {
      const { org_id, name, description, contribution_type, amount, frequency, due_day, target_amount } =
        body as Record<string, unknown>;
      if (!org_id || !name) return json({ error: "org_id and name required" }, 400);
      const { data: program, error } = await sb.from("org_contribution_programs")
        .insert({ org_id, name, description: description || null,
          contribution_type: contribution_type || "fixed",
          amount: parseFloat(String(amount || 0)),
          frequency: frequency || "monthly",
          due_day: due_day ? parseInt(String(due_day)) : null,
          target_amount: target_amount ? parseFloat(String(target_amount)) : null,
        })
        .select("*").single();
      if (error) return json({ error: error.message }, 400);

      // Notify org owner + all active members about the new program
      const { data: progOrg } = await sb.from("organizations").select("name,owner_id").eq("id", org_id).maybeSingle();
      const { data: progMembers } = await sb.from("org_members")
        .select("id,full_name,email").eq("org_id", org_id).eq("status", "active");
      let progOwnerEmail = "";
      if (progOrg?.owner_id) {
        const { data: ownerP } = await sb.from("profiles").select("email").eq("id", progOrg.owner_id).maybeSingle();
        progOwnerEmail = ownerP?.email || "";
      }
      const emailPayload = {
        org_name:          progOrg?.name || "",
        owner_email:       progOwnerEmail,
        program_name:      String(name),
        description:       String(description || ""),
        contribution_type: String(contribution_type || "fixed"),
        amount:            parseFloat(String(amount || 0)),
        frequency:         String(frequency || "monthly"),
        due_day:           due_day ? parseInt(String(due_day)) : null,
        target_amount:     target_amount ? parseFloat(String(target_amount)) : null,
        members:           (progMembers || []).map((m: { id: string; full_name: string; email: string }) => ({ name: m.full_name, email: m.email })),
      };
      await fetch("https://admin.kudiai.app/api/public/email-trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
        body: JSON.stringify({ event: "org_new_program", data: emailPayload }),
      }).catch(() => null);
      // In-app: notify each active member
      const progAmtStr = contribution_type === "fixed"
        ? `₦${Number(amount || 0).toLocaleString("en-NG")} required`
        : "Voluntary contributions";
      const freqLabel = ({ daily:"Daily", weekly:"Weekly", monthly:"Monthly", quarterly:"Quarterly", annual:"Annual", one_time:"One-time" } as Record<string, string>)[String(frequency)] || String(frequency);
      for (const m of (progMembers || []) as Array<{ id: string; full_name: string; email: string }>) {
        if (!m.id) continue;
        insertNotif(String(org_id), "member", "info", "program",
          `New Program: ${String(name)}`,
          `${freqLabel} — ${progAmtStr}${description ? ". " + String(description).slice(0, 60) : ""}`,
          "contributions", m.id);
      }

      return json({ program });
    }

    if (action === "update-program") {
      const { program_id, ...fields } = body as Record<string, unknown>;
      const allowed = ["name","description","contribution_type","amount","frequency","due_day","target_amount","status"];
      const update: Record<string, unknown> = {};
      for (const k of allowed) if (fields[k] !== undefined) update[k] = fields[k];
      if (update.amount) update.amount = parseFloat(String(update.amount));
      const { data: program, error } = await sb.from("org_contribution_programs")
        .update(update).eq("id", program_id).select("*").single();
      if (error) return json({ error: error.message }, 400);
      return json({ program });
    }

    if (action === "delete-program") {
      const { program_id } = body as { program_id: string };
      await sb.from("org_contribution_programs").delete().eq("id", program_id);
      return json({ success: true });
    }

    // ══════════════════════════════════════════════════
    //  SAVINGS / CONTRIBUTIONS
    // ══════════════════════════════════════════════════

    if (action === "record-saving") {
      const { org_id, member_id, amount, type, payment_method, paystack_ref, notes, recorded_by, program_id } =
        body as Record<string, unknown>;
      const amt = parseFloat(String(amount));
      if (!org_id || !member_id || !amt) return json({ error: "org_id, member_id, amount required" }, 400);
      const { data: mem } = await sb.from("org_members").select("savings_balance").eq("id", member_id).single();
      const current = (mem?.savings_balance || 0) as number;
      const isWithdrawal = type === "withdrawal";
      if (isWithdrawal && current < amt) return json({ error: "Insufficient savings balance" }, 400);
      const balance_after = isWithdrawal ? current - amt : current + amt;
      const { data: saving, error } = await sb.from("org_savings")
        .insert({ org_id, member_id, amount: amt, type: type || "deposit",
          payment_method: payment_method || "cash", paystack_ref: paystack_ref || null,
          notes: notes || null, recorded_by: recorded_by || null, balance_after,
          program_id: program_id || null,
        })
        .select("*").single();
      if (error) return json({ error: error.message }, 400);
      await sb.from("org_members").update({ savings_balance: balance_after }).eq("id", member_id);
      const { data: orgRow } = await sb.from("organizations")
        .select("wallet_balance,total_savings").eq("id", org_id).single();
      const delta = isWithdrawal ? -amt : amt;
      const newWal = Math.max(0, (orgRow?.wallet_balance || 0) + delta);
      const newSav = Math.max(0, (orgRow?.total_savings || 0) + delta);
      await sb.from("organizations").update({ wallet_balance: newWal, total_savings: newSav }).eq("id", org_id);
      await sb.from("org_wallet_txns").insert({
        org_id, type: isWithdrawal ? "savings_withdrawal" : "savings_deposit",
        amount: amt, description: `Savings ${isWithdrawal ? "withdrawal" : "deposit"} — ${member_id}`,
        reference_id: saving.id, paystack_ref: paystack_ref || null, balance_after: newWal,
      });
      const { data: updated_member } = await sb.from("org_members").select(MEMBER_SELECT).eq("id", member_id).single();

      // Fire savings email notifications
      const { data: memberInfo } = await sb
        .from("org_members").select("full_name, email").eq("id", member_id).maybeSingle();
      const { data: orgFull } = await sb
        .from("organizations").select("name, owner_id").eq("id", org_id).maybeSingle();
      let ownerEmail = "";
      if (orgFull?.owner_id) {
        const { data: ownerInfo } = await sb
          .from("profiles").select("email").eq("id", orgFull.owner_id).maybeSingle();
        ownerEmail = ownerInfo?.email || "";
      }

      if (memberInfo?.email) {
        await fetch("https://admin.kudiai.app/api/public/email-trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
          body: JSON.stringify({
            event: "org_saving",
            data: {
              member_name: memberInfo.full_name || "",
              member_email: memberInfo.email,
              amount: amt,
              type: type || "deposit",
              org_name: orgFull?.name || "",
              date: new Date().toLocaleDateString("en-NG"),
              owner_email: ownerEmail,
              owner_id: orgFull?.owner_id || "",
              staff_id: recorded_by || "",
            },
          }),
        }).catch(() => null);
      }

      return json({ saving, member: updated_member });
    }

    if (action === "get-savings") {
      const { org_id, member_id, program_id } = body as Record<string, string>;
      // Join org_members inline; skip org_contribution_programs join (FK may not exist)
      // and enrich program name via a separate lookup to avoid blanking the list.
      let q = sb.from("org_savings")
        .select("*, org_members(full_name,membership_id)");
      if (org_id)     q = q.eq("org_id", org_id);
      if (member_id)  q = q.eq("member_id", member_id);
      if (program_id) q = q.eq("program_id", program_id);
      const { data: savings, error: savErr } = await q.order("created_at", { ascending: false }).limit(100);
      if (savErr) return json({ savings: [] });
      // Enrich with program names
      const progIds = [...new Set((savings || []).map((s: Record<string, unknown>) => s.program_id).filter(Boolean))];
      const progMap: Record<string, string> = {};
      if (progIds.length > 0) {
        const { data: progs } = await sb.from("org_contribution_programs")
          .select("id,name,frequency").in("id", progIds as string[]);
        (progs || []).forEach((p: { id: string; name: string; frequency?: string }) => {
          progMap[p.id] = p.name;
        });
      }
      const enriched = (savings || []).map((s: Record<string, unknown>) => ({
        ...s,
        org_contribution_programs: s.program_id ? { name: progMap[s.program_id as string] || null } : null,
      }));
      return json({ savings: enriched });
    }

    // ══════════════════════════════════════════════════
    //  ORG WITHDRAWALS (bulk deduction from members)
    // ══════════════════════════════════════════════════

    if (action === "create-withdrawal") {
      const { org_id, purpose, method, authorized_by, notes, program_id,
              per_member_amount, individual_items } =
        body as Record<string, unknown>;
      if (!org_id || !purpose) return json({ error: "org_id and purpose required" }, 400);

      let affectedMembers: Array<{ id: string; full_name: string; savings_balance: number; amount: number }> = [];

      if (method === "equal") {
        const amt = parseFloat(String(per_member_amount || 0));
        if (!amt) return json({ error: "per_member_amount required for equal method" }, 400);
        const { data: mems } = await sb.from("org_members")
          .select("id,full_name,savings_balance").eq("org_id", org_id).eq("status", "active");
        affectedMembers = (mems || []).map((m: { id: string; full_name: string; savings_balance: number }) =>
          ({ ...m, amount: amt }));
      } else {
        const items = (individual_items || []) as Array<{ member_id: string; amount: number }>;
        for (const item of items) {
          const { data: m } = await sb.from("org_members")
            .select("id,full_name,savings_balance").eq("id", item.member_id).single();
          if (m) affectedMembers.push({ id: m.id, full_name: m.full_name, savings_balance: m.savings_balance, amount: parseFloat(String(item.amount)) });
        }
      }

      const totalAmount = affectedMembers.reduce((s, m) => s + m.amount, 0);

      const { data: wd, error: wdErr } = await sb.from("org_withdrawals")
        .insert({ org_id, purpose, total_amount: totalAmount, method: method || "equal",
          authorized_by: authorized_by || null, notes: notes || null,
          program_id: program_id || null, member_count: affectedMembers.length,
        }).select("id").single();
      if (wdErr) return json({ error: wdErr.message }, 400);

      for (const m of affectedMembers) {
        const newBal = Math.max(0, (m.savings_balance || 0) - m.amount);
        await sb.from("org_members").update({ savings_balance: newBal }).eq("id", m.id);
        await sb.from("org_savings").insert({
          org_id, member_id: m.id, amount: m.amount, type: "withdrawal",
          payment_method: "org_deduction", notes: purpose, balance_after: newBal,
          program_id: program_id || null,
        });
        await sb.from("org_withdrawal_items").insert({
          withdrawal_id: wd.id, member_id: m.id, member_name: m.full_name, amount: m.amount,
        });
      }

      const { data: orgRow } = await sb.from("organizations")
        .select("wallet_balance,total_savings").eq("id", org_id).single();
      const newWal = Math.max(0, (orgRow?.wallet_balance || 0) - totalAmount);
      const newSav = Math.max(0, (orgRow?.total_savings || 0) - totalAmount);
      await sb.from("organizations").update({ wallet_balance: newWal, total_savings: newSav }).eq("id", org_id);
      await sb.from("org_wallet_txns").insert({
        org_id, type: "org_withdrawal", amount: totalAmount,
        description: `Org withdrawal: ${purpose}`, reference_id: wd.id, balance_after: newWal,
      });

      // Fire withdrawal email notifications
      const memberIds = affectedMembers.map(m => m.id);
      const { data: memberEmailRows } = await sb.from("org_members")
        .select("id, full_name, email").in("id", memberIds);
      const { data: wdOrgInfo } = await sb.from("organizations")
        .select("name, owner_id").eq("id", org_id).maybeSingle();
      let wdOwnerEmail = "";
      if (wdOrgInfo?.owner_id) {
        const { data: wdOwner } = await sb.from("profiles")
          .select("email").eq("id", wdOrgInfo.owner_id).maybeSingle();
        wdOwnerEmail = wdOwner?.email || "";
      }
      const wdDate = new Date().toLocaleDateString("en-NG");
      for (const m of (memberEmailRows || [])) {
        if (m.email) {
          const mAmt = affectedMembers.find(am => am.id === m.id)?.amount || 0;
          await fetch("https://admin.kudiai.app/api/public/email-trigger", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
            body: JSON.stringify({
              event: "org_saving",
              data: { member_name: m.full_name || "", member_email: m.email, amount: mAmt,
                type: "withdrawal", org_name: wdOrgInfo?.name || "", date: wdDate, owner_email: "" },
            }),
          }).catch(() => null);
        }
      }
      if (wdOwnerEmail) {
        await fetch("https://admin.kudiai.app/api/public/email-trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
          body: JSON.stringify({
            event: "org_saving",
            data: { member_name: `${affectedMembers.length} member(s)`, member_email: "",
              amount: totalAmount, type: "withdrawal", org_name: wdOrgInfo?.name || "",
              date: wdDate, owner_email: wdOwnerEmail },
          }),
        }).catch(() => null);
      }

      return json({ withdrawal_id: wd.id, total_amount: totalAmount, member_count: affectedMembers.length });
    }

    if (action === "get-withdrawals") {
      const { org_id } = body as { org_id: string };
      const { data: withdrawals } = await sb.from("org_withdrawals").select("*")
        .eq("org_id", org_id).order("created_at", { ascending: false });
      return json({ withdrawals: withdrawals || [] });
    }

    if (action === "get-withdrawal-items") {
      const { withdrawal_id } = body as { withdrawal_id: string };
      const { data: items } = await sb.from("org_withdrawal_items").select("*")
        .eq("withdrawal_id", withdrawal_id).order("member_name");
      return json({ items: items || [] });
    }

    // ══════════════════════════════════════════════════
    //  LOANS
    // ══════════════════════════════════════════════════

    // Helper: compute loan totals
    function calcLoan(principal: number, interestRate: number, months: number) {
      const totalInterest = principal * (interestRate / 100);
      const totalRepayable = principal + totalInterest;
      const monthlyInstallment = totalRepayable / Math.max(1, months);
      return { totalInterest, totalRepayable, monthlyInstallment };
    }

    // Apply for a loan (admin on behalf of member, or member self-apply)
    if (action === "apply-loan" || action === "member-apply-loan") {
      const { org_id, member_id, amount_requested, interest_rate, loan_purpose, repayment_months, notes, applied_by } =
        body as Record<string, unknown>;
      if (!org_id || !member_id || !amount_requested) return json({ error: "Required fields missing" }, 400);
      const principal = parseFloat(String(amount_requested));
      const rate      = parseFloat(String(interest_rate || 0));
      const months    = parseInt(String(repayment_months || 1));
      const { totalInterest, totalRepayable, monthlyInstallment } = calcLoan(principal, rate, months);
      const { data: loan, error } = await sb.from("org_loans")
        .insert({
          org_id, member_id, amount_requested: principal,
          interest_rate: rate, loan_purpose: loan_purpose || null,
          repayment_months: months, notes: notes || null,
          total_interest: totalInterest, total_repayable: totalRepayable,
          monthly_installment: monthlyInstallment,
          applied_by: String(applied_by || "admin"),
        })
        .select("*, org_members(full_name,membership_id)").single();
      if (error) return json({ error: error.message }, 400);
      // In-app: notify org about new loan request
      insertNotif(String(org_id), "org", "info", "loan",
        "New Loan Request",
        `${(loan.org_members as Record<string,string>)?.full_name || "A member"} applied for a loan of ₦${Number(principal).toLocaleString("en-NG")}`,
        "loans");
      // Email org about new loan request
      const { data: loanOrg } = await sb.from("organizations").select("name,owner_id").eq("id", org_id).maybeSingle();
      if (loanOrg?.owner_id) {
        const { data: ownerProf } = await sb.from("profiles").select("email").eq("id", loanOrg.owner_id).maybeSingle();
        if (ownerProf?.email) {
          await fetch("https://admin.kudiai.app/api/public/email-trigger", {
            method: "POST", headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
            body: JSON.stringify({ event: "org_loan_request", data: {
              owner_email: ownerProf.email, org_name: loanOrg.name,
              member_name: (loan as Record<string, { full_name?: string }>).org_members?.full_name || "",
              amount: principal, interest_rate: rate, months,
              monthly_installment: monthlyInstallment, total_repayable: totalRepayable,
              loan_purpose: loan_purpose || "", loan_id: loan.id,
            }}),
          }).catch(() => null);
        }
      }
      return json({ loan });
    }

    // Update loan status (approve / reject / disburse)
    if (action === "update-loan") {
      const { loan_id, org_id, status, amount_approved, approved_by_name, notes, repayment_months, rejection_reason } =
        body as Record<string, unknown>;
      const update: Record<string, unknown> = {};
      if (status)           update.status = status;
      if (amount_approved)  update.amount_approved = parseFloat(String(amount_approved));
      if (approved_by_name) update.approved_by_name = approved_by_name;
      if (notes !== undefined) update.notes = notes;

      const { data: existingLoan } = await sb.from("org_loans")
        .select("*, org_members(full_name,email,membership_id)")
        .eq("id", loan_id).maybeSingle();
      if (!existingLoan) return json({ error: "Loan not found" }, 404);

      if (status === "approved") {
        update.approved_at = new Date().toISOString();
        const principal = parseFloat(String(update.amount_approved || existingLoan.amount_approved || existingLoan.amount_requested));
        const rate    = existingLoan.interest_rate || 0;
        const months  = existingLoan.repayment_months || 1;
        const { totalInterest, totalRepayable, monthlyInstallment } = calcLoan(principal, rate, months);
        update.total_interest = totalInterest;
        update.total_repayable = totalRepayable;
        update.monthly_installment = monthlyInstallment;
        update.outstanding_balance = totalRepayable;
        // Email member: approved
        const memberEmail = (existingLoan.org_members as Record<string, string>)?.email;
        const memberName  = (existingLoan.org_members as Record<string, string>)?.full_name;
        // In-app: notify member
        insertNotif(existingLoan.org_id, "member", "success", "loan",
          "Loan Approved! 🎉",
          `Your loan of ₦${Number(principal).toLocaleString("en-NG")} is approved. Monthly installment: ₦${Number(monthlyInstallment).toLocaleString("en-NG")} × ${months} months`,
          "loans", existingLoan.member_id);
        if (memberEmail) {
          const { data: approvedOrg } = await sb.from("organizations").select("name").eq("id", existingLoan.org_id).maybeSingle();
          await fetch("https://admin.kudiai.app/api/public/email-trigger", {
            method: "POST", headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
            body: JSON.stringify({ event: "org_loan_approved", data: {
              member_email: memberEmail, member_name: memberName, org_name: approvedOrg?.name || "",
              amount: principal, interest_rate: rate, months, monthly_installment: monthlyInstallment,
              total_repayable: totalRepayable,
            }}),
          }).catch(() => null);
        }
      }

      if (status === "rejected") {
        // In-app: notify member
        insertNotif(existingLoan.org_id, "member", "error", "loan",
          "Loan Request Declined",
          `Your loan request of ₦${Number(existingLoan.amount_requested).toLocaleString("en-NG")} was not approved${rejection_reason ? ": " + String(rejection_reason).slice(0, 80) : ""}`,
          "loans", existingLoan.member_id);
        // Email member: rejected
        const memberEmail = (existingLoan.org_members as Record<string, string>)?.email;
        const memberName  = (existingLoan.org_members as Record<string, string>)?.full_name;
        if (memberEmail) {
          const { data: rejOrg } = await sb.from("organizations").select("name").eq("id", existingLoan.org_id).maybeSingle();
          await fetch("https://admin.kudiai.app/api/public/email-trigger", {
            method: "POST", headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
            body: JSON.stringify({ event: "org_loan_rejected", data: {
              member_email: memberEmail, member_name: memberName, org_name: rejOrg?.name || "",
              amount: existingLoan.amount_requested,
              reason: String(rejection_reason || notes || "No reason provided"),
            }}),
          }).catch(() => null);
        }
      }

      if (status === "disbursed") {
        update.disbursed_at = new Date().toISOString();
        const months = parseInt(String(repayment_months || existingLoan.repayment_months || 1));
        const due = new Date(); due.setMonth(due.getMonth() + months);
        update.due_date = due.toISOString().slice(0, 10);
        const amt = existingLoan.amount_approved || existingLoan.amount_requested;
        if (amt > 0) {
          // Deduct from org wallet
          const { data: orgW } = await sb.from("organizations")
            .select("wallet_balance,total_loans_out").eq("id", org_id).single();
          const newBal = Math.max(0, (orgW?.wallet_balance || 0) - amt);
          await sb.from("organizations").update({
            wallet_balance: newBal, total_loans_out: (orgW?.total_loans_out || 0) + amt,
          }).eq("id", org_id);
          await sb.from("org_wallet_txns").insert({
            org_id, type: "loan_disbursement", amount: amt,
            description: `Loan disbursement — ${loan_id}`, reference_id: loan_id, balance_after: newBal,
          });
          // Credit member savings account
          const { data: mem } = await sb.from("org_members").select("savings_balance").eq("id", existingLoan.member_id).single();
          const newSavBal = (mem?.savings_balance || 0) + amt;
          await sb.from("org_members").update({ savings_balance: newSavBal }).eq("id", existingLoan.member_id);
          await sb.from("org_savings").insert({
            org_id: existingLoan.org_id, member_id: existingLoan.member_id,
            amount: amt, type: "deposit", payment_method: "loan_disbursement",
            notes: `Loan disbursement — ${loan_id}`, balance_after: newSavBal,
          });
        }
        // In-app: notify member of disbursement
        const disbAmt = existingLoan.amount_approved || existingLoan.amount_requested;
        insertNotif(existingLoan.org_id, "member", "success", "loan",
          "Loan Disbursed! 💰",
          `₦${Number(disbAmt).toLocaleString("en-NG")} has been credited to your account. Repay by ${String(update.due_date || "due date")}`,
          "loans", existingLoan.member_id);
        // Email member: disbursed
        const memberEmail = (existingLoan.org_members as Record<string, string>)?.email;
        const memberName  = (existingLoan.org_members as Record<string, string>)?.full_name;
        if (memberEmail) {
          const { data: disbOrg } = await sb.from("organizations").select("name").eq("id", existingLoan.org_id).maybeSingle();
          await fetch("https://admin.kudiai.app/api/public/email-trigger", {
            method: "POST", headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
            body: JSON.stringify({ event: "org_loan_disbursed", data: {
              member_email: memberEmail, member_name: memberName, org_name: disbOrg?.name || "",
              amount: amt, due_date: update.due_date,
              monthly_installment: existingLoan.monthly_installment || 0,
            }}),
          }).catch(() => null);
        }
      }

      const { data: loan, error } = await sb.from("org_loans").update(update)
        .eq("id", loan_id).select("*, org_members(full_name,membership_id,email)").single();
      if (error) return json({ error: error.message }, 400);
      return json({ loan });
    }

    // Record a loan repayment (admin cash entry or Paystack callback)
    if (action === "record-repayment") {
      const { org_id, loan_id, member_id, amount, payment_method, paystack_ref, notes } =
        body as Record<string, unknown>;
      const amt = parseFloat(String(amount));
      if (!loan_id || !amt) return json({ error: "loan_id and amount required" }, 400);
      const { data: loan } = await sb.from("org_loans")
        .select("outstanding_balance,total_repayable,total_interest,amount_approved,amount_requested,org_id,member_id,repayment_months,loan_purpose,org_members(full_name,email)")
        .eq("id", loan_id).single();
      if (!loan) return json({ error: "Loan not found" }, 404);
      const newOutstanding = Math.max(0, (loan.outstanding_balance || 0) - amt);

      // Split payment into principal vs interest proportionally
      const totalRepayable = loan.total_repayable || (loan.amount_approved || loan.amount_requested);
      const totalInterest  = loan.total_interest || 0;
      const interestRatio  = totalRepayable > 0 ? (totalInterest / totalRepayable) : 0;
      const interestPortion   = parseFloat((amt * interestRatio).toFixed(2));
      const principalPortion  = parseFloat((amt - interestPortion).toFixed(2));

      const { data: repayment, error } = await sb.from("org_loan_repayments")
        .insert({ org_id: loan.org_id, loan_id, member_id: loan.member_id,
          amount: amt, payment_method: payment_method || "cash",
          paystack_ref: paystack_ref || null, notes: notes || null,
          principal_portion: principalPortion, interest_portion: interestPortion })
        .select("*").single();
      if (error) return json({ error: error.message }, 400);

      await sb.from("org_loans").update({
        outstanding_balance: newOutstanding, status: newOutstanding === 0 ? "repaid" : "disbursed",
      }).eq("id", loan_id);

      const { data: orgW } = await sb.from("organizations")
        .select("wallet_balance,total_loans_out,interest_earned").eq("id", loan.org_id).single();
      const newBal = (orgW?.wallet_balance || 0) + amt;
      await sb.from("organizations").update({
        wallet_balance: newBal,
        total_loans_out: Math.max(0, (orgW?.total_loans_out || 0) - amt),
        interest_earned: (orgW?.interest_earned || 0) + interestPortion,
      }).eq("id", loan.org_id);

      await sb.from("org_wallet_txns").insert({
        org_id: loan.org_id, type: "loan_repayment", amount: amt,
        description: `Loan repayment — ${loan_id}`, reference_id: repayment.id,
        paystack_ref: paystack_ref || null, balance_after: newBal,
      });

      // In-app: notify org of repayment received
      const repayMemberName = (loan.org_members as Record<string,string>)?.full_name || "A member";
      insertNotif(loan.org_id, "org", "success", "loan",
        "Loan Repayment Received 💳",
        `${repayMemberName} paid ₦${Number(amt).toLocaleString("en-NG")}${newOutstanding === 0 ? " — fully repaid!" : `. Balance: ₦${Number(newOutstanding).toLocaleString("en-NG")}`}`,
        "loans");
      // In-app: notify member of repayment confirmed
      insertNotif(loan.org_id, "member", "success", "loan",
        newOutstanding === 0 ? "Loan Fully Repaid! 🎉" : "Repayment Recorded",
        `₦${Number(amt).toLocaleString("en-NG")} received${newOutstanding === 0 ? " — your loan is fully settled!" : `. Outstanding: ₦${Number(newOutstanding).toLocaleString("en-NG")}`}`,
        "loans", loan.member_id);
      // Emails: member + org
      const memberEmail = (loan.org_members as Record<string, string>)?.email;
      const memberName  = (loan.org_members as Record<string, string>)?.full_name;
      const { data: repayOrg } = await sb.from("organizations").select("name,owner_id").eq("id", loan.org_id).maybeSingle();
      const emailData = {
        member_name: memberName || "", member_email: memberEmail || "",
        org_name: repayOrg?.name || "", amount: amt,
        outstanding_balance: newOutstanding, is_fully_repaid: newOutstanding === 0,
        loan_purpose: loan.loan_purpose || "",
      };
      if (memberEmail) {
        await fetch("https://admin.kudiai.app/api/public/email-trigger", {
          method: "POST", headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
          body: JSON.stringify({ event: "org_loan_repayment", data: { ...emailData, send_to: "member" } }),
        }).catch(() => null);
      }
      if (repayOrg?.owner_id) {
        const { data: ownerP } = await sb.from("profiles").select("email").eq("id", repayOrg.owner_id).maybeSingle();
        if (ownerP?.email) {
          await fetch("https://admin.kudiai.app/api/public/email-trigger", {
            method: "POST", headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
            body: JSON.stringify({ event: "org_loan_repayment", data: { ...emailData, send_to: "org", owner_email: ownerP.email } }),
          }).catch(() => null);
        }
      }
      return json({ repayment, outstanding_balance: newOutstanding });
    }

    if (action === "get-loans") {
      const { org_id, member_id } = body as { org_id?: string; member_id?: string };
      let q = sb.from("org_loans").select("*, org_members(full_name,membership_id,email)");
      if (org_id)    q = q.eq("org_id", org_id);
      if (member_id) q = q.eq("member_id", member_id);
      const { data: loans } = await q.order("created_at", { ascending: false });
      return json({ loans: loans || [] });
    }

    if (action === "get-repayments") {
      const { loan_id, org_id } = body as { loan_id?: string; org_id?: string };
      let q = sb.from("org_loan_repayments").select("*, org_members(full_name,membership_id)");
      if (loan_id) q = q.eq("loan_id", loan_id);
      if (org_id)  q = q.eq("org_id", org_id);
      const { data: repayments } = await q.order("created_at", { ascending: false });
      return json({ repayments: repayments || [] });
    }

    // Update org default loan interest rate
    if (action === "update-loan-settings") {
      const { org_id, default_loan_interest_rate } = body as Record<string, unknown>;
      if (!org_id) return json({ error: "org_id required" }, 400);
      const rate = parseFloat(String(default_loan_interest_rate ?? 10));
      await sb.from("organizations").update({ default_loan_interest_rate: rate }).eq("id", org_id);
      return json({ ok: true, default_loan_interest_rate: rate });
    }

    // Check for overdue loans and send alerts
    if (action === "check-overdue-loans") {
      const { org_id } = body as { org_id: string };
      const today = new Date().toISOString().slice(0, 10);
      const { data: overdueLoans } = await sb.from("org_loans")
        .select("*, org_members(full_name,email)")
        .eq("org_id", org_id).eq("status", "disbursed")
        .lt("due_date", today);
      if (!overdueLoans?.length) return json({ overdue: 0 });

      const { data: orgInfo } = await sb.from("organizations").select("name,owner_id").eq("id", org_id).maybeSingle();
      let ownerEmail = "";
      if (orgInfo?.owner_id) {
        const { data: ownerP } = await sb.from("profiles").select("email").eq("id", orgInfo.owner_id).maybeSingle();
        ownerEmail = ownerP?.email || "";
      }

      for (const ol of overdueLoans as Array<Record<string, unknown>>) {
        const memberEmail = (ol.org_members as Record<string, string>)?.email;
        const memberName  = (ol.org_members as Record<string, string>)?.full_name;
        const payload = {
          org_name: orgInfo?.name || "", member_name: memberName || "",
          member_email: memberEmail || "", owner_email: ownerEmail,
          amount_outstanding: ol.outstanding_balance, due_date: ol.due_date,
          loan_purpose: ol.loan_purpose || "",
        };
        await fetch("https://admin.kudiai.app/api/public/email-trigger", {
          method: "POST", headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
          body: JSON.stringify({ event: "org_loan_overdue", data: payload }),
        }).catch(() => null);
        // In-app: alert both member and org
        if (ol.member_id) {
          insertNotif(String(ol.org_id || org_id), "member", "alert", "loan",
            "⚠️ Loan Payment Overdue",
            `Your loan repayment is overdue. Outstanding balance: ₦${Number(ol.outstanding_balance || 0).toLocaleString("en-NG")}. Please make a payment now.`,
            "loans", String(ol.member_id));
        }
        insertNotif(String(ol.org_id || org_id), "org", "alert", "loan",
          "Overdue Loan Alert",
          `${memberName || "A member"}'s loan payment is overdue. Balance: ₦${Number(ol.outstanding_balance || 0).toLocaleString("en-NG")}`,
          "loans");
      }
      return json({ overdue: overdueLoans.length });
    }

    // ══════════════════════════════════════════════════
    //  MEETINGS & ATTENDANCE
    // ══════════════════════════════════════════════════

    if (action === "create-meeting") {
      const { org_id, title, description, meeting_type, format, scheduled_at, location, meeting_link, agenda } =
        body as Record<string, string>;
      if (!org_id || !title || !scheduled_at) return json({ error: "org_id, title, scheduled_at required" }, 400);
      const { data: meeting, error } = await sb.from("org_meetings")
        .insert({ org_id, title, description: description || null,
          meeting_type: meeting_type || "general", format: format || "physical",
          scheduled_at, location: location || null,
          meeting_link: meeting_link || null, agenda: agenda || null,
        })
        .select("*").single();
      if (error) return json({ error: error.message }, 400);
      const { data: mtgOrg } = await sb.from("organizations").select("name,owner_id").eq("id", org_id).single();
      const { data: mtgMems } = await sb.from("org_members").select("id,full_name,email").eq("org_id", org_id).eq("status", "active");
      if (mtgOrg) {
        let ownerEmail = "";
        if (mtgOrg.owner_id) {
          const { data: ownerP } = await sb.from("profiles").select("email").eq("id", mtgOrg.owner_id).maybeSingle();
          ownerEmail = ownerP?.email || "";
        }
        const recipients = [
          ...(ownerEmail ? [{ email: ownerEmail, name: "Admin", is_org: true }] : []),
          ...(mtgMems || []).filter((m: { email?: string }) => m.email)
            .map((m: { id: string; full_name: string; email: string }) => ({ email: m.email, name: m.full_name, is_org: false })),
        ];
        for (const r of recipients) {
          await fetch("https://admin.kudiai.app/api/public/email-trigger", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
            body: JSON.stringify({ event: "org_broadcast", data: {
              email: r.email, member_name: r.name, is_org: r.is_org, org_name: mtgOrg.name,
              broadcast_type: "Meeting", title,
              description: description || "", meeting_type: meeting_type || "general",
              format: format || "physical", scheduled_at, location: location || "",
              meeting_link: meeting_link || "", agenda: agenda || "",
            }}),
          }).catch(() => null);
        }
        // In-app: notify each member
        const fmtLabel: Record<string,string> = { physical:"In-person", virtual:"Virtual", hybrid:"Hybrid" };
        const mtgDateStr = scheduled_at ? new Date(scheduled_at).toLocaleDateString("en-NG", { day:"numeric", month:"short" }) : "";
        for (const m of (mtgMems || []) as Array<{ id: string; full_name: string; email: string }>) {
          if (!m.id) continue;
          insertNotif(org_id, "member", "info", "broadcast",
            `📅 ${title}`,
            `${fmtLabel[format] || "Meeting"} meeting${mtgDateStr ? " · " + mtgDateStr : ""}${location ? " @ " + location : ""}`,
            "broadcast", m.id);
        }
      }
      return json({ meeting });
    }

    if (action === "update-meeting") {
      const { meeting_id, ...fields } = body as Record<string, unknown>;
      const allowed = ["title","description","meeting_type","format","scheduled_at","location",
                       "meeting_link","agenda","status"];
      const update: Record<string, unknown> = {};
      for (const k of allowed) if (fields[k] !== undefined) update[k] = fields[k];
      const { data: meeting, error } = await sb.from("org_meetings")
        .update(update).eq("id", meeting_id).select("*").single();
      if (error) return json({ error: error.message }, 400);
      return json({ meeting });
    }

    if (action === "get-meetings") {
      const { org_id } = body as { org_id: string };
      const { data: meetings } = await sb.from("org_meetings").select("*")
        .eq("org_id", org_id).order("scheduled_at", { ascending: false });

      const withRsvp = await Promise.all((meetings || []).map(async (m: Record<string, unknown>) => {
        const { data: rsvp } = await sb.from("org_meeting_rsvp")
          .select("status").eq("meeting_id", m.id);
        const counts = { attending: 0, maybe: 0, not_attending: 0 };
        (rsvp || []).forEach((r: { status: string }) => {
          if (r.status in counts) counts[r.status as keyof typeof counts]++;
        });
        return { ...m, rsvp_counts: counts };
      }));

      return json({ meetings: withRsvp });
    }

    if (action === "bulk-attendance") {
      const { meeting_id, org_id, present_ids, absent_ids } =
        body as { meeting_id: string; org_id: string; present_ids: string[]; absent_ids: string[] };
      const rows = [
        ...(present_ids || []).map((id: string) => ({ meeting_id, org_id, member_id: id, status: "present", checked_in_at: new Date().toISOString() })),
        ...(absent_ids  || []).map((id: string) => ({ meeting_id, org_id, member_id: id, status: "absent",  checked_in_at: new Date().toISOString() })),
      ];
      if (rows.length) {
        const { error } = await sb.from("org_attendance").upsert(rows, { onConflict: "meeting_id,member_id" });
        if (error) return json({ error: error.message }, 400);
      }
      await sb.from("org_meetings").update({ status: "completed" }).eq("id", meeting_id);
      return json({ count: rows.length });
    }

    if (action === "get-attendance") {
      const { meeting_id, org_id } = body as { meeting_id?: string; org_id?: string };
      let q = sb.from("org_attendance").select("*, org_members(full_name,membership_id,role)");
      if (meeting_id) q = q.eq("meeting_id", meeting_id);
      if (org_id)     q = q.eq("org_id", org_id);
      const { data: att } = await q.order("checked_in_at", { ascending: false });
      return json({ attendance: att || [] });
    }

    if (action === "qr-check-in") {
      const { qr_token, member_id } = body as { qr_token: string; member_id: string };
      const { data: meeting } = await sb.from("org_meetings").select("id,org_id,title,status")
        .eq("qr_token", qr_token).maybeSingle();
      if (!meeting) return json({ error: "Invalid QR code" }, 404);
      if (meeting.status === "cancelled") return json({ error: "Meeting cancelled" }, 400);
      const { data: att, error } = await sb.from("org_attendance")
        .upsert({ meeting_id: meeting.id, org_id: meeting.org_id, member_id, status: "present",
          checked_in_at: new Date().toISOString() }, { onConflict: "meeting_id,member_id" })
        .select("*, org_members(full_name)").single();
      if (error) return json({ error: error.message }, 400);
      return json({ attendance: att, meeting });
    }

    if (action === "set-rsvp") {
      const { meeting_id, member_id, org_id, status } = body as Record<string, string>;
      if (!meeting_id || !member_id) return json({ error: "meeting_id and member_id required" }, 400);
      const { data: rsvp, error } = await sb.from("org_meeting_rsvp")
        .upsert({ meeting_id, member_id, org_id, status: status || "attending" },
          { onConflict: "meeting_id,member_id" })
        .select("*").single();
      if (error) return json({ error: error.message }, 400);
      return json({ rsvp });
    }

    if (action === "get-rsvp") {
      const { meeting_id } = body as { meeting_id: string };
      const { data: rsvps } = await sb.from("org_meeting_rsvp")
        .select("*, org_members(full_name,role)").eq("meeting_id", meeting_id);
      return json({ rsvps: rsvps || [] });
    }

    // ══════════════════════════════════════════════════
    //  ANNOUNCEMENTS
    // ══════════════════════════════════════════════════

    if (action === "send-announcement") {
      const { org_id, author_name, type, title, body: msgBody, is_pinned } =
        body as Record<string, unknown>;
      if (!org_id || !title || !msgBody) return json({ error: "org_id, title, body required" }, 400);
      const { data: ann, error } = await sb.from("org_announcements")
        .insert({ org_id, author_name: author_name || "Admin",
          type: type || "announcement", title, body: msgBody,
          is_pinned: is_pinned || false,
        }).select("*").single();
      if (error) return json({ error: error.message }, 400);
      const { data: annOrg } = await sb.from("organizations").select("name,owner_id").eq("id", org_id as string).single();
      const { data: annMems } = await sb.from("org_members").select("id,full_name,email").eq("org_id", org_id as string).eq("status", "active");
      if (annOrg) {
        let ownerEmail = "";
        if (annOrg.owner_id) {
          const { data: ownerP } = await sb.from("profiles").select("email").eq("id", annOrg.owner_id).maybeSingle();
          ownerEmail = ownerP?.email || "";
        }
        const btype = type === "emergency" ? "Emergency Alert" : type === "notice" ? "Notice" : type === "circular" ? "Circular" : "Announcement";
        const recipients = [
          ...(ownerEmail ? [{ email: ownerEmail, name: "Admin", is_org: true }] : []),
          ...(annMems || []).filter((m: { email?: string }) => m.email)
            .map((m: { id: string; full_name: string; email: string }) => ({ email: m.email, name: m.full_name, is_org: false })),
        ];
        for (const r of recipients) {
          await fetch("https://admin.kudiai.app/api/public/email-trigger", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
            body: JSON.stringify({ event: "org_broadcast", data: {
              email: r.email, member_name: r.name, is_org: r.is_org, org_name: annOrg.name,
              broadcast_type: btype, ann_type: String(type || "announcement"),
              title, description: String(msgBody), is_pinned: is_pinned || false,
              author_name: String(author_name || "Admin"),
            }}),
          }).catch(() => null);
        }
        // In-app: notify each member
        const notifType = type === "emergency" ? "alert" as const : "info" as const;
        const annIcon = type === "emergency" ? "🚨" : type === "notice" ? "📋" : type === "circular" ? "📄" : "📢";
        for (const m of (annMems || []) as Array<{ id: string; full_name: string; email: string }>) {
          if (!m.id) continue;
          insertNotif(String(org_id), "member", notifType, "broadcast",
            `${annIcon} ${String(title)}`,
            `${String(msgBody).slice(0, 100)}${String(msgBody).length > 100 ? "…" : ""}`,
            "broadcast", m.id);
        }
      }
      return json({ announcement: ann });
    }

    if (action === "get-announcements") {
      const { org_id } = body as { org_id: string };
      const { data: announcements } = await sb.from("org_announcements").select("*")
        .eq("org_id", org_id).order("is_pinned", { ascending: false })
        .order("created_at", { ascending: false }).limit(50);
      return json({ announcements: announcements || [] });
    }

    if (action === "pin-announcement") {
      const { announcement_id, is_pinned } = body as { announcement_id: string; is_pinned: boolean };
      await sb.from("org_announcements").update({ is_pinned }).eq("id", announcement_id);
      return json({ success: true });
    }

    if (action === "delete-announcement") {
      const { announcement_id } = body as { announcement_id: string };
      await sb.from("org_announcements").delete().eq("id", announcement_id);
      return json({ success: true });
    }

    // ══════════════════════════════════════════════════
    //  WALLET
    // ══════════════════════════════════════════════════

    if (action === "get-wallet") {
      const { org_id, limit } = body as { org_id: string; limit?: number };
      const { data: txns } = await sb.from("org_wallet_txns").select("*")
        .eq("org_id", org_id).order("created_at", { ascending: false }).limit(limit || 50);
      const { data: org } = await sb.from("organizations")
        .select("wallet_balance,total_savings,total_loans_out").eq("id", org_id).single();
      return json({ transactions: txns || [], wallet: org });
    }

    // ══════════════════════════════════════════════════
    //  MEMBER PORTAL
    // ══════════════════════════════════════════════════

    if (action === "member-auth") {
      const { membership_id, pin, org_id } = body as { membership_id: string; pin: string; org_id?: string };
      if (!membership_id || !pin) return json({ error: "Membership ID and PIN required" }, 400);
      let q = sb.from("org_members")
        .select(`${MEMBER_SELECT}, organizations(${ORG_SELECT})`)
        .eq("membership_id", membership_id.toUpperCase().trim())
        .eq("portal_pin", pin.trim());
      if (org_id) q = q.eq("org_id", org_id);
      const { data: member } = await q.maybeSingle();
      if (!member) return json({ error: "Invalid membership ID or PIN" }, 401);
      if (member.status === "suspended") return json({ error: "Your membership is suspended. Contact your organisation." }, 403);
      if (member.status === "removed")   return json({ error: "This membership is no longer active." }, 403);
      return json({ member, org: (member as Record<string,unknown>).organizations });
    }

    if (action === "member-by-token") {
      const b = body as Record<string, string>;
      const tk = b.portal_token || b.token;
      if (!tk) return json({ error: "Token required" }, 400);
      const { data: member } = await sb.from("org_members")
        .select(`${MEMBER_SELECT}, organizations(${ORG_SELECT})`)
        .eq("portal_token", tk).maybeSingle();
      if (!member) return json({ error: "Invalid portal token" }, 404);
      return json({ member, org: (member as Record<string,unknown>).organizations });
    }

    if (action === "change-member-pin") {
      const { member_id, current_pin, new_pin } = body as { member_id: string; current_pin: string; new_pin: string };
      if (!member_id || !current_pin || !new_pin) return json({ error: "All fields required" }, 400);
      if (new_pin.length < 4) return json({ error: "PIN must be at least 4 digits" }, 400);
      const { data: m } = await sb.from("org_members").select("portal_pin").eq("id", member_id).single();
      if (!m || m.portal_pin !== current_pin.trim()) return json({ error: "Current PIN is incorrect" }, 401);
      await sb.from("org_members").update({ portal_pin: new_pin, must_change_pin: false }).eq("id", member_id);
      return json({ success: true });
    }

    if (action === "member-update-privacy") {
      const { member_id, privacy_balance, privacy_contributions, privacy_activities } =
        body as Record<string, unknown>;
      await sb.from("org_members").update({
        privacy_balance: !!privacy_balance,
        privacy_contributions: !!privacy_contributions,
        privacy_activities: !!privacy_activities,
      }).eq("id", member_id);
      return json({ success: true });
    }

    if (action === "member-get-savings") {
      const { member_id, org_id } = body as { member_id: string; org_id?: string };
      let q = sb.from("org_savings")
        .select("*, org_contribution_programs(name,frequency,contribution_type)")
        .eq("member_id", member_id);
      if (org_id) q = q.eq("org_id", org_id);
      const { data: savings } = await q.order("created_at", { ascending: false }).limit(100);
      return json({ savings: savings || [] });
    }

    if (action === "member-get-loans") {
      const { member_id, org_id } = body as { member_id: string; org_id?: string };
      let q = sb.from("org_loans").select("*").eq("member_id", member_id);
      if (org_id) q = q.eq("org_id", org_id);
      const { data: loans } = await q.order("created_at", { ascending: false });
      return json({ loans: loans || [] });
    }

    if (action === "member-request-loan") {
      const { org_id, member_id, amount_requested, loan_purpose, repayment_months } =
        body as Record<string, unknown>;
      if (!org_id || !member_id || !amount_requested) return json({ error: "Required fields missing" }, 400);
      const { data: loan, error } = await sb.from("org_loans").insert({
        org_id, member_id, amount_requested: parseFloat(String(amount_requested)),
        loan_purpose: loan_purpose || null, repayment_months: parseInt(String(repayment_months || 1)),
      }).select("*").single();
      if (error) return json({ error: error.message }, 400);
      return json({ loan });
    }

    if (action === "member-get-meetings") {
      const { org_id, member_id } = body as { org_id: string; member_id: string };
      const { data: meetings } = await sb.from("org_meetings").select("*")
        .eq("org_id", org_id).order("scheduled_at", { ascending: false }).limit(20);
      const [{ data: attendance }, { data: rsvps }] = await Promise.all([
        sb.from("org_attendance").select("meeting_id,status").eq("member_id", member_id),
        sb.from("org_meeting_rsvp").select("meeting_id,status").eq("member_id", member_id),
      ]);
      const attMap: Record<string, string> = {};
      const rsvpMap: Record<string, string> = {};
      (attendance || []).forEach((a: Record<string,string>) => { attMap[a.meeting_id] = a.status; });
      (rsvps || []).forEach((r: Record<string,string>) => { rsvpMap[r.meeting_id] = r.status; });
      const merged = (meetings || []).map((m: Record<string, unknown>) => ({
        ...m, my_attendance: attMap[m.id as string] || null, my_rsvp: rsvpMap[m.id as string] || null,
      }));
      return json({ meetings: merged });
    }

    if (action === "member-get-announcements") {
      const { org_id } = body as { org_id: string };
      const { data: announcements } = await sb.from("org_announcements").select("*")
        .eq("org_id", org_id)
        .order("is_pinned", { ascending: false })
        .order("created_at", { ascending: false }).limit(30);
      return json({ announcements: announcements || [] });
    }

    if (action === "member-get-programs") {
      const { org_id } = body as { org_id: string };
      const { data: programs } = await sb.from("org_contribution_programs").select("*")
        .eq("org_id", org_id).eq("status", "active").order("created_at");
      return json({ programs: programs || [] });
    }

    if (action === "member-get-directory") {
      const { org_id } = body as { org_id: string };
      const { data: members } = await sb.from("org_members")
        .select("id, membership_id, full_name, role, profile_image_url, phone, email, occupation, joined_date, privacy_balance, privacy_contributions, privacy_activities, savings_balance")
        .eq("org_id", org_id).eq("status", "active").order("full_name");
      return json({ members: members || [] });
    }

    // ══════════════════════════════════════════════════
    //  PAYSTACK INTEGRATION (org subaccount + member payments)
    // ══════════════════════════════════════════════════

    const PAYSTACK_SECRET = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
    const PAYSTACK_PUBLIC = Deno.env.get("PAYSTACK_PUBLIC_KEY") ?? "";
    const PS_HEADERS = {
      Authorization: `Bearer ${PAYSTACK_SECRET}`,
      "Content-Type": "application/json",
    };

    // ── List Nigerian banks (Paystack) ────────────────────────────────────
    if (action === "list-banks") {
      if (!PAYSTACK_SECRET) return json({ error: "Paystack not configured" }, 503);
      const res = await fetch(
        "https://api.paystack.co/bank?country=nigeria&use_cursor=false&perPage=100",
        { headers: PS_HEADERS },
      );
      const d = await res.json();
      return json({ banks: d.data || [] });
    }

    // ── Resolve bank account number → account name ─────────────────────────
    if (action === "resolve-bank-account") {
      const { bank_code, account_number } = body as { bank_code: string; account_number: string };
      if (!PAYSTACK_SECRET) return json({ error: "Paystack not configured" }, 503);
      const res = await fetch(
        `https://api.paystack.co/bank/resolve?account_number=${encodeURIComponent(account_number)}&bank_code=${encodeURIComponent(bank_code)}`,
        { headers: PS_HEADERS },
      );
      const d = await res.json();
      if (!d.status || !d.data?.account_name) return json({ error: d.message || "Account not found" }, 422);
      return json({ account_name: d.data.account_name });
    }

    // ── Setup org bank account & create Paystack subaccount ─────────────────
    if (action === "setup-org-bank") {
      const { org_id, owner_id, bank_code, account_number } = body as {
        org_id: string; owner_id: string; bank_code: string; account_number: string;
      };
      if (!org_id || !owner_id || !bank_code || !account_number)
        return json({ error: "org_id, owner_id, bank_code, account_number required" }, 400);
      if (!PAYSTACK_SECRET) return json({ error: "Paystack not configured" }, 503);

      const { data: org } = await sb.from("organizations")
        .select("id, owner_id, name, paystack_subaccount_code").eq("id", org_id).maybeSingle();
      if (!org) return json({ error: "Organisation not found" }, 404);
      if (org.owner_id !== owner_id) return json({ error: "Unauthorized" }, 403);

      // Verify bank account with Paystack
      const verRes = await fetch(
        `https://api.paystack.co/bank/resolve?account_number=${encodeURIComponent(account_number)}&bank_code=${encodeURIComponent(bank_code)}`,
        { headers: PS_HEADERS },
      );
      const verData = await verRes.json();
      if (!verData.status || !verData.data?.account_name)
        return json({ error: verData.message || "Could not verify bank account" }, 422);

      const account_name = verData.data.account_name as string;

      // Create (or update) Paystack subaccount
      let subaccountCode: string;
      let subaccountId: string;

      if (org.paystack_subaccount_code) {
        // Update existing subaccount
        const upRes = await fetch(`https://api.paystack.co/subaccount/${org.paystack_subaccount_code}`, {
          method: "PUT",
          headers: PS_HEADERS,
          body: JSON.stringify({ settlement_bank: bank_code, account_number }),
        });
        const upData = await upRes.json();
        if (!upData.status) return json({ error: upData.message || "Failed to update subaccount" }, 422);
        subaccountCode = org.paystack_subaccount_code;
        subaccountId   = String(upData.data?.id || "");
      } else {
        // Create new subaccount
        const psRes = await fetch("https://api.paystack.co/subaccount", {
          method: "POST",
          headers: PS_HEADERS,
          body: JSON.stringify({
            business_name:    org.name,
            settlement_bank:  bank_code,
            account_number,
            percentage_charge: 100,
          }),
        });
        const psData = await psRes.json();
        if (!psData.status || !psData.data?.subaccount_code)
          return json({ error: psData.message || "Failed to create subaccount" }, 422);
        subaccountCode = psData.data.subaccount_code;
        subaccountId   = String(psData.data.id);
      }

      await sb.from("organizations").update({
        bank_code, account_number, account_name,
        paystack_subaccount_code: subaccountCode,
        paystack_subaccount_id:   subaccountId,
        percentage_charge:        100,
      }).eq("id", org_id);

      return json({ account_name, subaccount_code: subaccountCode });
    }

    // ── Initialize member payment via Paystack ────────────────────────────
    if (action === "initialize-member-payment") {
      const { member_id, org_id, amount, program_id, callback_url } = body as {
        member_id: string; org_id: string; amount: number; program_id?: string; callback_url?: string;
      };
      if (!member_id || !org_id || !amount) return json({ error: "member_id, org_id, amount required" }, 400);
      if (!PAYSTACK_SECRET) return json({ error: "Paystack not configured" }, 503);

      const { data: mem } = await sb.from("org_members")
        .select("email, full_name").eq("id", member_id).maybeSingle();
      if (!mem?.email) return json({ error: "Member email not found" }, 404);

      const { data: org } = await sb.from("organizations")
        .select("name, paystack_subaccount_code").eq("id", org_id).maybeSingle();
      if (!org) return json({ error: "Organisation not found" }, 404);

      const ref = `ORG-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

      const psRes = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: PS_HEADERS,
        body: JSON.stringify({
          email:        mem.email,
          amount:       Math.round(Number(amount) * 100),
          reference:    ref,
          callback_url: callback_url || "https://kudiai.app/",
          channels:     ["card", "bank", "ussd", "mobile_money", "bank_transfer"],
          subaccount:   org.paystack_subaccount_code || undefined,
          bearer:       org.paystack_subaccount_code ? "account" : undefined,
          metadata: {
            member_id, org_id, member_name: mem.full_name || "",
            type: "org_contribution", program_id: program_id || null,
          },
        }),
      });
      const psData = await psRes.json();
      if (!psData.status || !psData.data?.authorization_url)
        return json({ error: psData.message || "Payment initialization failed" }, 422);

      return json({
        authorization_url: psData.data.authorization_url,
        reference:         ref,
        amount:            Number(amount),
        email:             mem.email,
        public_key:        PAYSTACK_PUBLIC,
      });
    }

    // ── Confirm member Paystack payment & update balances ─────────────────
    if (action === "confirm-member-payment") {
      const { member_id, org_id, reference, program_id } = body as {
        member_id: string; org_id: string; reference: string; program_id?: string;
      };
      if (!member_id || !org_id || !reference) return json({ error: "member_id, org_id, reference required" }, 400);
      if (!PAYSTACK_SECRET) return json({ error: "Paystack not configured" }, 503);

      const verRes = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
        { headers: PS_HEADERS },
      );
      const verData = await verRes.json();
      if (!verData.status || verData.data?.status !== "success")
        return json({ error: "Payment not confirmed by Paystack" }, 422);

      const paidAmount = Number(verData.data.amount) / 100;

      // Idempotency: only process once
      const { data: existing } = await sb.from("org_savings")
        .select("id").eq("paystack_ref", reference).eq("member_id", member_id).maybeSingle();

      if (!existing) {
        const { data: mem } = await sb.from("org_members")
          .select("savings_balance, full_name, email").eq("id", member_id).single();
        const balanceAfter = (mem?.savings_balance || 0) + paidAmount;

        const { data: saving } = await sb.from("org_savings").insert({
          org_id, member_id, amount: paidAmount, type: "deposit",
          payment_method: "paystack", paystack_ref: reference,
          balance_after: balanceAfter, program_id: program_id || null,
        }).select("id").single();

        await sb.from("org_members").update({ savings_balance: balanceAfter }).eq("id", member_id);

        const { data: orgRow } = await sb.from("organizations")
          .select("wallet_balance, total_savings, name, owner_id").eq("id", org_id).single();
        const newWal = (orgRow?.wallet_balance || 0) + paidAmount;
        const newSav = (orgRow?.total_savings  || 0) + paidAmount;
        await sb.from("organizations").update({ wallet_balance: newWal, total_savings: newSav }).eq("id", org_id);

        await sb.from("org_wallet_txns").insert({
          org_id, type: "savings_deposit", amount: paidAmount,
          description: `Member self-pay via Paystack — ${member_id}`,
          reference_id: saving?.id, paystack_ref: reference, balance_after: newWal,
        });

        // Email notification
        let ownerEmail = "";
        if (orgRow?.owner_id) {
          const { data: op } = await sb.from("profiles")
            .select("email").eq("id", orgRow.owner_id).maybeSingle();
          ownerEmail = op?.email || "";
        }
        if (mem?.email) {
          await fetch("https://admin.kudiai.app/api/public/email-trigger", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
            body: JSON.stringify({
              event: "org_saving",
              data: {
                member_name:  mem.full_name || "",
                member_email: mem.email,
                amount:       paidAmount,
                type:         "deposit",
                payment_method: "paystack",
                org_name:     orgRow?.name || "",
                date:         new Date().toLocaleDateString("en-NG"),
                owner_email:  ownerEmail,
                owner_id:     orgRow?.owner_id || "",
                paystack_ref: reference,
              },
            }),
          }).catch(() => null);
        }
      }

      const { data: updatedMember } = await sb.from("org_members")
        .select(MEMBER_SELECT).eq("id", member_id).maybeSingle();
      return json({ member: updatedMember, amount: paidAmount });
    }

    // ── Initialize loan repayment via Paystack (redirect flow) ───────────
    if (action === "initialize-loan-payment") {
      const { member_id, org_id, loan_id, amount, callback_url } = body as {
        member_id: string; org_id: string; loan_id: string; amount: number; callback_url?: string;
      };
      if (!member_id || !org_id || !loan_id || !amount) return json({ error: "member_id, org_id, loan_id, amount required" }, 400);
      if (!PAYSTACK_SECRET) return json({ error: "Paystack not configured on this server" }, 503);

      const { data: mem } = await sb.from("org_members")
        .select("email, full_name").eq("id", member_id).maybeSingle();
      if (!mem?.email) return json({ error: "Member email not found" }, 404);

      const { data: orgRow } = await sb.from("organizations")
        .select("name, paystack_subaccount_code").eq("id", org_id).maybeSingle();
      if (!orgRow) return json({ error: "Organisation not found" }, 404);

      const ref = `LOAN-${loan_id.slice(0, 8).toUpperCase()}-${Date.now()}`;

      const psRes = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: PS_HEADERS,
        body: JSON.stringify({
          email:        mem.email,
          amount:       Math.round(Number(amount) * 100),
          reference:    ref,
          callback_url: callback_url || "https://kudiai.app/",
          channels:     ["card", "bank", "ussd", "mobile_money", "bank_transfer"],
          subaccount:   orgRow.paystack_subaccount_code || undefined,
          bearer:       orgRow.paystack_subaccount_code ? "account" : undefined,
          metadata: { member_id, org_id, loan_id, member_name: mem.full_name || "", type: "loan_repayment" },
        }),
      });
      const psData = await psRes.json();
      if (!psData.status || !psData.data?.authorization_url)
        return json({ error: psData.message || "Payment initialization failed" }, 422);

      return json({ authorization_url: psData.data.authorization_url, reference: ref, amount: Number(amount) });
    }

    // ── Confirm loan repayment via Paystack (called on return from payment page) ─
    if (action === "confirm-loan-payment") {
      const { member_id, org_id, loan_id, reference } = body as {
        member_id: string; org_id: string; loan_id: string; reference: string;
      };
      if (!member_id || !org_id || !loan_id || !reference) return json({ error: "member_id, org_id, loan_id, reference required" }, 400);
      if (!PAYSTACK_SECRET) return json({ error: "Paystack not configured" }, 503);

      const verRes = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
        { headers: PS_HEADERS },
      );
      const verData = await verRes.json();
      if (!verData.status || verData.data?.status !== "success")
        return json({ error: "Payment not confirmed by Paystack" }, 422);

      const paidAmount = Number(verData.data.amount) / 100;

      // Idempotency: only record once
      const { data: existing } = await sb.from("org_loan_repayments")
        .select("id").eq("paystack_ref", reference).maybeSingle();
      if (existing) {
        const { data: loan } = await sb.from("org_loans").select("*").eq("id", loan_id).single();
        return json({ loan, amount: paidAmount, already_confirmed: true });
      }

      const { data: loan } = await sb.from("org_loans")
        .select("outstanding_balance,total_repayable,total_interest,amount_approved,amount_requested,org_id,member_id,loan_purpose")
        .eq("id", loan_id).single();
      if (!loan) return json({ error: "Loan not found" }, 404);

      const newOutstanding   = Math.max(0, (loan.outstanding_balance || 0) - paidAmount);
      const totalRepayable   = loan.total_repayable || (loan.amount_approved || loan.amount_requested);
      const totalInterest    = loan.total_interest  || 0;
      const interestRatio    = totalRepayable > 0 ? (totalInterest / totalRepayable) : 0;
      const interestPortion  = parseFloat((paidAmount * interestRatio).toFixed(2));
      const principalPortion = parseFloat((paidAmount - interestPortion).toFixed(2));

      await sb.from("org_loan_repayments").insert({
        org_id, loan_id, member_id,
        amount: paidAmount, payment_method: "paystack", paystack_ref: reference,
        principal_portion: principalPortion, interest_portion: interestPortion,
      });

      const { data: updatedLoan } = await sb.from("org_loans")
        .update({ outstanding_balance: newOutstanding, status: newOutstanding === 0 ? "repaid" : "disbursed" })
        .eq("id", loan_id).select("*").single();

      const { data: orgW } = await sb.from("organizations")
        .select("wallet_balance,total_loans_out,interest_earned").eq("id", org_id).single();
      await sb.from("organizations").update({
        wallet_balance:  (orgW?.wallet_balance  || 0) + paidAmount,
        total_loans_out: Math.max(0, (orgW?.total_loans_out || 0) - paidAmount),
        interest_earned: (orgW?.interest_earned || 0) + interestPortion,
      }).eq("id", org_id);
      await sb.from("org_wallet_txns").insert({
        org_id, type: "loan_repayment", amount: paidAmount,
        description: `Loan repayment via Paystack — ${loan_id}`,
        paystack_ref: reference, balance_after: (orgW?.wallet_balance || 0) + paidAmount,
      });

      // Notifications: in-app + email for both member and org
      const { data: repayMem } = await sb.from("org_members")
        .select("full_name, email").eq("id", member_id).maybeSingle();
      const { data: repayOrg } = await sb.from("organizations")
        .select("name, owner_id").eq("id", org_id).maybeSingle();

      const memberName = repayMem?.full_name || "A member";
      const fmtAmt = `₦${Number(paidAmount).toLocaleString("en-NG")}`;

      insertNotif(org_id, "org", "success", "loan",
        "Loan Repayment Received 💳",
        `${memberName} paid ${fmtAmt} via Paystack${newOutstanding === 0 ? " — fully repaid!" : `. Balance: ₦${Number(newOutstanding).toLocaleString("en-NG")}`}`,
        "loans");
      insertNotif(org_id, "member", "success", "loan",
        newOutstanding === 0 ? "Loan Fully Repaid! 🎉" : "Repayment Confirmed",
        `${fmtAmt} payment received via Paystack${newOutstanding === 0 ? " — your loan is fully settled!" : `. Outstanding: ₦${Number(newOutstanding).toLocaleString("en-NG")}`}`,
        "loans", member_id);

      const emailData = {
        member_name:        memberName,
        member_email:       repayMem?.email || "",
        org_name:           repayOrg?.name  || "",
        amount:             paidAmount,
        outstanding_balance: newOutstanding,
        is_fully_repaid:    newOutstanding === 0,
        loan_purpose:       (loan as Record<string, unknown>).loan_purpose as string || "",
        payment_method:     "Paystack",
      };
      if (repayMem?.email) {
        await fetch("https://admin.kudiai.app/api/public/email-trigger", {
          method: "POST", headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
          body: JSON.stringify({ event: "org_loan_repayment", data: { ...emailData, send_to: "member" } }),
        }).catch(() => null);
      }
      if (repayOrg?.owner_id) {
        const { data: ownerP } = await sb.from("profiles").select("email").eq("id", repayOrg.owner_id).maybeSingle();
        if (ownerP?.email) {
          await fetch("https://admin.kudiai.app/api/public/email-trigger", {
            method: "POST", headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
            body: JSON.stringify({ event: "org_loan_repayment", data: { ...emailData, send_to: "org", owner_email: ownerP.email } }),
          }).catch(() => null);
        }
      }

      return json({ loan: updatedLoan, amount: paidAmount });
    }

    // ── Member submits a support ticket ──────────────────────────────────
    if (action === "submit-support-ticket") {
      const { member_id, org_id, category, subject, message } = body as {
        member_id: string; org_id: string; category: string; subject: string; message: string;
      };
      if (!member_id || !org_id || !subject?.trim() || !message?.trim())
        return json({ error: "member_id, org_id, subject, message required" }, 400);

      const { data: mem } = await sb.from("org_members")
        .select("full_name, email").eq("id", member_id).maybeSingle();
      if (!mem) return json({ error: "Member not found" }, 404);

      const { data: org } = await sb.from("organizations")
        .select("name, owner_id").eq("id", org_id).maybeSingle();

      const ticketRef = `TKT-${Date.now().toString(36).toUpperCase().slice(-6)}`;
      const ticketData = {
        ticket_ref: ticketRef,
        member_name:  mem.full_name || "",
        member_email: mem.email     || "",
        org_name:     org?.name     || "",
        category:     category      || "General",
        subject:      subject.trim(),
        message:      message.trim(),
        date:         new Date().toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" }),
      };

      // Email org owner
      if (org?.owner_id) {
        const { data: ownerP } = await sb.from("profiles").select("email").eq("id", org.owner_id).maybeSingle();
        if (ownerP?.email) {
          await fetch("https://admin.kudiai.app/api/public/email-trigger", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
            body: JSON.stringify({ event: "org_member_support_ticket", data: { ...ticketData, send_to: "org", owner_email: ownerP.email } }),
          }).catch(() => null);
        }
      }
      // Confirmation email to member
      if (mem.email) {
        await fetch("https://admin.kudiai.app/api/public/email-trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
          body: JSON.stringify({ event: "org_member_support_ticket", data: { ...ticketData, send_to: "member" } }),
        }).catch(() => null);
      }

      // In-app: notify org of new ticket
      insertNotif(org_id, "org", "info", "support",
        "Support Ticket Received",
        `${mem.full_name || "A member"} raised a ticket: ${subject.trim()}`,
        null);

      return json({ success: true, ticket_ref: ticketRef });
    }

    // ── Org owner submits a support ticket ────────────────────────────────
    if (action === "submit-org-support-ticket") {
      const { org_id, category, subject, message } = body as {
        org_id: string; category: string; subject: string; message: string;
      };
      if (!org_id || !subject?.trim() || !message?.trim())
        return json({ error: "org_id, subject, message required" }, 400);

      const { data: org } = await sb.from("organizations")
        .select("name, owner_id, email").eq("id", org_id).maybeSingle();

      const ticketRef = `TKT-${Date.now().toString(36).toUpperCase().slice(-6)}`;

      let ownerEmail = org?.email || "";
      if (org?.owner_id) {
        const { data: ownerP } = await sb.from("profiles").select("email").eq("id", org.owner_id).maybeSingle();
        if (ownerP?.email) ownerEmail = ownerP.email;
      }

      const ticketData = {
        ticket_ref:   ticketRef,
        member_name:  org?.name || "Organisation Owner",
        member_email: ownerEmail,
        org_name:     org?.name || "",
        category:     category  || "General",
        subject:      subject.trim(),
        message:      message.trim(),
        date:         new Date().toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" }),
      };

      // Confirmation to org owner
      if (ownerEmail) {
        await fetch("https://admin.kudiai.app/api/public/email-trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
          body: JSON.stringify({ event: "org_member_support_ticket", data: { ...ticketData, send_to: "member" } }),
        }).catch(() => null);
      }

      // In-app notification
      insertNotif(org_id, "org", "info", "support",
        "Support Ticket Submitted",
        `Your ticket (${ticketRef}) has been received: ${subject.trim()}`,
        null);

      return json({ success: true, ticket_ref: ticketRef });
    }

    // ── Member submits a withdrawal request ───────────────────────────────
    if (action === "request-member-withdrawal") {
      const { member_id, org_id, amount, reason } = body as {
        member_id: string; org_id: string; amount: number; reason?: string;
      };
      const amt = parseFloat(String(amount));
      if (!member_id || !org_id || !amt) return json({ error: "member_id, org_id, amount required" }, 400);

      const { data: mem } = await sb.from("org_members")
        .select("savings_balance, full_name").eq("id", member_id).maybeSingle();
      if (!mem) return json({ error: "Member not found" }, 404);
      if ((mem.savings_balance || 0) < amt) return json({ error: "Insufficient savings balance" }, 400);

      const { data: req, error: reqErr } = await sb.from("org_member_withdrawal_requests")
        .insert({ org_id, member_id, amount: amt, reason: reason || null })
        .select("*").single();
      if (reqErr) return json({ error: reqErr.message }, 400);
      // In-app: notify org of withdrawal request
      insertNotif(String(org_id), "org", "info", "finance",
        "Withdrawal Request",
        `${mem.full_name || "A member"} is requesting a withdrawal of ₦${Number(amt).toLocaleString("en-NG")}`,
        "finance");

      // Notify org owner
      const { data: orgFull } = await sb.from("organizations")
        .select("name, owner_id").eq("id", org_id).maybeSingle();
      if (orgFull?.owner_id) {
        const { data: op } = await sb.from("profiles")
          .select("email").eq("id", orgFull.owner_id).maybeSingle();
        if (op?.email) {
          await fetch("https://admin.kudiai.app/api/public/email-trigger", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
            body: JSON.stringify({
              event: "org_withdrawal_request",
              data: {
                member_name:  mem.full_name || "",
                org_name:     orgFull.name || "",
                owner_email:  op.email,
                amount:       amt,
                reason:       reason || "",
                date:         new Date().toLocaleDateString("en-NG"),
              },
            }),
          }).catch(() => null);
        }
      }

      return json({ request: req });
    }

    // ── Member views their own withdrawal requests ─────────────────────────
    if (action === "get-member-withdrawal-requests") {
      const { member_id } = body as { member_id: string };
      if (!member_id) return json({ error: "member_id required" }, 400);
      const { data: requests } = await sb.from("org_member_withdrawal_requests")
        .select("*").eq("member_id", member_id)
        .order("created_at", { ascending: false }).limit(30);
      return json({ requests: requests || [] });
    }

    // ── Admin views all withdrawal requests for an org ─────────────────────
    if (action === "get-withdrawal-requests-admin") {
      const { org_id, status } = body as { org_id: string; status?: string };
      if (!org_id) return json({ error: "org_id required" }, 400);
      let q = sb.from("org_member_withdrawal_requests")
        .select("*, org_members(full_name, membership_id, savings_balance, email)")
        .eq("org_id", org_id);
      if (status) q = q.eq("status", status);
      const { data: requests } = await q.order("created_at", { ascending: false }).limit(50);
      return json({ requests: requests || [] });
    }

    // ── Admin approves or rejects a withdrawal request ─────────────────────
    if (action === "handle-withdrawal-request") {
      const { request_id, decision, admin_notes, reviewed_by } = body as {
        request_id: string; decision: "approve" | "reject"; admin_notes?: string; reviewed_by?: string;
      };
      if (!request_id || !decision) return json({ error: "request_id and decision required" }, 400);

      const { data: req } = await sb.from("org_member_withdrawal_requests")
        .select("*").eq("id", request_id).maybeSingle();
      if (!req) return json({ error: "Request not found" }, 404);
      if (req.status !== "pending") return json({ error: "Request has already been handled" }, 400);

      if (decision === "approve") {
        const { data: mem } = await sb.from("org_members")
          .select("savings_balance, full_name, email").eq("id", req.member_id).single();
        if (!mem || (mem.savings_balance || 0) < req.amount)
          return json({ error: "Member has insufficient savings balance" }, 400);

        const newBal = (mem.savings_balance || 0) - req.amount;
        await sb.from("org_members").update({ savings_balance: newBal }).eq("id", req.member_id);

        const { data: saving } = await sb.from("org_savings").insert({
          org_id: req.org_id, member_id: req.member_id, amount: req.amount,
          type: "withdrawal", payment_method: "withdrawal_request",
          notes: req.reason || "Withdrawal request approved", balance_after: newBal,
        }).select("id").single();

        const { data: orgRow } = await sb.from("organizations")
          .select("wallet_balance, total_savings").eq("id", req.org_id).single();
        const newWal = Math.max(0, (orgRow?.wallet_balance || 0) - req.amount);
        const newSav = Math.max(0, (orgRow?.total_savings  || 0) - req.amount);
        await sb.from("organizations")
          .update({ wallet_balance: newWal, total_savings: newSav }).eq("id", req.org_id);

        await sb.from("org_wallet_txns").insert({
          org_id: req.org_id, type: "savings_withdrawal", amount: req.amount,
          description: `Member withdrawal approved — ${req.member_id}`,
          reference_id: saving?.id, balance_after: newWal,
        });

        // In-app: notify member approved
        insertNotif(req.org_id, "member", "success", "finance",
          "Withdrawal Approved ✅",
          `Your withdrawal request of ₦${Number(req.amount).toLocaleString("en-NG")} has been approved${admin_notes ? ". " + String(admin_notes).slice(0, 60) : ""}`,
          "contributions", req.member_id);
        if (mem.email) {
          await fetch("https://admin.kudiai.app/api/public/email-trigger", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
            body: JSON.stringify({
              event: "org_withdrawal_approved",
              data: {
                member_name:  mem.full_name || "",
                member_email: mem.email,
                amount:       req.amount,
                admin_notes:  admin_notes || "",
                date:         new Date().toLocaleDateString("en-NG"),
              },
            }),
          }).catch(() => null);
        }
      } else {
        // Rejected — notify member, no balance change
        const { data: mem } = await sb.from("org_members")
          .select("full_name, email").eq("id", req.member_id).maybeSingle();
        // In-app: notify member rejected
        insertNotif(req.org_id, "member", "error", "finance",
          "Withdrawal Declined",
          `Your withdrawal of ₦${Number(req.amount).toLocaleString("en-NG")} was not approved${admin_notes ? ". " + String(admin_notes).slice(0, 60) : ""}`,
          "contributions", req.member_id);
        if (mem?.email) {
          await fetch("https://admin.kudiai.app/api/public/email-trigger", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
            body: JSON.stringify({
              event: "org_withdrawal_rejected",
              data: {
                member_name:  mem.full_name || "",
                member_email: mem.email,
                amount:       req.amount,
                reason:       req.reason || "",
                admin_notes:  admin_notes || "",
                date:         new Date().toLocaleDateString("en-NG"),
              },
            }),
          }).catch(() => null);
        }
      }

      await sb.from("org_member_withdrawal_requests").update({
        status:      decision === "approve" ? "approved" : "rejected",
        admin_notes: admin_notes || null,
        reviewed_by: reviewed_by || null,
        reviewed_at: new Date().toISOString(),
      }).eq("id", request_id);

      return json({ success: true });
    }

    // ══════════════════════════════════════════════════
    //  ORG BILL TRANSACTIONS
    // ══════════════════════════════════════════════════

    if (action === "get-org-bills") {
      const { org_id } = body as { org_id: string };
      if (!org_id) return json({ error: "org_id required" }, 400);
      const { data, error } = await sb
        .from("org_bill_transactions")
        .select("*")
        .eq("org_id", org_id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) return json({ error: error.message }, 400);
      return json({ bills: data });
    }

    if (action === "add-org-bill") {
      const { org_id, category, item_name, customer_name, amount, note, transaction_date, bill_status, payment_type } =
        body as {
          org_id: string; category: string; item_name: string; customer_name?: string;
          amount: number; note?: string; transaction_date?: string; bill_status?: string; payment_type?: string;
        };
      if (!org_id || !category || !item_name) return json({ error: "org_id, category and item_name required" }, 400);
      const { data, error } = await sb
        .from("org_bill_transactions")
        .insert({ org_id, category, item_name, customer_name, amount, note, transaction_date, bill_status: bill_status || "success", payment_type: payment_type || "bill_payment" })
        .select()
        .single();
      if (error) return json({ error: error.message }, 400);
      return json({ bill: data });
    }

    // ══════════════════════════════════════════════════
    //  MEMBER BILL TRANSACTIONS
    // ══════════════════════════════════════════════════

    if (action === "get-member-bills") {
      const { member_id } = body as { member_id: string };
      if (!member_id) return json({ error: "member_id required" }, 400);
      const { data, error } = await sb
        .from("member_bill_transactions")
        .select("*")
        .eq("member_id", member_id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) return json({ error: error.message }, 400);
      return json({ bills: data });
    }

    if (action === "add-member-bill") {
      const { member_id, org_id, category, item_name, customer_name, amount, note, transaction_date, bill_status, payment_type } =
        body as {
          member_id: string; org_id: string; category: string; item_name: string; customer_name?: string;
          amount: number; note?: string; transaction_date?: string; bill_status?: string; payment_type?: string;
        };
      if (!member_id || !org_id || !category || !item_name) return json({ error: "member_id, org_id, category and item_name required" }, 400);
      const { data, error } = await sb
        .from("member_bill_transactions")
        .insert({ member_id, org_id, category, item_name, customer_name, amount, note, transaction_date, bill_status: bill_status || "success", payment_type: payment_type || "bill_payment" })
        .select()
        .single();
      if (error) return json({ error: error.message }, 400);
      return json({ bill: data });
    }

    // ══════════════════════════════════════════════════
    //  BROADCAST STATION — EVENTS
    // ══════════════════════════════════════════════════

    if (action === "create-event") {
      const { org_id, title, description, event_type, event_date, end_date, location, event_link } =
        body as Record<string, string>;
      if (!org_id || !title || !event_date) return json({ error: "org_id, title, event_date required" }, 400);
      const { data: event, error } = await sb.from("org_events")
        .insert({ org_id, title, description: description || null, event_type: event_type || "event",
          event_date, end_date: end_date || null, location: location || null, event_link: event_link || null })
        .select("*").single();
      if (error) return json({ error: error.message }, 400);
      const { data: evtOrg } = await sb.from("organizations").select("name,owner_id").eq("id", org_id).single();
      const { data: evtMems } = await sb.from("org_members").select("id,full_name,email").eq("org_id", org_id).eq("status", "active");
      if (evtOrg) {
        let ownerEmail = "";
        if (evtOrg.owner_id) {
          const { data: ownerP } = await sb.from("profiles").select("email").eq("id", evtOrg.owner_id).maybeSingle();
          ownerEmail = ownerP?.email || "";
        }
        const recipients = [
          ...(ownerEmail ? [{ email: ownerEmail, name: "Admin", is_org: true }] : []),
          ...(evtMems || []).filter((m: { email?: string }) => m.email)
            .map((m: { id: string; full_name: string; email: string }) => ({ email: m.email, name: m.full_name, is_org: false })),
        ];
        for (const r of recipients) {
          await fetch("https://admin.kudiai.app/api/public/email-trigger", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
            body: JSON.stringify({ event: "org_broadcast", data: {
              email: r.email, member_name: r.name, is_org: r.is_org, org_name: evtOrg.name,
              broadcast_type: "Event", title, description: description || "",
              event_type: event_type || "event", event_date, end_date: end_date || "",
              location: location || "", event_link: event_link || "",
            }}),
          }).catch(() => null);
        }
        // In-app: notify each member
        const evtDateStr = event_date ? new Date(event_date).toLocaleDateString("en-NG", { day:"numeric", month:"short" }) : "";
        for (const m of (evtMems || []) as Array<{ id: string; full_name: string; email: string }>) {
          if (!m.id) continue;
          insertNotif(org_id, "member", "info", "broadcast",
            `🎉 ${title}`,
            `${evtDateStr ? evtDateStr + " · " : ""}${location || (event_link ? "Online" : "See details")}`,
            "broadcast", m.id);
        }
      }
      // Post event to group chat
      if (evtOrg?.owner_id) {
        sb.from("org_group_messages").insert({
          org_id, sender_id: evtOrg.owner_id, sender_name: evtOrg.name || "Group",
          sender_role: "org", content: title, type: "event", media_name: event?.id || null,
        }).then(() => null).catch(() => null);
      }
      return json({ event });
    }

    if (action === "get-events") {
      const { org_id } = body as { org_id: string };
      if (!org_id) return json({ error: "org_id required" }, 400);
      const { data, error } = await sb.from("org_events").select("*").eq("org_id", org_id).order("event_date", { ascending: false }).limit(50);
      if (error) return json({ error: error.message }, 400);
      return json({ events: data });
    }

    if (action === "delete-event") {
      const { event_id } = body as { event_id: string };
      if (!event_id) return json({ error: "event_id required" }, 400);
      const { error } = await sb.from("org_events").delete().eq("id", event_id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    // ══════════════════════════════════════════════════
    //  BROADCAST STATION — POLLS
    // ══════════════════════════════════════════════════

    if (action === "create-poll") {
      const { org_id, question, options, closes_at } = body as Record<string, unknown>;
      if (!org_id || !question || !Array.isArray(options) || options.length < 2)
        return json({ error: "org_id, question, and at least 2 options required" }, 400);
      const { data: poll, error } = await sb.from("org_polls")
        .insert({ org_id, question, options, closes_at: closes_at || null })
        .select("*").single();
      if (error) return json({ error: error.message }, 400);
      const { data: pollOrg } = await sb.from("organizations").select("name,owner_id").eq("id", org_id as string).single();
      const { data: pollMems } = await sb.from("org_members").select("id,full_name,email").eq("org_id", org_id as string).eq("status", "active");
      if (pollOrg) {
        let ownerEmail = "";
        if (pollOrg.owner_id) {
          const { data: ownerP } = await sb.from("profiles").select("email").eq("id", pollOrg.owner_id).maybeSingle();
          ownerEmail = ownerP?.email || "";
        }
        const recipients = [
          ...(ownerEmail ? [{ email: ownerEmail, name: "Admin", is_org: true }] : []),
          ...(pollMems || []).filter((m: { email?: string }) => m.email)
            .map((m: { id: string; full_name: string; email: string }) => ({ email: m.email, name: m.full_name, is_org: false })),
        ];
        for (const r of recipients) {
          await fetch("https://admin.kudiai.app/api/public/email-trigger", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
            body: JSON.stringify({ event: "org_broadcast", data: {
              email: r.email, member_name: r.name, is_org: r.is_org, org_name: pollOrg.name,
              broadcast_type: "Poll", title: question,
              poll_options: options as string[], closes_at: closes_at ? String(closes_at) : "",
            }}),
          }).catch(() => null);
        }
        // In-app: notify each member
        const optCount = Array.isArray(options) ? (options as string[]).length : 0;
        for (const m of (pollMems || []) as Array<{ id: string; full_name: string; email: string }>) {
          if (!m.id) continue;
          insertNotif(String(org_id), "member", "info", "broadcast",
            `📊 Poll: ${String(question).slice(0, 60)}`,
            `${optCount} options to vote on${closes_at ? ". Closes " + new Date(String(closes_at)).toLocaleDateString("en-NG", { day:"numeric", month:"short" }) : ""}`,
            "broadcast", m.id);
        }
      }
      // Post poll to group chat
      if (pollOrg?.owner_id) {
        sb.from("org_group_messages").insert({
          org_id: String(org_id), sender_id: pollOrg.owner_id, sender_name: pollOrg.name || "Group",
          sender_role: "org", content: String(question), type: "poll", media_name: poll?.id || null,
        }).then(() => null).catch(() => null);
      }
      return json({ poll });
    }

    if (action === "get-polls") {
      const { org_id } = body as { org_id: string };
      if (!org_id) return json({ error: "org_id required" }, 400);
      const { data: polls, error } = await sb.from("org_polls").select("*").eq("org_id", org_id).order("created_at", { ascending: false }).limit(50);
      if (error) return json({ error: error.message }, 400);
      // Attach vote counts per option
      const pollIds = (polls || []).map((p: Record<string,unknown>) => p.id);
      const { data: votes } = pollIds.length
        ? await sb.from("org_poll_votes").select("poll_id, option_index").in("poll_id", pollIds)
        : { data: [] };
      const voteMap: Record<string, number[]> = {};
      for (const v of (votes || [])) {
        if (!voteMap[v.poll_id]) voteMap[v.poll_id] = [];
        voteMap[v.poll_id].push(v.option_index);
      }
      const enriched = (polls || []).map((p: Record<string,unknown>) => ({
        ...p,
        vote_counts: ((p.options as unknown[]) || []).map((_: unknown, i: number) =>
          (voteMap[p.id as string] || []).filter(v => v === i).length
        ),
        total_votes: (voteMap[p.id as string] || []).length,
      }));
      return json({ polls: enriched });
    }

    if (action === "delete-poll") {
      const { poll_id } = body as { poll_id: string };
      if (!poll_id) return json({ error: "poll_id required" }, 400);
      const { error } = await sb.from("org_polls").delete().eq("id", poll_id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === "member-submit-poll-vote") {
      const { poll_id, member_id, option_index } = body as { poll_id: string; member_id: string; option_index: number };
      if (!poll_id || !member_id || option_index === undefined) return json({ error: "poll_id, member_id, option_index required" }, 400);
      const { data: poll } = await sb.from("org_polls").select("is_active, closes_at").eq("id", poll_id).single();
      if (!poll?.is_active) return json({ error: "This poll is closed" }, 400);
      if (poll.closes_at && new Date(poll.closes_at) < new Date()) return json({ error: "This poll has expired" }, 400);
      const { error } = await sb.from("org_poll_votes")
        .upsert({ poll_id, member_id, option_index }, { onConflict: "poll_id,member_id" });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === "member-get-broadcasts") {
      const { member_id, org_id } = body as { member_id: string; org_id: string };
      if (!org_id || !member_id) return json({ error: "org_id and member_id required" }, 400);
      const [meetingsR, annR, eventsR, pollsR] = await Promise.all([
        sb.from("org_meetings").select("id,title,description,meeting_type,format,scheduled_at,location,meeting_link,agenda,status").eq("org_id", org_id).order("scheduled_at", { ascending: false }).limit(20),
        sb.from("org_announcements").select("id,type,title,body,is_pinned,created_at,author_name").eq("org_id", org_id).order("is_pinned", { ascending: false }).order("created_at", { ascending: false }).limit(30),
        sb.from("org_events").select("*").eq("org_id", org_id).order("event_date", { ascending: false }).limit(20),
        sb.from("org_polls").select("*").eq("org_id", org_id).eq("is_active", true).order("created_at", { ascending: false }).limit(10),
      ]);
      // Attach RSVP for meetings
      const meetingIds = (meetingsR.data || []).map((m: Record<string,unknown>) => m.id);
      const { data: rsvps } = meetingIds.length
        ? await sb.from("org_meeting_rsvps").select("meeting_id, status").eq("member_id", member_id).in("meeting_id", meetingIds)
        : { data: [] };
      const rsvpMap: Record<string, string> = {};
      for (const r of (rsvps || [])) rsvpMap[r.meeting_id] = r.status;
      // Attach member poll vote
      const pollIds = (pollsR.data || []).map((p: Record<string,unknown>) => p.id);
      const { data: myVotes } = pollIds.length
        ? await sb.from("org_poll_votes").select("poll_id, option_index").eq("member_id", member_id).in("poll_id", pollIds)
        : { data: [] };
      const voteMap: Record<string, number> = {};
      for (const v of (myVotes || [])) voteMap[v.poll_id] = v.option_index;
      // Vote counts for polls
      const { data: allVotes } = pollIds.length
        ? await sb.from("org_poll_votes").select("poll_id, option_index").in("poll_id", pollIds)
        : { data: [] };
      const pollVoteMap: Record<string, number[]> = {};
      for (const v of (allVotes || [])) {
        if (!pollVoteMap[v.poll_id]) pollVoteMap[v.poll_id] = [];
        pollVoteMap[v.poll_id].push(v.option_index);
      }
      const meetings = (meetingsR.data || []).map((m: Record<string,unknown>) => ({ ...m, _type: "meeting", my_rsvp: rsvpMap[m.id as string] || null }));
      const announcements = (annR.data || []).map((a: Record<string,unknown>) => ({ ...a, _type: "announcement" }));
      const events = (eventsR.data || []).map((e: Record<string,unknown>) => ({ ...e, _type: "event" }));
      const polls = (pollsR.data || []).map((p: Record<string,unknown>) => ({
        ...p, _type: "poll",
        my_vote: voteMap[p.id as string] ?? null,
        vote_counts: ((p.options as unknown[]) || []).map((_: unknown, i: number) => (pollVoteMap[p.id as string] || []).filter(v => v === i).length),
        total_votes: (pollVoteMap[p.id as string] || []).length,
      }));
      // Merge and sort by date descending
      const all = [...meetings, ...announcements, ...events, ...polls].sort((a: Record<string,unknown>, b: Record<string,unknown>) => {
        const dateA = (a.scheduled_at || a.event_date || a.created_at) as string;
        const dateB = (b.scheduled_at || b.event_date || b.created_at) as string;
        return new Date(dateB).getTime() - new Date(dateA).getTime();
      });
      return json({ broadcasts: all });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});
