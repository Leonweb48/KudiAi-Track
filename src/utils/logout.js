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
      try {
        await supabase.functions.invoke("notify-send", {
          body: { action: "deregister-token", token },
        });
      } catch { /* best-effort — don't block logout if network is down */ }
      localStorage.removeItem(PUSH_TOKEN_KEY);
    }
    try {
      const Push = await getPushPlugin();
      await Push?.removeAllDeliveredNotifications?.();
    } catch { /* best-effort */ }
  }
  // Clear per-user caches before signing out. Race against a 300 ms timeout so we
  // never hang here if the Supabase client tries to refresh an expired token over a
  // slow network — that refresh can block for 30+ seconds on APK.
  try {
    const result = await Promise.race([
      supabase.auth.getSession(),
      new Promise(resolve => setTimeout(() => resolve({ data: {} }), 300)),
    ]);
    const uid = result?.data?.session?.user?.id;
    if (uid) { clearUserCache(uid); clearLocalPinState(uid); }
  } catch { /* best-effort */ }
  await supabase.auth.signOut();
}
