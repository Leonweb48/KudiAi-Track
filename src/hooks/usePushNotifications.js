/**
 * usePushNotifications — FCM token registration + tap-to-deep-link.
 * Requires @capacitor/push-notifications.
 *
 * Usage: call once at the top of each portal after login resolves.
 *   usePushNotifications(userId, onDeepLink)
 */

import { useEffect, useRef } from "react";
import { supabase } from "../utils/supabase";

const PROMPTED_KEY = "kt_push_prompted";

// ── Helpers ───────────────────────────────────────────────────────────────────
function isNative() {
  return typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.();
}

function getPushPlugin() {
  if (!isNative()) return null;
  try {
    // eslint-disable-next-line import/no-commonjs
    const mod = require("@capacitor/push-notifications");
    return mod.PushNotifications ?? mod.default?.PushNotifications ?? mod.default ?? null;
  } catch (_e) {
    return null;
  }
}

async function registerToken(userId, token) {
  try {
    const { error } = await supabase.functions.invoke("notify-send", {
      body: { action: "register-token", userId, token, platform: "android" },
    });
    if (error) console.error("[Push] registerToken failed:", error.message);
  } catch (e) {
    console.error("[Push] registerToken threw:", e?.message);
  }
}

async function createAndroidChannels(Push) {
  try {
    await Push.createChannel({
      id:          "money_alerts",
      name:        "Money & Approvals",
      description: "Collections, withdrawals, and payment alerts",
      importance:  5,
      visibility:  1,
      sound:       "default",
      vibration:   true,
    });
  } catch (_e) {}
  try {
    await Push.createChannel({
      id:          "updates",
      name:        "Updates",
      description: "General app updates and information",
      importance:  3,
      visibility:  1,
    });
  } catch (_e) {}
}

// ── Main hook ─────────────────────────────────────────────────────────────────
export function usePushNotifications(userId, onDeepLink) {
  const registered    = useRef(false);
  const onDeepLinkRef = useRef(onDeepLink);
  useEffect(() => { onDeepLinkRef.current = onDeepLink; }, [onDeepLink]);

  useEffect(() => {
    if (!userId || registered.current) return;
    registered.current = true;

    let listeners = [];

    (async () => {
      try {
        const Push = getPushPlugin();
        if (!Push) return;

        await createAndroidChannels(Push);

        // Add all listeners BEFORE calling register()
        const tapListener = await Push.addListener("pushNotificationActionPerformed", (action) => {
          const dl = action.notification?.data?.deepLink;
          if (!dl) return;
          try {
            const parsed = typeof dl === "string" ? JSON.parse(dl) : dl;
            onDeepLinkRef.current?.(parsed);
          } catch { /* malformed deep link */ }
        });
        listeners.push(tapListener);

        const fgListener = await Push.addListener("pushNotificationReceived", () => {});
        listeners.push(fgListener);

        const regListener = await Push.addListener("registration", async (token) => {
          if (token?.value) await registerToken(userId, token.value);
        });
        listeners.push(regListener);

        const errListener = await Push.addListener("registrationError", (err) => {
          console.error("[Push] registrationError:", err);
        });
        listeners.push(errListener);

        const { receive } = await Push.checkPermissions();

        if (receive === "granted") {
          await Push.register();
          return;
        }

        const alreadyPrompted = localStorage.getItem(PROMPTED_KEY);
        if (alreadyPrompted) return;

        // First-time contextual prompt: wait 3 s so the portal is visible
        setTimeout(async () => {
          try {
            localStorage.setItem(PROMPTED_KEY, "1");
            const { receive: result } = await Push.requestPermissions();
            if (result === "granted") await Push.register();
          } catch (_e) {}
        }, 3000);

      } catch (err) {
        console.error("[Push] registration lifecycle error:", err?.message);
      }
    })();

    return () => {
      listeners.forEach(l => l.remove?.());
      registered.current = false;
    };
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps
}
