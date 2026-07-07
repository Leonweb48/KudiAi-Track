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
    fetch("https://kudiai.app/api/email-trigger", {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ event, data }),
    }).catch(e => console.warn("[Email] trigger failed:", e));
  } catch (e) {
    console.warn("[Email] trigger failed:", e);
  }
}
