import { useState, useEffect, useCallback, useRef } from "react";
import { supabase, supabaseConfigured } from "../utils/supabase";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { fetchAndCachePlans, normalizeSlug, hasHigherPlanAvailable } from "../utils/plans";

const CACHE_KEY = "kuditrack_plan";
const SESSION_LOGGED_KEY = "kuditrack_sess_logged";
const WELCOME_EMAIL_KEY = "kuditrack_welcome_sent";

async function fireWelcomeEmail(event, data) {
  try {
    const sentKey = `${WELCOME_EMAIL_KEY}_${data.email || data.name}`;
    if (sessionStorage.getItem(sentKey)) return;
    sessionStorage.setItem(sentKey, "1");
    await fetch("https://kuditrack-admin.vercel.app/api/public/email-trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-trigger-secret": "kuditrack-email-trigger-2026-amaya" },
      body: JSON.stringify({ event, data }),
    });
  } catch { /* non-critical */ }
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

  const resolve = useCallback(async (sess) => {
    if (!sess) {
      setSession(null);
      setStatus("unauthenticated");
      setStaff(null);
      setAjoClient(null);
      setOrgMember(null);
      setAdminUser(null);
      setMarketer(null);
      setOrg(null);
      subVerified.current = false;
      localStorage.removeItem(CACHE_KEY);
      return;
    }

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
      // email_verified: false means new member who hasn't verified their OTP yet.
      // undefined (old members) is treated as verified for backward compatibility.
      const emailVerified = sess.user.user_metadata?.email_verified !== false;

      const { data: orgMemberRow } = await supabase
        .from("org_members")
        .select("id, org_id, membership_id, full_name, email, phone, role, status, profile_image_url, savings_balance, joined_date, privacy_balance, privacy_contributions, privacy_activities, organizations(id, name, type, reg_number, wallet_balance, total_savings, total_loans_out, member_count, logo_url, address, phone, email)")
        .eq("user_id", uid)
        .eq("status", "active")
        .maybeSingle();
      if (orgMemberRow) {
        setOrgMember({ ...orgMemberRow, org: orgMemberRow.organizations });
        subVerified.current = true;
        logPlatformSession(supabase, uid, "org_member", orgMemberRow.full_name, email);
        if (!emailVerified) {
          // New member — must verify email OTP before changing password
          setStatus("org_member_otp");
        } else if (mustChange) {
          fireWelcomeEmail("org_member_first_login", {
            name: orgMemberRow.full_name || "",
            email: email || "",
            org_name: orgMemberRow.organizations?.name || "",
          });
          setStatus("org_member_setup");
        } else {
          setStatus("org_member");
        }
        return;
      }
      // No active membership found — sign out rather than drop into business onboarding
      await supabase.auth.signOut();
      setStatus("unauthenticated");
      return;
    }

    // ── Ajo Client early routing ──────────────────────────────────────
    if (accountType === "ajo_client") {
      const { data: ajoClientRow } = await supabase
        .from("aso_clients")
        .select("id, full_name, user_id, client_user_id, profile_image_url, membership_number, email, current_balance, total_saved, next_contribution_date, contribution_amount, contribution_frequency, status")
        .eq("client_user_id", uid)
        .maybeSingle();
      if (ajoClientRow) {
        setAjoClient({ ...ajoClientRow, owner_id: ajoClientRow.user_id });
        subVerified.current = true;
        logPlatformSession(supabase, uid, "ajo_client", ajoClientRow.full_name, email);
        if (mustChange) {
          fireWelcomeEmail("ajo_client_first_login", { name: ajoClientRow.full_name || "", email: email || "" });
          setStatus("ajo_client_setup");
        } else {
          setStatus("ajo_client");
        }
        return;
      }
      await supabase.auth.signOut();
      setStatus("unauthenticated");
      return;
    }

    // ── Marketer early routing ────────────────────────────────────────
    if (accountType === "marketer") {
      const { data: marketerRow } = await supabase
        .from("brm_marketers")
        .select("id, owner_id, username, full_name, email, phone, territory, commission_rate, status, profile_image_url, total_clients, total_commission_earned")
        .eq("owner_id", uid)
        .eq("status", "active")
        .maybeSingle();
      if (marketerRow) {
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
      await supabase.auth.signOut();
      setStatus("unauthenticated");
      return;
    }

    // ── Organisation portal routing ───────────────────────────────────
    if (accountType === "organisation") {
      const { data: orgRow, error: orgErr } = await supabase.rpc("get_my_org");
      if (orgRow) {
        if (orgRow.status !== "active") {
          window.dispatchEvent(new CustomEvent("kuditrack_auth_error", {
            detail: "Your organisation account is not active. Please contact the business that set up your portal.",
          }));
          await supabase.auth.signOut();
          setStatus("unauthenticated");
          return;
        }
        setOrg(orgRow);
        subVerified.current = true;
        logPlatformSession(supabase, uid, "organisation", orgRow.name, email);
        if (mustChange) {
          setStatus("org_setup");
        } else {
          setStatus("organisation");
        }
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
        if (mustChange) { setStatus("org_setup"); } else { setStatus("organisation"); }
        return;
      }
    }

    // ── Onboarding check (business owners) ───────────────────────────
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", uid)
      .maybeSingle();

    if (!profile) {
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
        if (mustChange) {
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
        .select("id, full_name, user_id, client_user_id, profile_image_url, membership_number, email, current_balance, total_saved, next_contribution_date, contribution_amount, contribution_frequency, status")
        .eq("client_user_id", uid)
        .maybeSingle();

      if (ajoClientRow) {
        setAjoClient({ ...ajoClientRow, owner_id: ajoClientRow.user_id });
        subVerified.current = true;
        if (mustChange) {
          fireWelcomeEmail("ajo_client_first_login", { name: ajoClientRow.full_name || "", email: email || "" });
          setStatus("ajo_client_setup");
        } else {
          setStatus("ajo_client");
        }
        return;
      }

      // ── Org Member check ──────────────────────────────────────────
      const { data: orgMemberRow } = await supabase
        .from("org_members")
        .select("id, org_id, membership_id, full_name, email, phone, role, status, profile_image_url, savings_balance, joined_date, privacy_balance, privacy_contributions, privacy_activities, organizations(id, name, type, reg_number, wallet_balance, total_savings, total_loans_out, member_count, logo_url, address, phone, email)")
        .eq("user_id", uid)
        .eq("status", "active")
        .maybeSingle();

      if (orgMemberRow) {
        setOrgMember({ ...orgMemberRow, org: orgMemberRow.organizations });
        subVerified.current = true;
        const emailVerified = sess.user.user_metadata?.email_verified !== false;
        if (!emailVerified) {
          setStatus("org_member_otp");
        } else if (mustChange) {
          fireWelcomeEmail("org_member_first_login", {
            name: orgMemberRow.full_name || "",
            email: email || "",
            org_name: orgMemberRow.organizations?.name || "",
          });
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

    const { data: sub } = await supabase
      .from("subscriptions")
      .select("id, plan")
      .eq("user_id", uid)
      .eq("status", "active")
      .maybeSingle();

    if (sub) {
      // DB confirmed — normalize slug (business→basic, premium→professional) and cache
      const resolvedPlan = normalizeSlug(sub.plan) || "starter";
      setPlan(resolvedPlan);
      localStorage.setItem(CACHE_KEY, resolvedPlan);
      subVerified.current = true;
      logPlatformSession(supabase, uid, "business", sess.user.user_metadata?.full_name || sess.user.user_metadata?.owner_name, email);
      // Warm the plans cache and check for upgrade availability
      fetchAndCachePlans(supabase).then(() => {
        setUpgradeAvailable(hasHigherPlanAvailable(resolvedPlan));
      }).catch(() => {});
      setStatus("ready");
      return;
    }

    // DB returned nothing — check localStorage cache set by a previous setReady call.
    // Covers the case where RLS SELECT policy is missing but the user did pay.
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const cachedPlan = normalizeSlug(cached);
      setPlan(cachedPlan);
      subVerified.current = true;
      fetchAndCachePlans(supabase).then(() => {
        setUpgradeAvailable(hasHigherPlanAvailable(cachedPlan));
      }).catch(() => {});
      setStatus("ready");
      return;
    }

    // Genuinely no subscription found
    setStatus("subscribing");
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
          await Browser.close();
          const hashStr = url.split("#")[1] || url.split("?")[1] || "";
          const params = new URLSearchParams(hashStr);
          const access_token = params.get("access_token");
          const refresh_token = params.get("refresh_token");
          if (access_token && refresh_token) {
            await supabase.auth.setSession({ access_token, refresh_token });
          }
        } else if (url.startsWith("com.amayatechnologies.kuditrack://payment-callback")) {
          await Browser.close();
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
    setStatus("loading");
    supabase.auth.getSession().then(({ data }) => resolve(data.session));
  }, [resolve]);

  return { status, session, plan, setReady, refetch, upgradeAvailable, staff, ajoClient, orgMember, adminUser, marketer, org, ownerId: staff?.owner_id ?? null };
}
