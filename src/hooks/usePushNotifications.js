/**
 * usePushNotifications — FCM token registration + tap-to-deep-link.
 * Requires @capacitor/push-notifications.
 *
 * Usage: call once at the top of each portal after login resolves.
 *   usePushNotifications(userId, onDeepLink)
 */

import { useEffect, useRef } from "react";
import { supabase } from "../utils/supabase";
import { syncWebPushToken } from "../utils/webPush";

const PROMPTED_KEY  = "kt_push_prompted";
const PUSH_TOKEN_KEY = "kt_push_token";

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

// One channel per notification category (src/lib/notificationCategories.js /
// notify-send's CATEGORY_META) so Android lets a user silence one category
// (e.g. Stock) without silencing another (e.g. Money) — each is a distinct
// channel id, never reusing "money_alerts" or "wallet_credit"'s ids, since a
// channel's sound/importance is fixed at creation and silently won't update
// for anyone who already has the app installed (documented below, was
// already true before this changed — see the wallet_credit split).
// Reuses the existing "kudiai" custom sound asset for every new channel
// (a real, already-shipped audio file) rather than the harsh Android
// default beep — there's no second bespoke chime per category, just this
// one branded sound applied consistently.
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
  // Wallet credit alerts — distinct branded sound, separate channel because a
  // channel's sound is fixed at creation and can't be changed on an existing
  // one ("money_alerts" already shipped with "default").
  try {
    await Push.createChannel({
      id:          "wallet_credit",
      name:        "Wallet Credit Alerts",
      description: "Money landing in your KudiAI wallet",
      importance:  5,
      visibility:  1,
      sound:       "kudiai",
      vibration:   true,
    });
  } catch (_e) {}
  try {
    await Push.createChannel({
      id:          "savings_alerts",
      name:        "Ajo & Savings",
      description: "Contributions, withdrawals, and savings activity",
      importance:  4,
      visibility:  1,
      sound:       "kudiai",
      vibration:   true,
    });
  } catch (_e) {}
  try {
    await Push.createChannel({
      id:          "credit_alerts",
      name:        "Credit & Invoice",
      description: "Credit sales, repayments, and invoices",
      importance:  4,
      visibility:  1,
      sound:       "kudiai",
      vibration:   true,
    });
  } catch (_e) {}
  try {
    await Push.createChannel({
      id:          "alert_notifications",
      name:        "Alerts & Warnings",
      description: "Unusual transactions and account warnings",
      importance:  5,
      visibility:  1,
      sound:       "kudiai",
      vibration:   true,
    });
  } catch (_e) {}
  try {
    await Push.createChannel({
      id:          "stock_alerts",
      name:        "Stock",
      description: "Low stock and restock alerts",
      importance:  4,
      visibility:  1,
      sound:       "kudiai",
      vibration:   true,
    });
  } catch (_e) {}
  try {
    await Push.createChannel({
      id:          "bills_alerts",
      name:        "Bills & Payments",
      description: "Airtime, data, and bill payment confirmations",
      importance:  4,
      visibility:  1,
      sound:       "kudiai",
      vibration:   true,
    });
  } catch (_e) {}
  try {
    await Push.createChannel({
      id:          "account_updates",
      name:        "Account & System",
      description: "Permission changes and account activity",
      importance:  3,
      visibility:  1,
      sound:       "kudiai",
    });
  } catch (_e) {}
  try {
    await Push.createChannel({
      id:          "milestones",
      name:        "Milestones",
      description: "Sales and savings milestones you've reached",
      importance:  4,
      visibility:  1,
      sound:       "kudiai",
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

  // Browser sessions: a click on a web push notification either messages an
  // already-open tab (kt-push-click) or cold-opens the site with ?kt_dl=…
  // (see public/push-sw.js). Native sessions never hit either path.
  useEffect(() => {
    if (isNative() || typeof window === "undefined") return;

    try {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get("kt_dl");
      if (raw) {
        params.delete("kt_dl");
        const qs = params.toString();
        window.history.replaceState({}, "", window.location.pathname + (qs ? "?" + qs : "") + window.location.hash);
        const parsed = JSON.parse(raw);
        setTimeout(() => onDeepLinkRef.current?.(parsed), 800); // let the portal mount first
      }
    } catch { /* malformed link — ignore */ }

    if (!("serviceWorker" in navigator)) return;
    const onMessage = (e) => {
      if (e.data?.type !== "kt-push-click") return;
      try {
        const dl = typeof e.data.deepLink === "string" ? JSON.parse(e.data.deepLink) : e.data.deepLink;
        onDeepLinkRef.current?.(dl);
      } catch { /* malformed link — ignore */ }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!userId || registered.current) return;
    registered.current = true;

    let listeners = [];

    (async () => {
      try {
        const Push = getPushPlugin();
        if (!Push) {
          // Browser session: re-register the web push token if the user already
          // allowed notifications (tokens rotate). Never prompts.
          syncWebPushToken(userId);
          return;
        }

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
          if (token?.value) {
            localStorage.setItem(PUSH_TOKEN_KEY, token.value);
            await registerToken(userId, token.value);
          }
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
