import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { supabase } from "./supabase";

// Admin "access account" sessions (admin portal → Users → Access).
//
// The admin portal hands the admin a link like  https://kudiai.app/?admin_login=<magic-link token>&admin_access=<grant>
// consumeAdminAccessLink() (run before React renders) signs this browser in as the customer with the magic-link
// token and keeps the grant secret for this tab only. useAdminAccess() then asks the server to claim the grant, which
// binds it to this one login session (migration 20270222000000_admin_access_grants). Only while the server says the
// session is an admin session does the app skip the customer's app lock, PIN-setup and consent screens. Nothing here
// is trusted on its own: a copied token, another tab, or the customer's own sessions never pass the server check.
// Moving money still needs the customer's transaction PIN.

const TOKEN_KEY = "kt_admin_access_token";

function readToken() {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function dropToken() {
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
}

export async function consumeAdminAccessLink() {
  if (typeof window === "undefined" || !supabase) return;
  let url;
  try { url = new URL(window.location.href); } catch { return; }
  const grant = url.searchParams.get("admin_access");
  const login = url.searchParams.get("admin_login");
  const rawType = url.searchParams.get("admin_login_type");
  const loginType = ["magiclink", "signup", "email", "invite"].includes(rawType) ? rawType : "magiclink";
  if (!grant && !login) return;

  // Never leave the secrets in the address bar or history.
  url.searchParams.delete("admin_access");
  url.searchParams.delete("admin_login");
  url.searchParams.delete("admin_login_type");
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  if (!grant || !login) return;

  try { sessionStorage.setItem(TOKEN_KEY, grant); } catch { /* storage unavailable: access falls back to the normal gates */ }
  try {
    // Don't carry over whoever was signed in on this browser before.
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    const { error } = await supabase.auth.verifyOtp({ token_hash: login, type: loginType });
    if (error) { dropToken(); console.warn("[adminAccess] sign-in link rejected:", error.message); }
  } catch (e) {
    dropToken();
    console.warn("[adminAccess] sign-in failed:", e?.message || e);
  }
}

// Shared with <AdminAccessBannerHost/>, which renders outside App's many early returns.
let published = { active: false, adminName: null, expiresAt: null, end: null };
const listeners = new Set();
function publish(next) { published = next; listeners.forEach((l) => l()); }

export function useAdminAccess(userId) {
  const [state, setState] = useState(() => ({ loading: !!readToken(), active: false, adminName: null, expiresAt: null }));

  useEffect(() => {
    const token = readToken();
    if (!userId || !token || !supabase) { setState({ loading: false, active: false, adminName: null, expiresAt: null }); return; }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    supabase.rpc("admin_access_claim", { p_token: token })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data?.active) {
          dropToken();
          setState({ loading: false, active: false, adminName: null, expiresAt: null });
          return;
        }
        setState({ loading: false, active: true, adminName: data.admin_username || "Admin", expiresAt: data.expires_at });
      })
      .catch(() => { if (!cancelled) setState({ loading: false, active: false, adminName: null, expiresAt: null }); });
    return () => { cancelled = true; };
  }, [userId]);

  const end = useCallback(async () => {
    try { await supabase?.rpc("admin_access_end"); } catch { /* best effort */ }
    dropToken();
    try { await supabase?.auth.signOut({ scope: "local" }); } catch { /* ignore */ }
    window.location.replace("/");
  }, []);

  // Sign out when the access window closes.
  useEffect(() => {
    if (!state.active || !state.expiresAt) return;
    const ms = new Date(state.expiresAt).getTime() - Date.now();
    const t = setTimeout(end, Math.max(0, Math.min(ms, 2147483000)));
    return () => clearTimeout(t);
  }, [state.active, state.expiresAt, end]);

  useEffect(() => {
    publish(state.active ? { active: true, adminName: state.adminName, expiresAt: state.expiresAt, end } : { active: false, adminName: null, expiresAt: null, end: null });
  }, [state.active, state.adminName, state.expiresAt, end]);

  return { ...state, end };
}

export function AdminAccessBannerHost() {
  const a = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => published);
  return a.active ? <AdminAccessBanner adminName={a.adminName} expiresAt={a.expiresAt} onEnd={a.end} /> : null;
}

export function AdminAccessBanner({ adminName, expiresAt, onEnd }) {
  const until = expiresAt ? new Date(expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  return (
    <div
      role="status"
      style={{
        position: "fixed", top: "calc(env(safe-area-inset-top, 0px) + 6px)", left: "50%", transform: "translateX(-50%)",
        zIndex: 2147483000, display: "flex", alignItems: "center", gap: 10, maxWidth: "calc(100vw - 16px)",
        background: "rgba(185, 28, 28, 0.95)", color: "#fff", borderRadius: 999, padding: "6px 8px 6px 14px",
        fontSize: 12, fontWeight: 600, boxShadow: "0 4px 14px rgba(0,0,0,0.3)",
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        Admin access · {adminName}{until ? ` · ends ${until}` : ""}
      </span>
      <button
        onClick={onEnd}
        style={{ background: "#fff", color: "#b91c1c", border: 0, borderRadius: 999, padding: "4px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}
      >
        End
      </button>
    </div>
  );
}
