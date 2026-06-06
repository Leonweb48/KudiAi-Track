import { useState, useEffect, useCallback, useRef } from "react";
import { supabase, supabaseConfigured } from "../utils/supabase";

const CACHE_KEY = "kuditrack_plan";

export function useAuth() {
  const [status,  setStatus]  = useState("loading");
  const [session, setSession] = useState(null);
  const [plan,    setPlan]    = useState(() => localStorage.getItem(CACHE_KEY) || "starter");

  // Tracks whether we've already confirmed a subscription this session.
  // A ref (not state) so reads inside async callbacks are always current.
  const subVerified = useRef(false);

  const resolve = useCallback(async (sess) => {
    if (!sess) {
      setSession(null);
      setStatus("unauthenticated");
      subVerified.current = false;
      localStorage.removeItem(CACHE_KEY);
      return;
    }

    setSession(sess);
    const uid = sess.user.id;

    // ── Onboarding check ─────────────────────────────────────────
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", uid)
      .maybeSingle();

    if (!profile) { setStatus("onboarding"); return; }

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
    return () => listener.unsubscribe();
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

  return { status, session, plan, setReady, refetch };
}
