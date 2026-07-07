import { supabase } from "./supabase";

// Module-level token cache updated by useAuth.js on every session change.
// Avoids getSession() calls that can silently return null during token refresh
// cycles in the Capacitor WebView, which would prevent emails from being sent.
let _cachedToken = null;
export function setEmailToken(token) { _cachedToken = token || null; }

export async function sendEmailTrigger(event, data) {
  try {
    let token = _cachedToken;
    if (!token) {
      const { data: { session } } = await supabase.auth.getSession();
      token = session?.access_token || null;
    }
    if (!token) return;

    // Absolute URL so this works inside Capacitor webview (which loads from https://localhost)
    const res = await fetch("https://kudiai.app/api/email-trigger", {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ event, data }),
    });

    if (!res.ok) {
      // Log the failure directly to Supabase so it's visible in the delivery log
      // even when the email pipeline itself is broken.
      const detail = await res.text().catch(() => `HTTP ${res.status}`);
      supabase.from("email_delivery_log").insert({
        to_email:  String(data?.user_email || data?.owner_email || data?.email || "unknown"),
        subject:   `[FAILED] ${event}`,
        status:    "failed",
        error_msg: `HTTP ${res.status}: ${detail.slice(0, 200)}`,
        smtp_host: "kudiai-app-client",
      }).catch(() => {});
    }
  } catch (e) {
    // Network-level failure (CORS, offline, DNS) — log to Supabase so it's visible
    supabase?.from("email_delivery_log").insert({
      to_email:  String(data?.user_email || data?.owner_email || data?.email || "unknown"),
      subject:   `[FAILED] ${event}`,
      status:    "failed",
      error_msg: String(e?.message || e).slice(0, 200),
      smtp_host: "kudiai-app-client",
    }).catch(() => {});
  }
}
