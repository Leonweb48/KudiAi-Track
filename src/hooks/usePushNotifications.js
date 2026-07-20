/**
 * usePushNotifications — FCM token registration + tap-to-deep-link.
 * Requires @capacitor/push-notifications.
 * Runs only on Android (Capacitor native context); gracefully degrades on web.
 *
 * Usage: call once at the top of each portal after login resolves.
 *   usePushNotifications(userId, onDeepLink)
 *
 * Permission prompt is contextual: shown once after first login (tracked in
 * localStorage "kt_push_prompted"). Never a cold-start system prompt.
 *
 * Diagnostic: filter adb logcat by tag "[Push]" or "Capacitor/Console".
 */

import { useEffect, useRef } from "react";
import { supabase } from "../utils/supabase";

const PROMPTED_KEY = "kt_push_prompted";

function isNative() {
  return typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.();
}

async function getPushPlugin() {
  if (!isNative()) return null;
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    return PushNotifications;
  } catch (e) {
    console.error("[Push] Failed to import PushNotifications plugin:", e);
    return null;
  }
}

async function registerToken(userId, token) {
  await supabase.functions.invoke("notify-send", {
    body: { action: "register-token", userId, token, platform: "android" },
  });
}

async function createAndroidChannels(Push) {
  try {
    await Push.createChannel({
      id: "money_alerts",
      name: "Money & Approvals",
      description: "Collections, withdrawals, and payment alerts",
      importance: 5, // IMPORTANCE_HIGH
      visibility: 1,
      sound: "default",
      vibration: true,
    });
    await Push.createChannel({
      id: "updates",
      name: "Updates",
      description: "General app updates and information",
      importance: 3, // IMPORTANCE_DEFAULT
      visibility: 1,
    });
  } catch { /* channels already exist — safe to swallow */ }
}

export function usePushNotifications(userId, onDeepLink) {
  const registered = useRef(false);
  const onDeepLinkRef = useRef(onDeepLink);
  useEffect(() => { onDeepLinkRef.current = onDeepLink; }, [onDeepLink]);

  useEffect(() => {
    if (!userId || registered.current) return;
    registered.current = true;

    let listeners = [];

    (async () => {
      try {
        const Push = await getPushPlugin();
        if (!Push) {
          console.log("[Push] isNativePlatform()=false — skipping on web");
          return;
        }

        console.log("[Push] Plugin loaded, creating channels…");
        await createAndroidChannels(Push);

        // ── Listeners (must be added before calling register()) ──────────────

        const tapListener = await Push.addListener("pushNotificationActionPerformed", (action) => {
          const dl = action.notification?.data?.deepLink;
          if (!dl) return;
          try {
            const parsed = typeof dl === "string" ? JSON.parse(dl) : dl;
            onDeepLinkRef.current?.(parsed);
          } catch { /* malformed deep link — ignore */ }
        });
        listeners.push(tapListener);

        // Foreground notifications: realtime already delivers the UI update
        const fgListener = await Push.addListener("pushNotificationReceived", () => {});
        listeners.push(fgListener);

        const regListener = await Push.addListener("registration", async (token) => {
          console.log("[Push] registration event — token received, storing…");
          if (token?.value) {
            try {
              await registerToken(userId, token.value);
              console.log("[Push] Token stored in push_tokens for userId:", userId);
            } catch (e) {
              console.error("[Push] registerToken() failed:", e);
            }
          }
        });
        listeners.push(regListener);

        // Missing in original — FCM registration failures are now surfaced
        const errListener = await Push.addListener("registrationError", (err) => {
          console.error("[Push] registrationError event:", JSON.stringify(err));
        });
        listeners.push(errListener);

        // ── Permission check ─────────────────────────────────────────────────

        const { receive } = await Push.checkPermissions();
        console.log("[Push] checkPermissions() →", receive);

        if (receive === "granted") {
          console.log("[Push] Permission already granted — calling register()");
          await Push.register();
          return;
        }

        // Only prompt once per device lifetime; "denied" = can't re-request
        const alreadyPrompted = localStorage.getItem(PROMPTED_KEY);
        if (alreadyPrompted) {
          console.log("[Push] Already prompted (status:", receive, ") — skipping re-request. User must enable in Settings.");
          return;
        }

        // Contextual prompt: small delay so the portal is visible first
        setTimeout(async () => {
          try {
            localStorage.setItem(PROMPTED_KEY, "1");
            const { receive: result } = await Push.requestPermissions();
            console.log("[Push] requestPermissions() →", result);
            if (result === "granted") {
              console.log("[Push] Permission granted — calling register()");
              await Push.register();
            } else {
              console.log("[Push] Permission not granted (", result, ") — push disabled");
            }
          } catch (e) {
            console.error("[Push] requestPermissions() threw:", e);
          }
        }, 3000);

      } catch (err) {
        console.error("[Push] Registration lifecycle error:", err);
      }
    })();

    return () => {
      listeners.forEach(l => l.remove?.());
      // Reset so re-login (userId change) triggers a fresh registration attempt
      registered.current = false;
    };
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps
}
