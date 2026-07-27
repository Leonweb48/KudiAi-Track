import { supabase } from "./supabase";
import { clearUserCache } from "./offlineCache";
import { clearLocalPinState } from "./pinHash";

const PUSH_TOKEN_KEY = "kt_push_token";

function isNative() {
  return typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.();
}

async function getPushPlugin() {
  if (!isNative()) return null;
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    return PushNotifications;
  } catch { return null; }
}

/**
 * Performs a clean logout:
 *  1. Deregisters the FCM push token from the server (stops pushes for this user/device)
 *  2. Clears delivered notifications from the Android drawer
 *  3. Calls supabase.auth.signOut()
 *
 * Must be called BEFORE signOut so the user JWT is still valid for the server call.
 */
export async function performLogout() {
  if (isNative()) {
    const token = localStorage.getItem(PUSH_TOKEN_KEY);
    if (token) {
      // Fire-and-forget — edge-function cold start can be 3–10 s on mobile.
      // Removing the token key immediately means no retry on next launch.
      localStorage.removeItem(PUSH_TOKEN_KEY);
      supabase.functions.invoke("notify-send", {
        body: { action: "deregister-token", token },
      }).catch(() => {});
    }
    // Also fire-and-forget — drawer clear is cosmetic, never blocks logout.
    getPushPlugin()
      .then(Push => Push?.removeAllDeliveredNotifications?.())
      .catch(() => {});
  }

  // Get userId from in-memory session (300 ms cap prevents expired-token refresh
  // from making a network call and hanging for 30+ s on APK).
  try {
    const result = await Promise.race([
      supabase.auth.getSession(),
      new Promise(resolve => setTimeout(() => resolve({ data: {} }), 300)),
    ]);
    const uid = result?.data?.session?.user?.id;
    if (uid) { clearUserCache(uid); clearLocalPinState(uid); }
  } catch { /* best-effort */ }

  // signOut makes a server round-trip to revoke the token. Cap at 1.5 s —
  // Supabase clears localStorage before the network call so local state is
  // gone either way; the server revocation completes in the background.
  await Promise.race([
    supabase.auth.signOut(),
    new Promise(resolve => setTimeout(resolve, 1500)),
  ]);
}
