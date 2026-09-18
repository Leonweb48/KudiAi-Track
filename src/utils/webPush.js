/**
 * Browser (web) push — Firebase Cloud Messaging for non-native sessions.
 * The Android app uses @capacitor/push-notifications instead
 * (src/hooks/usePushNotifications.js); this covers desktop browsers, Android
 * Chrome, and iOS 16.4+ PWAs installed to the Home Screen.
 *
 * Needs a Firebase *Web* app registered in the same project the Android app
 * uses (kudiai-track26). Set at build time (Vercel env vars):
 *   REACT_APP_FIREBASE_API_KEY   — the web app's apiKey
 *   REACT_APP_FIREBASE_APP_ID    — the web app's appId (1:…:web:…)
 *   REACT_APP_FIREBASE_VAPID_KEY — optional Web Push certificate key
 * projectId / messagingSenderId default to the existing project's values.
 * Until the first two are set, webPushConfigured() is false and every entry
 * point below is a no-op — the UI never shows a button that can't work.
 *
 * The Firebase SDK is imported on demand so it costs nothing on normal loads.
 */

import { Capacitor } from "@capacitor/core";
import { supabase } from "./supabase";

const CONFIG = {
  apiKey:            process.env.REACT_APP_FIREBASE_API_KEY,
  appId:             process.env.REACT_APP_FIREBASE_APP_ID,
  projectId:         process.env.REACT_APP_FIREBASE_PROJECT_ID    || "kudiai-track26",
  messagingSenderId: process.env.REACT_APP_FIREBASE_SENDER_ID     || "342535398493",
};
const VAPID_KEY = process.env.REACT_APP_FIREBASE_VAPID_KEY || undefined;
const TOKEN_KEY = "kt_web_push_token";

export function webPushConfigured() {
  return !!(CONFIG.apiKey && CONFIG.appId);
}

export function webPushSupported() {
  return typeof window !== "undefined"
    && !Capacitor.isNativePlatform()
    && "Notification" in window
    && "serviceWorker" in navigator
    && "PushManager" in window;
}

// iPhone/iPad Safari only exposes push to a site added to the Home Screen.
export function needsIosInstall() {
  if (typeof window === "undefined") return false;
  const ios = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  const standalone = window.navigator.standalone === true
    || window.matchMedia?.("(display-mode: standalone)").matches;
  return ios && !standalone;
}

/** "default" | "granted" | "denied" | "unsupported" */
export function webPushPermission() {
  if (!webPushSupported()) return "unsupported";
  return Notification.permission;
}

async function getMessagingAndToken() {
  const [{ initializeApp, getApps, getApp }, { getMessaging, getToken, isSupported }] = await Promise.all([
    import("firebase/app"),
    import("firebase/messaging"),
  ]);
  if (!(await isSupported())) return { unsupported: true };

  const app = getApps().length ? getApp() : initializeApp(CONFIG);
  const registration = await navigator.serviceWorker.ready;
  const token = await getToken(getMessaging(app), {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: registration,
  });
  return { token };
}

async function registerToken(userId, token) {
  const { error } = await supabase.functions.invoke("notify-send", {
    body: { action: "register-token", userId, token, platform: "web" },
  });
  if (error) throw new Error(error.message);
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* private mode */ }
}

/**
 * Must be called from a user gesture (a button tap) — browsers block or
 * silently ignore permission prompts that aren't. Returns
 * "ok" | "denied" | "dismissed" | "unsupported" | "not_configured" | "error".
 */
export async function enableWebPush(userId) {
  if (!webPushConfigured()) return "not_configured";
  if (!webPushSupported())  return "unsupported";
  try {
    const permission = await Notification.requestPermission();
    if (permission === "denied")  return "denied";
    if (permission !== "granted") return "dismissed";

    const res = await getMessagingAndToken();
    if (res.unsupported) return "unsupported";
    if (!res.token)      return "error";
    await registerToken(userId, res.token);
    return "ok";
  } catch (e) {
    console.error("[WebPush] enable failed:", e?.message);
    return "error";
  }
}

/**
 * Silent re-registration for a user who already granted permission — FCM
 * tokens rotate, and registering also moves the token to whoever is logged in
 * on this browser (notify-send keeps one owner per token). Never prompts.
 */
export async function syncWebPushToken(userId) {
  if (!userId || !webPushConfigured() || !webPushSupported()) return;
  if (Notification.permission !== "granted") return;
  try {
    const res = await getMessagingAndToken();
    if (res.token) await registerToken(userId, res.token);
  } catch (e) {
    console.error("[WebPush] sync failed:", e?.message);
  }
}
