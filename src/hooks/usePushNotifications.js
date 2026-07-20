/**
 * usePushNotifications — FCM token registration + tap-to-deep-link.
 * Requires @capacitor/push-notifications.
 *
 * Usage: call once at the top of each portal after login resolves.
 *   usePushNotifications(userId, onDeepLink)
 *
 * Diagnostic: open Settings → Notifications → Push Diagnostics panel (native only).
 * Or filter adb logcat by "[Push]".
 */

import { useEffect, useRef } from "react";
import { supabase } from "../utils/supabase";

const PROMPTED_KEY = "kt_push_prompted";

// ── Module-level diagnostic log (survives component re-renders) ───────────────
const _log = [];
const _t0  = Date.now();

function pushDbg(msg, data) {
  const entry = { t: Date.now() - _t0, msg, data: data !== undefined ? data : null };
  _log.push(entry);
  const line = data != null
    ? `[Push/${entry.t}ms] ${msg} ${typeof data === "object" ? JSON.stringify(data) : data}`
    : `[Push/${entry.t}ms] ${msg}`;
  console.log(line);
}

/** Returns a snapshot of all push lifecycle log entries. */
export function getPushDebugLog() {
  return [..._log];
}

/** Clears the log (call from the diagnostics panel Reset button). */
export function clearPushDebugLog() {
  _log.length = 0;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function isNative() {
  return typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.();
}

function getPushPlugin() {
  if (!isNative()) {
    pushDbg("getPushPlugin() — not native → push skipped");
    return null;
  }
  try {
    // eslint-disable-next-line import/no-commonjs
    const mod = require("@capacitor/push-notifications");
    const Push = mod.PushNotifications ?? mod.default?.PushNotifications ?? mod.default ?? null;
    pushDbg("getPushPlugin() → require OK", { resolved: Push ? "OK" : "NULL" });
    return Push;
  } catch (e) {
    pushDbg("getPushPlugin() → require failed", String(e));
    return null;
  }
}

async function registerToken(userId, token) {
  pushDbg("registerToken() calling notify-send…", { userId: userId?.slice(0, 8), tokenPrefix: token?.slice(0, 20) });
  try {
    const { data, error } = await supabase.functions.invoke("notify-send", {
      body: { action: "register-token", userId, token, platform: "android" },
    });
    if (error) {
      pushDbg("registerToken() notify-send returned error", { message: error.message, status: error.status });
    } else {
      pushDbg("registerToken() notify-send OK", data);
    }
  } catch (e) {
    pushDbg("registerToken() threw exception", String(e));
  }
}

async function createAndroidChannels(Push) {
  try {
    await Push.createChannel({
      id:          "money_alerts",
      name:        "Money & Approvals",
      description: "Collections, withdrawals, and payment alerts",
      importance:  5,  // IMPORTANCE_HIGH (heads-up, sound, vibration)
      visibility:  1,
      sound:       "default",
      vibration:   true,
    });
    pushDbg("createChannel 'money_alerts' OK");
  } catch (e) {
    pushDbg("createChannel 'money_alerts' failed (may already exist)", String(e));
  }
  try {
    await Push.createChannel({
      id:          "updates",
      name:        "Updates",
      description: "General app updates and information",
      importance:  3,  // IMPORTANCE_DEFAULT
      visibility:  1,
    });
    pushDbg("createChannel 'updates' OK");
  } catch (e) {
    pushDbg("createChannel 'updates' failed (may already exist)", String(e));
  }
}

// ── Main hook ─────────────────────────────────────────────────────────────────
export function usePushNotifications(userId, onDeepLink) {
  const registered    = useRef(false);
  const onDeepLinkRef = useRef(onDeepLink);
  useEffect(() => { onDeepLinkRef.current = onDeepLink; }, [onDeepLink]);

  useEffect(() => {
    pushDbg("useEffect fired", { userId: userId?.slice(0, 8) ?? "null", alreadyRegistered: registered.current });

    if (!userId) {
      pushDbg("userId is null/undefined — effect exits early");
      return;
    }
    if (registered.current) {
      pushDbg("already registered in this session — effect exits early");
      return;
    }
    registered.current = true;

    let listeners = [];

    (async () => {
      try {
        // Platform check
        const platform = window.Capacitor?.getPlatform?.() ?? "unknown";
        pushDbg("Capacitor.getPlatform()", platform);

        const Push = getPushPlugin();
        if (!Push) {
          pushDbg("getPushPlugin() returned null — registration aborted");
          return;
        }

        // Channels must exist before any message referencing them arrives
        pushDbg("createAndroidChannels() start");
        await createAndroidChannels(Push);

        // ── Add all listeners BEFORE calling register() ──────────────────────
        const tapListener = await Push.addListener("pushNotificationActionPerformed", (action) => {
          pushDbg("pushNotificationActionPerformed fired", action.notification?.data);
          const dl = action.notification?.data?.deepLink;
          if (!dl) return;
          try {
            const parsed = typeof dl === "string" ? JSON.parse(dl) : dl;
            onDeepLinkRef.current?.(parsed);
          } catch { /* malformed deep link */ }
        });
        listeners.push(tapListener);

        const fgListener = await Push.addListener("pushNotificationReceived", (notif) => {
          pushDbg("pushNotificationReceived (foreground)", { title: notif?.title });
        });
        listeners.push(fgListener);

        const regListener = await Push.addListener("registration", async (token) => {
          pushDbg("registration event fired", { tokenPrefix: token?.value?.slice(0, 20) });
          if (token?.value) {
            await registerToken(userId, token.value);
          } else {
            pushDbg("registration event had no token value — ignoring");
          }
        });
        listeners.push(regListener);

        const errListener = await Push.addListener("registrationError", (err) => {
          pushDbg("registrationError event fired", err);
        });
        listeners.push(errListener);

        pushDbg("all listeners added");

        // ── Check current permission ─────────────────────────────────────────
        const { receive } = await Push.checkPermissions();
        pushDbg("checkPermissions()", receive);

        if (receive === "granted") {
          pushDbg("permission=granted → calling Push.register()");
          await Push.register();
          pushDbg("Push.register() returned (registration event will fire async)");
          return;
        }

        const alreadyPrompted = localStorage.getItem(PROMPTED_KEY);
        pushDbg("kt_push_prompted in localStorage", alreadyPrompted ?? "null (not set)");

        if (alreadyPrompted) {
          pushDbg(`permission=${receive} + already prompted → user must enable in Settings`);
          return;
        }

        // First-time contextual prompt: wait 3 s so the portal is visible
        pushDbg("scheduling requestPermissions() in 3000ms…");
        setTimeout(async () => {
          try {
            localStorage.setItem(PROMPTED_KEY, "1");
            pushDbg("requestPermissions() called");
            const { receive: result } = await Push.requestPermissions();
            pushDbg("requestPermissions() result", result);
            if (result === "granted") {
              pushDbg("permission granted → calling Push.register()");
              await Push.register();
              pushDbg("Push.register() returned (registration event will fire async)");
            } else {
              pushDbg("permission NOT granted — push disabled on this device");
            }
          } catch (e) {
            pushDbg("requestPermissions() threw", String(e));
          }
        }, 3000);

      } catch (err) {
        pushDbg("registration lifecycle threw an unexpected error", String(err));
      }
    })();

    return () => {
      pushDbg("cleanup — removing listeners, resetting registered ref");
      listeners.forEach(l => l.remove?.());
      registered.current = false;
    };
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Force a fresh registration attempt regardless of previous state.
 * Call from the NotificationPreferences diagnostics panel.
 * Returns a promise that resolves with the final permission status.
 */
export async function forceRegisterPush(userId) {
  pushDbg("forceRegisterPush() called", { userId: userId?.slice(0, 8) });
  localStorage.removeItem(PROMPTED_KEY);
  pushDbg("cleared kt_push_prompted");

  const Push = getPushPlugin();
  if (!Push) return "not-native";

  let resolve;
  const result = new Promise(r => { resolve = r; });

  const regH = await Push.addListener("registration", async (token) => {
    pushDbg("forceRegister — registration event", { tokenPrefix: token?.value?.slice(0, 20) });
    if (token?.value) await registerToken(userId, token.value);
    await regH.remove();
    await errH.remove();
    resolve("registered");
  });
  const errH = await Push.addListener("registrationError", async (err) => {
    pushDbg("forceRegister — registrationError", err);
    await regH.remove();
    await errH.remove();
    resolve("error");
  });

  const { receive } = await Push.checkPermissions();
  pushDbg("forceRegister — checkPermissions()", receive);

  if (receive === "denied") {
    await regH.remove();
    await errH.remove();
    pushDbg("forceRegister — permission denied, cannot register");
    return "denied";
  }

  if (receive !== "granted") {
    pushDbg("forceRegister — requesting permissions");
    const { receive: r } = await Push.requestPermissions();
    pushDbg("forceRegister — requestPermissions result", r);
    if (r !== "granted") {
      await regH.remove();
      await errH.remove();
      return r;
    }
  }

  pushDbg("forceRegister — calling Push.register()");
  await Push.register();

  // Wait up to 15 s for the registration/error event
  const timeout = new Promise(r => setTimeout(() => r("timeout"), 15000));
  const outcome = await Promise.race([result, timeout]);
  pushDbg("forceRegister — outcome", outcome);
  return outcome;
}
