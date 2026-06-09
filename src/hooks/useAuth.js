import { useState, useEffect, useCallback, useRef } from "react";
import { supabase, supabaseConfigured } from "../utils/supabase";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";

const CACHE_KEY = "kuditrack_plan";

export function useAuth() {
  const [status,    setStatus]    = useState("loading");
  const [session,   setSession]   = useState(null);
  const [plan,      setPlan]      = useState(() => localStorage.getItem(CACHE_KEY) || "starter");
  const [staff,     setStaff]     = useState(null);
  const [ajoClient, setAjoClient] = useState(null);

  // Tracks whether we've already confirmed a subscription this session.
  // A ref (not state) so reads inside async callbacks are always current.
  const subVerified = useRef(false);

  const resolve = useCallback(async (sess) => {
    if (!sess) {
      setSession(null);
      setStatus("unauthenticated");
      setStaff(null);
      setAjoClient(null);
      subVerified.current = false;
      localStorage.removeItem(CACHE_KEY);
      return;
    }

    setSession(sess);
    const uid   = sess.user.id;
    const email = sess.user.email;

    // ── Onboarding check ─────────────────────────────────────────
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", uid)
      .maybeSingle();

    if (!profile) {
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
        const mustChange = sess.user?.user_metadata?.must_change_password === true;
        if (mustChange) {
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
        const mustChange = sess.user?.user_metadata?.must_change_password === true;
        setStatus(mustChange ? "ajo_client_setup" : "ajo_client");
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

    const { data: sub } = await supabase
      .from("subscriptions")
      .select("id, plan")
      .eq("user_id", uid)
      .eq("status", "active")
      .maybeSingle();

    if (sub) {
      // DB confirmed — cache it and mark verified
      const resolvedPlan = sub.plan || "starter";
      setPlan(resolvedPlan);
      localStorage.setItem(CACHE_KEY, resolvedPlan);
      subVerified.current = true;
      setStatus("ready");
      return;
    }

    // DB returned nothing — check localStorage cache set by a previous setReady call.
    // Covers the case where RLS SELECT policy is missing but the user did pay.
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      setPlan(cached);
      subVerified.current = true;
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
  const setReady = useCallback((planId) => {
    const p = planId || "starter";
    setPlan(p);
    localStorage.setItem(CACHE_KEY, p);
    subVerified.current = true;
    setStatus("ready");
  }, []);

  // Full re-check from DB (used on explicit logout/login cycle)
  const refetch = useCallback(() => {
    subVerified.current = false;
    setStatus("loading");
    supabase.auth.getSession().then(({ data }) => resolve(data.session));
  }, [resolve]);

  return { status, session, plan, setReady, refetch, staff, ajoClient, ownerId: staff?.owner_id ?? null };
}
