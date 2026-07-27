import { useState, useEffect, useCallback, useRef } from "react";
import { supabase, supabaseConfigured } from "../utils/supabase";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { fetchAndCachePlans, invalidatePlansCache, normalizeSlug, hasHigherPlanAvailable } from "../utils/plans";
import { sendEmailTrigger, setEmailToken } from "../utils/emailTrigger";

const CACHE_KEY = "kuditrack_plan";
const SESSION_LOGGED_KEY = "kuditrack_sess_logged";
const WELCOME_EMAIL_KEY = "kuditrack_welcome_sent";

// Per-portal row caches — written on every successful resolve, read when the
// matching DB query fails with a network error (offline / flaky connection).
// Cleared on explicit sign-out so they never bleed into a different account.
const AJO_CLIENT_CACHE_KEY = "kuditrack_ajo_client";
const ORG_MEMBER_CACHE_KEY = "kuditrack_org_member";
const STAFF_CACHE_KEY      = "kuditrack_staff";
const MARKETER_CACHE_KEY   = "kuditrack_marketer";
const ORG_CACHE_KEY        = "kuditrack_org";
const PROFILE_CACHE_KEY    = "kuditrack_profile";

// Network error classifier — shared across all early-routing branches.
// "data: null, error: FetchError" from Supabase means the fetch never completed,
// NOT that the row was absent. Must not treat this as "account not found".
const isNetErr = (e) => !!e && (
  (e.message || "").includes("Load failed") ||
  (e.message || "").includes("Failed to fetch") ||
  (e.message || "").includes("NetworkError") ||
  (e.message || "").includes("network")
);

function fireWelcomeEmail(event, data) {
  const sentKey = `${WELCOME_EMAIL_KEY}_${data.email || data.name}`;
  if (sessionStorage.getItem(sentKey)) return;
  sessionStorage.setItem(sentKey, "1");
  sendEmailTrigger(event, data);
}

async function logPlatformSession(supabaseClient, userId, userType, username, email) {
  try {
    // Only log once per tab/session to avoid duplicates on token refresh events
    const key = `${SESSION_LOGGED_KEY}_${userId}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");

    let ip = null, city = null, country = null, latitude = null, longitude = null;
    try {
      const geo = await fetch("https://ipapi.co/json/", { signal: AbortSignal.timeout(4000) });
      if (geo.ok) {
        const g = await geo.json();
        ip = g.ip; city = g.city; country = g.country_name;
        latitude = g.latitude; longitude = g.longitude;
      }
    } catch { /* geolocation optional */ }

    const ua = typeof navigator !== "undefined" ? (navigator.userAgent || "") : "";
    const deviceType = /Mobi|Android/i.test(ua) ? "mobile" : "desktop";
    const browser = /Chrome/i.test(ua) ? "Chrome" : /Firefox/i.test(ua) ? "Firefox" : /Safari/i.test(ua) ? "Safari" : "Other";
    const osName  = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iOS" : /Windows/i.test(ua) ? "Windows" : /Mac/i.test(ua) ? "macOS" : "Other";

    await supabaseClient.from("platform_sessions").insert({
      user_id: userId, user_type: userType, username: username || null, email: email || null,
      ip_address: ip, city, country, latitude, longitude,
      device_type: deviceType, browser, os_name: osName,
    });
  } catch { /* session logging is non-critical */ }
}

export function useAuth() {
  const [status,         setStatus]         = useState("loading");
  const [plansVersion,   setPlansVersion]   = useState(0);
  const [session,        setSession]        = useState(null);
  const [plan,           setPlan]           = useState(() => normalizeSlug(localStorage.getItem(CACHE_KEY) || "starter"));
  const [upgradeAvailable, setUpgradeAvailable] = useState(false);
  const [staff,          setStaff]          = useState(null);
  const [ajoClient, setAjoClient] = useState(null);
  const [orgMember, setOrgMember] = useState(null);
  const [adminUser, setAdminUser] = useState(null);
  const [marketer,  setMarketer]  = useState(null);
  const [org,       setOrg]       = useState(null);

  // Tracks whether we've already confirmed a subscription this session.
  // A ref (not state) so reads inside async callbacks are always current.
  const subVerified = useRef(false);
  // Retry counter for the profile query — reset on sign-out or successful profile load.
  const profileRetryRef = useRef(0);

  const resolve = useCallback(async (sess) => {
    try {
    if (!sess) {
      setEmailToken(null);
      setSession(null);
      setStatus("unauthenticated");
      setStaff(null);
      setAjoClient(null);
      setOrgMember(null);
      setAdminUser(null);
      setMarketer(null);
      setOrg(null);
      subVerified.current = false;
      profileRetryRef.current = 0;
      // Do NOT clear CACHE_KEY here — if the next login's DB query has a transient
      // failure the cached plan prevents a false "subscribing" redirect.
      // Portal row caches ARE cleared on sign-out so they never bleed into another account.
      localStorage.removeItem(AJO_CLIENT_CACHE_KEY);
      localStorage.removeItem(ORG_MEMBER_CACHE_KEY);
      localStorage.removeItem(STAFF_CACHE_KEY);
      localStorage.removeItem(MARKETER_CACHE_KEY);
      localStorage.removeItem(ORG_CACHE_KEY);
      localStorage.removeItem(PROFILE_CACHE_KEY);
      return;
    }

    setEmailToken(sess.access_token);
    setSession(sess);
    const uid         = sess.user.id;
    const email       = sess.user.email;
    const accountType = sess.user.user_metadata?.account_type;
    const mustChange  = sess.user.user_metadata?.must_change_password === true;

    // ── Super Admin early routing ─────────────────────────────────────
    if (accountType === "super_admin") {
      const { data: adminRow } = await supabase
        .from("admin_users")
        .select("id, username, role, can_create_admins")
        .eq("user_id", uid)
        .eq("is_active", true)
        .maybeSingle();
      if (adminRow) {
        setAdminUser(adminRow);
        subVerified.current = true;
        logPlatformSession(supabase, uid, "admin", adminRow.username, email);
        setStatus("admin");
        return;
      }
      await supabase.auth.signOut();
      setStatus("unauthenticated");
      return;
    }

    // ── Org Member early routing ──────────────────────────────────────
    // Bypass the profile check entirely so a member who accidentally ended
    // up with a profiles row is still routed to their member portal.
    if (accountType === "org_member") {
      // member_otp_verified is our custom flag — never auto-set by Supabase.
      // Old members (must_change_password: false) skip directly to org_member.
      const memberOtpVerified = sess.user.user_metadata?.member_otp_verified === true;

      const { data: orgMemberRow, error: orgMemberErr } = await supabase.rpc("get_my_membership");
      if (orgMemberRow) {
        localStorage.setItem(ORG_MEMBER_CACHE_KEY, JSON.stringify(orgMemberRow));
        setOrgMember({ ...orgMemberRow, org: orgMemberRow.organizations });
        subVerified.current = true;
        logPlatformSession(supabase, uid, "org_member", orgMemberRow.full_name, email);
        if (orgMemberRow.portal_active === false) {
          setStatus("org_member_archived");
          return;
        }
        if (mustChange && !memberOtpVerified) {
          // New member — must verify email OTP before changing password
          setStatus("org_member_otp");
        } else if (mustChange) {
          setStatus("org_member_setup");
        } else {
          setStatus("org_member");
        }
        return;
      }
      // Network error: route by cached row so the member isn't signed out offline.
      if (isNetErr(orgMemberErr)) {
        const raw = localStorage.getItem(ORG_MEMBER_CACHE_KEY);
        if (raw) {
          try {
            const cached = JSON.parse(raw);
            setOrgMember({ ...cached, org: cached.organizations });
            subVerified.current = true;
            if (cached.portal_active === false) {
              setStatus("org_member_archived");
              return;
            }
            setStatus("org_member");
            return;
          } catch { /* corrupted cache — fall through to offline screen */ }
        }
        setStatus("offline");
        return;
      }
      // Row genuinely absent — sign out
      await supabase.auth.signOut();
      setStatus("unauthenticated");
      return;
    }

    // ── Ajo Client early routing ──────────────────────────────────────
    if (accountType === "ajo_client") {
      const { data: ajoClientRow, error: ajoClientErr } = await supabase
        .from("aso_clients")
        .select("id, full_name, user_id, client_user_id, profile_image_url, membership_number, email, current_balance, total_saved, total_withdrawn, next_contribution_date, contribution_amount, contribution_frequency, status, registration_charge, withdrawal_fee_percent, ajo_group_id, portal_active, archived_at")
        .eq("client_user_id", uid)
        .maybeSingle();
      if (ajoClientRow) {
        localStorage.setItem(AJO_CLIENT_CACHE_KEY, JSON.stringify(ajoClientRow));
        setAjoClient({ ...ajoClientRow, owner_id: ajoClientRow.user_id });
        subVerified.current = true;
        logPlatformSession(supabase, uid, "ajo_client", ajoClientRow.full_name, email);
        // Archived clients see a reactivation screen — skip PIN/consent gates
        if (ajoClientRow.portal_active === false) {
          setStatus("ajo_client_archived");
          return;
        }
        // Use custom flag — Supabase overwrites email_verified when email_confirm:true is set at creation
        const ajoOtpVerified = sess.user.user_metadata?.ajo_client_otp_verified === true;
        if (mustChange && !ajoOtpVerified) {
          setStatus("ajo_client_otp");
        } else if (mustChange) {
          fireWelcomeEmail("ajo_client_first_login", { name: ajoClientRow.full_name || "", email: email || "" });
          setStatus("ajo_client_setup");
        } else {
          setStatus("ajo_client");
        }
        return;
      }
      // Network error: serve the cached row so the client isn't signed out while offline.
      // The portal's own isStale banner will surface the offline state.
      if (isNetErr(ajoClientErr)) {
        const raw = localStorage.getItem(AJO_CLIENT_CACHE_KEY);
        if (raw) {
          try {
            const cached = JSON.parse(raw);
            setAjoClient({ ...cached, owner_id: cached.user_id });
            subVerified.current = true;
            setStatus(cached.portal_active === false ? "ajo_client_archived" : "ajo_client");
            return;
          } catch { /* corrupted cache — fall through to offline screen */ }
        }
        // No usable cache: show a dedicated offline screen. Session is preserved
        // so the next successful network attempt routes correctly without re-login.
        setStatus("offline");
        return;
      }
      // Row genuinely absent (not a network error) — sign out
      await supabase.auth.signOut();
      setStatus("unauthenticated");
      return;
    }

    // ── Marketer early routing ────────────────────────────────────────
    if (accountType === "marketer") {
      const { data: marketerRow, error: marketerErr } = await supabase
        .from("brm_marketers")
        .select("id, owner_id, username, full_name, email, phone, territory, commission_rate, status, profile_image_url, total_clients, total_commission_earned")
        .eq("owner_id", uid)
        .eq("status", "active")
        .maybeSingle();
      if (marketerRow) {
        localStorage.setItem(MARKETER_CACHE_KEY, JSON.stringify(marketerRow));
        setMarketer(marketerRow);
        subVerified.current = true;
        logPlatformSession(supabase, uid, "marketer", marketerRow.full_name || marketerRow.username, email);
        if (mustChange) {
          fireWelcomeEmail("marketer_first_login", {
            name: marketerRow.full_name || marketerRow.username || "",
            email: email || "",
          });
          setStatus("marketer_setup");
        } else {
          setStatus("marketer");
        }
        return;
      }
      if (isNetErr(marketerErr)) {
        const raw = localStorage.getItem(MARKETER_CACHE_KEY);
        if (raw) {
          try {
            const cached = JSON.parse(raw);
            setMarketer(cached);
            subVerified.current = true;
            setStatus("marketer");
            return;
          } catch { /* corrupted cache */ }
        }
        setStatus("offline");
        return;
      }
      await supabase.auth.signOut();
      setStatus("unauthenticated");
      return;
    }

    // ── Staff early routing ───────────────────────────────────────────
    // Bypass the profile check entirely so a staff member who ended up
    // with a profiles row (via DB trigger on auth user creation) is still
    // routed to their staff portal, not to business onboarding.
    if (accountType === "staff") {
      let { data: staffRow, error: staffErr } = await supabase
        .from("staff")
        .select("*, staff_permissions(*)")
        .eq("user_id", uid)
        .maybeSingle();

      // Network error on the first query: skip the legacy email fallback
      // (it would also fail) and go straight to cache/offline handling.
      if (!staffRow && isNetErr(staffErr)) {
        const raw = localStorage.getItem(STAFF_CACHE_KEY);
        if (raw) {
          try {
            const cached = JSON.parse(raw);
            setStaff({ ...cached, user_id: uid });
            subVerified.current = true;
            setStatus(cached.role === "manager" && cached.branch_id ? "branch_manager" : "staff");
            return;
          } catch { /* corrupted cache */ }
        }
        setStatus("offline");
        return;
      }

      if (!staffRow) {
        const { data: legacyStaff } = await supabase
          .from("staff")
          .select("*, staff_permissions(*)")
          .eq("email", email)
          .maybeSingle();
        staffRow = legacyStaff;
      }

      if (staffRow) {
        if (!staffRow.user_id) {
          await supabase.from("staff").update({ user_id: uid }).eq("id", staffRow.id);
        }
        localStorage.setItem(STAFF_CACHE_KEY, JSON.stringify({ ...staffRow, user_id: uid }));
        setStaff({ ...staffRow, user_id: uid });
        subVerified.current = true;
        logPlatformSession(supabase, uid, "staff", staffRow.full_name, email);
        const otpVerified = sess.user.user_metadata?.staff_otp_verified === true;
        if (mustChange && !otpVerified) {
          setStatus("staff_otp");
        } else if (mustChange) {
          fireWelcomeEmail("staff_first_login", { name: staffRow.full_name || "", email: email || "" });
          setStatus("staff_setup");
        } else if (staffRow.role === "manager" && staffRow.branch_id) {
          setStatus("branch_manager");
        } else {
          setStatus("staff");
        }
        return;
      }

      // No staff record found — block access rather than drop into business onboarding
      await supabase.auth.signOut();
      setStatus("unauthenticated");
      return;
    }

    // ── Organisation portal routing ───────────────────────────────────
    if (accountType === "organisation") {
      let { data: orgRow, error: orgErr } = await supabase.rpc("get_my_org");

      // Retry once on transient network errors before giving up
      if (!orgRow && isNetErr(orgErr)) {
        await new Promise(r => setTimeout(r, 2000));
        ({ data: orgRow, error: orgErr } = await supabase.rpc("get_my_org"));
      }

      if (orgRow) {
        if (orgRow.status !== "active") {
          const msg = "Your organisation account is not active. Please contact the business that set up your portal.";
          sessionStorage.setItem("auth_block_reason", msg);
          window.dispatchEvent(new CustomEvent("kuditrack_auth_error", { detail: msg }));
          await supabase.auth.signOut();
          setStatus("unauthenticated");
          return;
        }
        localStorage.setItem(ORG_CACHE_KEY, JSON.stringify(orgRow));
        setOrg(orgRow);
        subVerified.current = true;
        logPlatformSession(supabase, uid, "organisation", orgRow.name, email);
        // org_otp_verified is our custom flag — never auto-set by Supabase.
        // email_verified CAN be overwritten by email_confirm:true at account creation.
        const orgOtpVerified = sess.user.user_metadata?.org_otp_verified === true;
        if (mustChange && !orgOtpVerified) {
          setStatus("org_otp");
        } else if (mustChange) {
          setStatus("org_setup");
        } else {
          setStatus("organisation");
        }
        return;
      }

      // Network error even after retry: try cached row, then show offline screen.
      // Session is preserved so the next successful network attempt routes correctly.
      if (isNetErr(orgErr)) {
        const raw = localStorage.getItem(ORG_CACHE_KEY);
        if (raw) {
          try {
            const cached = JSON.parse(raw);
            if (cached.status === "active") {
              setOrg(cached);
              subVerified.current = true;
              setStatus("organisation");
              return;
            }
          } catch { /* corrupted cache */ }
        }
        setStatus("offline");
        return;
      }

      const reason = orgErr
        ? `Organisation login error: ${orgErr.message}`
        : "Organisation not found. Please contact the business that set up your portal.";
      // Use sessionStorage so the message survives the sign-out/remount cycle
      sessionStorage.setItem("auth_block_reason", reason);
      window.dispatchEvent(new CustomEvent("kuditrack_auth_error", { detail: reason }));
      await supabase.auth.signOut();
      setStatus("unauthenticated");
      return;
    }

    // ── Hard gate: block known non-business account types from reaching business portals ──
    const PORTAL_ACCOUNT_TYPES = ["super_admin", "org_member", "ajo_client", "marketer", "organisation"];
    if (PORTAL_ACCOUNT_TYPES.includes(accountType)) {
      const msg = "This account cannot sign in here. Please use the portal you were registered for.";
      sessionStorage.setItem("auth_block_reason", msg);
      window.dispatchEvent(new CustomEvent("kuditrack_auth_error", { detail: msg }));
      await supabase.auth.signOut();
      setStatus("unauthenticated");
      return;
    }

    // ── Admin fallback: check admin_users by user_id ─────────────────
    // Catches super_admin even when account_type metadata is missing/wrong.
    const { data: adminFallback } = await supabase
      .from("admin_users")
      .select("id, username, role, can_create_admins")
      .eq("user_id", uid)
      .eq("is_active", true)
      .maybeSingle();
    if (adminFallback) {
      setAdminUser(adminFallback);
      subVerified.current = true;
      setStatus("admin");
      return;
    }

    // ── Org portal fallback (before profile check) ────────────────────
    // Catches org portal users even if account_type metadata is missing
    // OR if they somehow have a profiles row (which would skip the block below).
    // get_my_org() is a SECURITY DEFINER fn — returns null for non-org users.
    if (!accountType || accountType === "organisation") {
      const { data: orgPreCheck } = await supabase.rpc("get_my_org");
      if (orgPreCheck) {
        if (orgPreCheck.status !== "active") {
          const msg = "Your organisation account is not active. Please contact the business that set up your portal.";
          sessionStorage.setItem("auth_block_reason", msg);
          window.dispatchEvent(new CustomEvent("kuditrack_auth_error", { detail: msg }));
          await supabase.auth.signOut();
          setStatus("unauthenticated");
          return;
        }
        setOrg(orgPreCheck);
        subVerified.current = true;
        logPlatformSession(supabase, uid, "organisation", orgPreCheck.name, email);
        const emailVerified = sess.user.user_metadata?.email_verified !== false;
        if (!emailVerified) { setStatus("org_otp"); } else if (mustChange) { setStatus("org_setup"); } else { setStatus("organisation"); }
        return;
      }
    }

    // ── Onboarding check (business owners) ───────────────────────────
    let { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, business_name")
      .eq("id", uid)
      .maybeSingle();

    if (profileError && !profile) {
      // Network error — retry up to 3 times (3 s, 6 s, 9 s) before giving up.
      // Prevents a transient failure from falsely sending a user with an existing
      // profile into the onboarding / "create profile" flow.
      if (isNetErr(profileError) && profileRetryRef.current < 3) {
        profileRetryRef.current++;
        setTimeout(() => resolve(sess), 3000 * profileRetryRef.current);
        return;
      }
      profileRetryRef.current = 0;
      // After retries (or non-network error): check local profile cache so an
      // offline business owner is never dumped into onboarding.
      if (isNetErr(profileError)) {
        try {
          const cp = JSON.parse(localStorage.getItem(PROFILE_CACHE_KEY) || "null");
          if (cp?.user_id === uid && cp?.business_name) profile = cp;
        } catch {}
        if (!profile) { setStatus("offline"); return; }
      }
    } else {
      profileRetryRef.current = 0; // Reset on successful DB response.
      // Cache the profile so offline reloads can skip onboarding.
      if (profile?.business_name) {
        try { localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({ ...profile, user_id: uid })); } catch {}
      }
    }

    if (!profile || !profile.business_name) {
      // Block OAuth logins for staff / ajo_client emails — they must use email+password
      const isOAuth = !!(sess.user.app_metadata?.provider && sess.user.app_metadata.provider !== "email");
      if (isOAuth && email) {
        const [{ data: staffByEmail }, { data: ajoByEmail }, { data: orgMemberByEmail }] = await Promise.all([
          supabase.from("staff").select("id").eq("email", email).maybeSingle(),
          supabase.from("aso_clients").select("id").eq("email", email).maybeSingle(),
          supabase.from("org_members").select("id").eq("email", email).maybeSingle(),
        ]);
        if (staffByEmail || ajoByEmail || orgMemberByEmail) {
          const role = staffByEmail ? "staff member" : ajoByEmail ? "savings client" : "organisation member";
          sessionStorage.setItem(
            "auth_block_reason",
            `This email is registered as a ${role} account. Google login is not available for ${role}s — please sign in with your email and password instead.`,
          );
          await supabase.auth.signOut();
          return;
        }
      }

      // No owner profile — check if they are a staff member
      let { data: staffRow } = await supabase
        .from("staff")
        .select("*, staff_permissions(*)")
        .eq("user_id", uid)
        .maybeSingle();

      if (!staffRow) {
        const { data: legacyStaff } = await supabase
          .from("staff")
          .select("*, staff_permissions(*)")
          .eq("email", email)
          .maybeSingle();
        staffRow = legacyStaff;
      }

      if (staffRow) {
        // Link auth user_id to staff record on first login
        if (!staffRow.user_id) {
          await supabase.from("staff").update({ user_id: uid }).eq("id", staffRow.id);
        }
        setStaff({ ...staffRow, user_id: uid });
        subVerified.current = true;
        logPlatformSession(supabase, uid, "staff", staffRow.full_name, email);
        // staff_otp_verified is our custom flag, set to true only after the staff
        // enters the correct OTP code. We avoid email_verified because Supabase
        // can set that automatically based on email_confirm:true at account creation.
        const otpVerified = sess.user.user_metadata?.staff_otp_verified === true;
        if (mustChange && !otpVerified) {
          setStatus("staff_otp");
        } else if (mustChange) {
          fireWelcomeEmail("staff_first_login", { name: staffRow.full_name || "", email: email || "" });
          setStatus("staff_setup");
        } else if (staffRow.role === "manager" && staffRow.branch_id) {
          setStatus("branch_manager");
        } else {
          setStatus("staff");
        }
        return;
      }

      // ── Ajo Client check ───────────────────────────────────────────
      const { data: ajoClientRow } = await supabase
        .from("aso_clients")
        .select("id, full_name, user_id, client_user_id, profile_image_url, membership_number, email, current_balance, total_saved, total_withdrawn, next_contribution_date, contribution_amount, contribution_frequency, status, registration_charge, withdrawal_fee_percent, ajo_group_id")
        .eq("client_user_id", uid)
        .maybeSingle();

      if (ajoClientRow) {
        setAjoClient({ ...ajoClientRow, owner_id: ajoClientRow.user_id });
        subVerified.current = true;
        // Use custom flag — Supabase overwrites email_verified when email_confirm:true is set at creation
        const ajoOtpVerified2 = sess.user.user_metadata?.ajo_client_otp_verified === true;
        if (mustChange && !ajoOtpVerified2) {
          setStatus("ajo_client_otp");
        } else if (mustChange) {
          fireWelcomeEmail("ajo_client_first_login", { name: ajoClientRow.full_name || "", email: email || "" });
          setStatus("ajo_client_setup");
        } else {
          setStatus("ajo_client");
        }
        return;
      }

      // ── Org Member check ──────────────────────────────────────────
      const { data: orgMemberRow } = await supabase.rpc("get_my_membership");

      if (orgMemberRow) {
        setOrgMember({ ...orgMemberRow, org: orgMemberRow.organizations });
        subVerified.current = true;
        const memberOtpVerified = sess.user.user_metadata?.member_otp_verified === true;
        if (mustChange && !memberOtpVerified) {
          setStatus("org_member_otp");
        } else if (mustChange) {
          setStatus("org_member_setup");
        } else {
          setStatus("org_member");
        }
        return;
      }

      // ── Final gate: block non-business emails from reaching business onboarding ──
      // If the email is found in any staff table, it must not register as a business.
      if (email) {
        const [{ data: staffByEmail }, { data: ajoByEmail }, { data: orgMemberByEmail }] = await Promise.all([
          supabase.from("staff").select("id").eq("email", email).maybeSingle(),
          supabase.from("aso_clients").select("id").eq("email", email).maybeSingle(),
          supabase.from("org_members").select("id").eq("email", email).maybeSingle(),
        ]);
        if (staffByEmail || ajoByEmail || orgMemberByEmail) {
          const roleLabel = staffByEmail ? "staff member" : ajoByEmail ? "savings client" : "organisation member";
          window.dispatchEvent(new CustomEvent("kuditrack_auth_error", {
            detail: `This email is registered as a ${roleLabel}. It cannot be used to sign up as a business. Please sign in with the correct portal.`,
          }));
          await supabase.auth.signOut();
          setStatus("unauthenticated");
          return;
        }
      }

      // Safety net: catch org portal users whose account_type metadata was lost.
      // get_my_org() is SECURITY DEFINER and matches by portal_user_id OR email.
      const { data: orgSafetyCheck } = await supabase.rpc("get_my_org");
      if (orgSafetyCheck) {
        if (orgSafetyCheck.status !== "active") {
          const msg = "Your organisation account is not active. Please contact the business that set up your portal.";
          sessionStorage.setItem("auth_block_reason", msg);
          window.dispatchEvent(new CustomEvent("kuditrack_auth_error", { detail: msg }));
          await supabase.auth.signOut();
          setStatus("unauthenticated");
          return;
        }
        setOrg(orgSafetyCheck);
        subVerified.current = true;
        logPlatformSession(supabase, uid, "organisation", orgSafetyCheck.name, email);
        if (mustChange) { setStatus("org_setup"); } else { setStatus("organisation"); }
        return;
      }

      setStatus("onboarding");
      return;
    }

    // ── Subscription check ────────────────────────────────────────
    // If we already confirmed a subscription this session (via setReady or a
    // previous successful DB read), skip the DB re-query entirely.
    // This prevents token-refresh onAuthStateChange events from reverting status.
    if (subVerified.current) {
      setStatus("ready");
      return;
    }

    const { data: sub, error: subQueryErr } = await supabase
      .from("subscriptions")
      .select("id, plan, expires_at, cancel_at_period_end, billing_cycle")
      .eq("user_id", uid)
      .eq("status", "active")
      .maybeSingle();

    if (sub) {
      // If the user previously cancelled and their paid period has now expired,
      // auto-move them to the free plan so they don't retain paid features.
      if (sub.cancel_at_period_end && sub.expires_at && new Date(sub.expires_at) < new Date()) {
        await supabase.from("subscriptions").update({
          plan: "kobo",
          expires_at: null,
          cancel_at_period_end: false,
          cancelled_at: null,
        }).eq("id", sub.id).catch(() => {});
        sub.plan = "kobo";
        sub.expires_at = null;
        sub.cancel_at_period_end = false;
      }

      // DB confirmed — normalize slug (business→basic, premium→professional) and cache
      const resolvedPlan = normalizeSlug(sub.plan) || "starter";
      setPlan(resolvedPlan);
      localStorage.setItem(CACHE_KEY, resolvedPlan);
      subVerified.current = true;
      logPlatformSession(supabase, uid, "business", sess.user.user_metadata?.full_name || sess.user.user_metadata?.owner_name, email);
      // Await plans fetch so feature_keys from DB are warm before first render
      await fetchAndCachePlans(supabase).catch(() => {});
      setUpgradeAvailable(hasHigherPlanAvailable(resolvedPlan));
      setStatus("ready");
      return;
    }

    // Table query returned nothing — try the SECURITY DEFINER RPC which bypasses RLS.
    // This is the same function staff dashboards use and always works even when
    // the direct subscriptions SELECT policy is missing or the row is slow to appear.
    let rpcPlan = null;
    try { rpcPlan = (await supabase.rpc("get_owner_plan")).data; } catch {}
    if (rpcPlan && rpcPlan !== "starter") {
      const resolvedPlan = normalizeSlug(rpcPlan);
      setPlan(resolvedPlan);
      localStorage.setItem(CACHE_KEY, resolvedPlan);
      subVerified.current = true;
      logPlatformSession(supabase, uid, "business", sess.user.user_metadata?.full_name || sess.user.user_metadata?.owner_name, email);
      await fetchAndCachePlans(supabase).catch(() => {});
      setUpgradeAvailable(hasHigherPlanAvailable(resolvedPlan));
      setStatus("ready");
      return;
    }

    // localStorage cache — only as a network-failure fallback.
    // Only trust the cache when the subscription query itself failed with a network
    // error (subQueryErr != null). When the query succeeded and returned null (sub=null,
    // subQueryErr=null), the DB definitively confirmed no subscription — never use the
    // cache in that case, as it would let new users bypass the subscription page entirely
    // (the cache may contain a stale plan from a different account on the same device).
    if (isNetErr(subQueryErr)) {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const cachedPlan = normalizeSlug(cached);
        setPlan(cachedPlan);
        subVerified.current = true;
        await fetchAndCachePlans(supabase).catch(() => {});
        setUpgradeAvailable(hasHigherPlanAvailable(cachedPlan));
        setStatus("ready");
        return;
      }
    }

    // Genuinely no subscription found
    setStatus("subscribing");
    } catch (err) {
      console.error("[useAuth] resolve error:", err?.message || err);
      const isNetError = isNetErr(err);
      if (isNetError) {
        // Retry once after 2 s before giving up
        await new Promise(r => setTimeout(r, 2000));
        try {
          const { data } = await supabase.auth.getSession();
          if (data.session) { await resolve(data.session); return; }
        } catch { /* fall through */ }
      }
      window.dispatchEvent(new CustomEvent("kuditrack_auth_error", {
        detail: isNetError
          ? "Network error. Check your connection and try signing in again."
          : `Sign-in error: ${err?.message || "unknown"}`,
      }));
      // Network errors don't destroy the session — show offline screen so the
      // user can retry without losing their signed-in state.
      setStatus(isNetError ? "offline" : "unauthenticated");
    }
  }, []);

  useEffect(() => {
    if (!supabaseConfigured) { setStatus("unauthenticated"); return; }
    supabase.auth.getSession().then(({ data }) => resolve(data.session));
    const { data: { subscription: listener } } =
      supabase.auth.onAuthStateChange((_e, s) => resolve(s));

    let appUrlListener;
    if (Capacitor.isNativePlatform()) {
      App.addListener("appUrlOpen", async ({ url }) => {
        if (url.startsWith("com.amayatechnologies.kuditrack://login-callback")) {
          // Signal browserFinished that we are handling this URL so it does not
          // race to declare failure while exchangeCodeForSession is in flight.
          sessionStorage.setItem("kuditrack_oauth_exchange", "1");
          try { await Browser.close(); } catch { /* custom tab may already be dismissed */ }
          // Supabase v2 uses PKCE by default — redirect contains ?code=... not #access_token=...
          // exchangeCodeForSession handles both PKCE codes and implicit token hashes
          const { error } = await supabase.auth.exchangeCodeForSession(url);
          sessionStorage.removeItem("kuditrack_oauth_exchange");
          if (error) {
            // Fallback for implicit flow (token in URL hash)
            const hashStr = url.split("#")[1] || "";
            const params = new URLSearchParams(hashStr);
            const access_token = params.get("access_token");
            const refresh_token = params.get("refresh_token");
            if (access_token && refresh_token) {
              await supabase.auth.setSession({ access_token, refresh_token });
            } else {
              // Neither PKCE nor implicit tokens found — surface the error
              console.error("[useAuth] OAuth exchange failed:", error.message);
              window.dispatchEvent(new CustomEvent("kuditrack_auth_error", {
                detail: "Google sign-in failed. Please try again.",
              }));
            }
          }
        } else if (
          url.startsWith("com.amayatechnologies.kuditrack://payment-callback") ||
          (url.startsWith("https://kudiai.app") && (url.includes("/app/payment-callback") || url.includes("/payment-return")))
        ) {
          try { await Browser.close(); } catch { /* CCT may already be closed */ }
          window.dispatchEvent(new CustomEvent("paymentCallback", { detail: { url } }));
        }
      }).then((l) => { appUrlListener = l; });
    }

    return () => {
      listener.unsubscribe();
      appUrlListener?.remove();
    };
  }, [resolve]);

  // Called right after a successful subscription save — skips any DB re-query
  // so RLS issues or token-refresh events cannot send the user back to the plan screen.
  const setReady = useCallback((planId, prevPlanId) => {
    const p = normalizeSlug(planId || "starter");
    const prev = normalizeSlug(prevPlanId || "");
    setPlan(p);
    localStorage.setItem(CACHE_KEY, p);
    subVerified.current = true;
    fetchAndCachePlans(supabase).then(() => {
      setUpgradeAvailable(hasHigherPlanAvailable(p));
    }).catch(() => {});
    // Fire plan upgrade email if plan actually changed (and it's not starter for first time)
    if (prev && prev !== p && p !== "starter") {
      supabase.auth.getSession().then(({ data }) => {
        const user = data?.session?.user;
        if (user?.email) {
          fireWelcomeEmail("plan_upgraded", {
            user_email: user.email,
            user_name: user.user_metadata?.business_name || user.user_metadata?.owner_name || user.user_metadata?.full_name || user.email,
            old_plan: prev,
            new_plan: p,
          });
        }
      }).catch(() => {});
    }
    setStatus("ready");
  }, []);

  // Full re-check from DB (used on explicit logout/login cycle)
  const refetch = useCallback(() => {
    subVerified.current = false;
    localStorage.removeItem(CACHE_KEY); // ensure subscription page is never skipped after onboarding
    setStatus("loading");
    supabase.auth.getSession().then(({ data }) => resolve(data.session));
  }, [resolve]);

  // Lightweight retry used by the offline screen — does NOT clear portal caches
  // so that a still-offline retry can still serve from the cached row.
  const retryAuth = useCallback(() => {
    setStatus("loading");
    supabase.auth.getSession().then(({ data }) => resolve(data.session));
  }, [resolve]);

  // Realtime: when admin changes subscription_plans in DB, invalidate the
  // module cache, re-fetch, then bump plansVersion so App.jsx re-renders and
  // every canDo() call runs again against the fresh cache.
  useEffect(() => {
    const channel = supabase
      .channel("plans_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "subscription_plans" }, () => {
        invalidatePlansCache();
        fetchAndCachePlans(supabase)
          .then(() => setPlansVersion(v => v + 1))
          .catch(() => {});
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Also watch the user's own subscription row so that upgrading from another
  // device or session is reflected immediately without requiring a re-login.
  useEffect(() => {
    if (!session?.user?.id) return;
    const channel = supabase
      .channel("user_subscription_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "subscriptions", filter: `user_id=eq.${session.user.id}` },
        (payload) => {
          const newPlan = normalizeSlug(payload.new?.plan || "kobo");
          setPlan(newPlan);
          localStorage.setItem(CACHE_KEY, newPlan);
          fetchAndCachePlans(supabase)
            .then(() => setPlansVersion(v => v + 1))
            .catch(() => {});
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session?.user?.id]);

  return { status, session, plan, setReady, refetch, retryAuth, upgradeAvailable, plansVersion, staff, ajoClient, orgMember, adminUser, marketer, org, ownerId: staff?.owner_id ?? null };
}
