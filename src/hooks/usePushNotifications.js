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
  } catch { return null; }
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

    let Push = null;
    let listeners = [];

    (async () => {
      Push = await getPushPlugin();
      if (!Push) return;

      await createAndroidChannels(Push);

      // Handle push notification tap (warm start + cold start)
      const tapListener = await Push.addListener("pushNotificationActionPerformed", (action) => {
        const dl = action.notification?.data?.deepLink;
        if (!dl) return;
        try {
          const parsed = typeof dl === "string" ? JSON.parse(dl) : dl;
          onDeepLinkRef.current?.(parsed);
        } catch { /* malformed deep link — ignore */ }
      });
      listeners.push(tapListener);

      // Handle foreground notifications (show in-app toast via realtime, not FCM UI)
      const fgListener = await Push.addListener("pushNotificationReceived", () => {
        // Realtime subscription already delivers the UI update; suppress native banner
      });
      listeners.push(fgListener);

      // Registration result
      const regListener = await Push.addListener("registration", async (token) => {
        if (token?.value) await registerToken(userId, token.value);
      });
      listeners.push(regListener);

      // Permission check — request contextually after first login
      const { receive } = await Push.checkPermissions();
      if (receive === "granted") {
        await Push.register();
        return;
      }

      // Only prompt once per device, after a brief delay (contextual, never cold)
      const alreadyPrompted = localStorage.getItem(PROMPTED_KEY);
      if (alreadyPrompted) return;

      // Small delay so the portal loads before the explainer shows
      setTimeout(async () => {
        localStorage.setItem(PROMPTED_KEY, "1");
        const { receive: result } = await Push.requestPermissions();
        if (result === "granted") await Push.register();
      }, 3000);
    })();

    return () => {
      listeners.forEach(l => l.remove?.());
    };
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps
}
