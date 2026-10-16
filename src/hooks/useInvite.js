import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../utils/supabase";
import { getPendingInvite, clearPendingInvite, normalizeInviteCode } from "../utils/invite";

/** Everything the Invite & Earn screen shows — one RPC (it also advances/pays this user's invites server-side). */
export function useInviteDashboard(active) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    const { data: d, error: e } = await supabase.rpc("invite_dashboard");
    if (e) setError(e.message || "Could not load");
    else setData(d || null);
    setLoading(false);
  }, []);

  useEffect(() => { if (active) refresh(); }, [active, refresh]);
  return { data, loading, error, refresh };
}

// Results that will never change on a retry — forget the stored code after these.
const FINAL = new Set(["invalid_code", "own_code", "already_invited", "not_new", "mutual", "disabled"]);

/**
 * After sign-in, link a new account to the friend who invited it (code from the invite link, the sign-up form,
 * or the sign-up metadata). Runs once per user per device; a network failure leaves the code for the next start.
 * @param portal "owner" | "client"
 * @param onClaimed ({ inviterName }) => void
 */
export function useInviteClaim(userId, portal, onClaimed) {
  const cb = useRef(onClaimed);
  cb.current = onClaimed;
  useEffect(() => {
    if (!userId) return;
    const doneKey = `kuditrack_invite_claimed_${userId}`;
    try { if (localStorage.getItem(doneKey)) return; } catch { /* ignore */ }
    let cancelled = false;
    (async () => {
      let code = getPendingInvite();
      if (!code) {
        const { data } = await supabase.auth.getUser();
        code = normalizeInviteCode(data?.user?.user_metadata?.invite_code);
      }
      if (!code || cancelled) return;
      const { data, error } = await supabase.rpc("invite_claim", { p_code: code, p_portal: portal });
      if (error || cancelled) return;                       // offline / server hiccup → try again next start
      if (data?.ok || FINAL.has(data?.reason)) {
        clearPendingInvite();
        try { localStorage.setItem(doneKey, "1"); } catch { /* ignore */ }
      }
      if (data?.ok) cb.current?.({ inviterName: data.inviter_name || "" });
    })();
    return () => { cancelled = true; };
  }, [userId, portal]);
}
