import { useState, useEffect, useCallback, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { speakText } from "../utils/tts";
import { ensureTxnChannel, TXN_CHANNEL } from "../utils/tts";

const MAX = 100;
let _nativeNotifId = 1;

// Two-tone chime played in-app (web only — native uses OS sound via pushNative)
function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.28, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);
    const o1 = ctx.createOscillator();
    o1.type = "sine"; o1.frequency.value = 880;
    o1.connect(gain); o1.start(ctx.currentTime); o1.stop(ctx.currentTime + 0.15);
    const o2 = ctx.createOscillator();
    o2.type = "sine"; o2.frequency.value = 1320;
    o2.connect(gain); o2.start(ctx.currentTime + 0.18); o2.stop(ctx.currentTime + 0.4);
    o2.onended = () => { try { ctx.close(); } catch {} };
  } catch {}
}

const DEFAULT_SETTINGS = {
  push: false, voice: false,
  sales: true, credits: true, payments: true,
  stock: true, bills: true, aso: true, system: true,
};

function loadLS(key, fallback) {
  try {
    const r = localStorage.getItem(key);
    if (!r) return fallback;
    const parsed = JSON.parse(r);
    return Array.isArray(fallback) ? (Array.isArray(parsed) ? parsed : fallback)
      : { ...fallback, ...parsed };
  } catch { return fallback; }
}

// ── Notification action types registered with the OS ─────────────────────────
const NOTIF_ACTION_TYPES = [
  {
    id: "PAYMENT_ACTION",
    actions: [{ id: "view_receipt", title: "View Receipt" }],
  },
  {
    id: "CREDIT_ACTION",
    actions: [{ id: "view_credit", title: "View Credit" }],
  },
  {
    id: "STOCK_ACTION",
    actions: [{ id: "view_stock", title: "View Stock" }],
  },
  {
    id: "BILLS_ACTION",
    actions: [{ id: "view_bills", title: "View Bill" }],
  },
  {
    id: "ASO_ACTION",
    actions: [{ id: "view_aso", title: "View Details" }],
  },
  {
    id: "SUPPORT_ACTION",
    actions: [{ id: "open_ticket", title: "Open Ticket" }],
  },
];

// Action button id → in-app route
const ACTION_ROUTES = {
  view_receipt: "/transactions",
  view_credit:  "/finance",
  view_stock:   "/inventory",
  view_bills:   "/bills",
  view_aso:     "/aso",
  open_ticket:  "/help",
};

// Notification type → action type id
const TYPE_TO_ACTION = {
  payments: "PAYMENT_ACTION",
  sales:    "PAYMENT_ACTION",
  credits:  "CREDIT_ACTION",
  stock:    "STOCK_ACTION",
  bills:    "BILLS_ACTION",
  aso:      "ASO_ACTION",
  system:   null,
};

// Notification type → target route for body-tap
const TYPE_TO_ROUTE = {
  payments: "/transactions",
  sales:    "/transactions",
  credits:  "/finance",
  stock:    "/inventory",
  bills:    "/bills",
  aso:      "/aso",
  system:   "/",
};

// Store the pending deep-link and dispatch a foreground event.
// App.jsx picks this up via "kt-notif-navigate" (foreground) and localStorage (cold start / PIN lock).
function storePendingRoute(route) {
  localStorage.setItem("kt_pending_notif_route", route);
  window.dispatchEvent(new CustomEvent("kt-notif-navigate", { detail: { route } }));
}

export function useNotifications(userId) {
  const [notifications, setN] = useState([]);
  const [settings,      setS] = useState(DEFAULT_SETTINGS);
  const [open,       setOpen] = useState(false);
  const [showSt,   setShowSt] = useState(false);
  const [lastNotif, setLastNotif] = useState(null);
  const ready  = useRef(false);
  const setRef = useRef(DEFAULT_SETTINGS);
  const listenerHandle = useRef(null);

  // Load from localStorage once userId is ready, then auto-sync push with OS permission
  useEffect(() => {
    if (!userId || ready.current) return;
    ready.current = true;
    setN(loadLS(`kt_notifs_${userId}`, []));
    const s = loadLS(`kt_notif_settings_${userId}`, DEFAULT_SETTINGS);

    const maybeEnablePush = async () => {
      // If push is already enabled in settings, apply as-is
      if (s.push) { setS(s); setRef.current = s; return; }
      // Otherwise, check actual OS permission so returning users with granted
      // permission don't lose push silently (avoids the push=false default)
      let granted = false;
      if (Capacitor.isNativePlatform()) {
        try {
          const { display } = await LocalNotifications.checkPermissions();
          granted = display === "granted";
        } catch {}
      } else if ("Notification" in window) {
        granted = Notification.permission === "granted";
      }
      const finalS = granted ? { ...s, push: true } : s;
      setS(finalS);
      setRef.current = finalS;
    };
    maybeEnablePush();
  }, [userId]);

  // Keep ref in sync with state
  useEffect(() => { setRef.current = settings; }, [settings]);

  // Persist notifications
  useEffect(() => {
    if (!ready.current || !userId) return;
    localStorage.setItem(`kt_notifs_${userId}`, JSON.stringify(notifications.slice(0, MAX)));
  }, [notifications, userId]);

  // Persist settings
  useEffect(() => {
    if (!ready.current || !userId) return;
    localStorage.setItem(`kt_notif_settings_${userId}`, JSON.stringify(settings));
  }, [settings, userId]);

  // Register OS notification action types + set up action listener (once, on native only)
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    LocalNotifications.registerActionTypes({ types: NOTIF_ACTION_TYPES }).catch(() => {});

    LocalNotifications.addListener("localNotificationActionPerformed", (event) => {
      const actionId = event.actionId;
      const notif    = event.notification;
      let route;

      if (actionId === "tap") {
        // Body tap — use the route embedded in extra
        route = notif?.extra?.route || "/";
      } else {
        route = ACTION_ROUTES[actionId] || "/";
      }

      storePendingRoute(route);
    }).then(h => { listenerHandle.current = h; }).catch(() => {});

    return () => { listenerHandle.current?.remove(); };
  }, []);

  // ── Native push notification ────────────────────────────────────────────────
  const pushNative = useCallback(async (title, body, opts = {}) => {
    try {
      await ensureTxnChannel();
      await LocalNotifications.schedule({
        notifications: [{
          id:           _nativeNotifId++,
          title,
          body,
          largeBody:    body,                   // BigTextStyle — drawer chevron expands to full text
          largeIcon:    "ic_notification_large",// full-color app icon (copied to drawable/)
          smallIcon:    "ic_notification",      // white-on-transparent K mark
          iconColor:    "#3DA829",
          channelId:    TXN_CHANNEL,
          sound:        "default",
          actionTypeId: opts.actionTypeId || null,
          extra:        opts.extra || {},
        }],
      });
    } catch { /* non-critical */ }
  }, []);

  // ── Web push notification ──────────────────────────────────────────────────
  const pushBrowser = useCallback((title, body) => {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try { new Notification(title, { body, icon: "/logo.png", badge: "/logo.png" }); } catch {}
  }, []);

  const speak = useCallback((text) => {
    speakText(text, "en").catch(() => {});
  }, []);

  // ── Public: add an in-app + native notification ────────────────────────────
  const addNotification = useCallback((type, title, message) => {
    const s = setRef.current;
    if (s[type] === false) return;

    const n = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type, title, message,
      ts: new Date().toISOString(),
      read: false,
    };
    setN(p => [n, ...p].slice(0, MAX));
    setLastNotif(n);

    // In-app beep: plays when the app is in the foreground so the user hears
    // feedback even if the OS suppresses the notification (common when foregrounded)
    if (!Capacitor.isNativePlatform() && document.visibilityState === "visible") {
      playBeep();
    }

    if (s.push) {
      if (Capacitor.isNativePlatform()) {
        pushNative(title, message, {
          actionTypeId: TYPE_TO_ACTION[type] || null,
          extra: { route: TYPE_TO_ROUTE[type] || "/" },
        });
      } else {
        pushBrowser(title, message);
      }
    }
    if (s.voice) speak(`${title}. ${message}`);
  }, [pushNative, pushBrowser, speak]);

  const clearLastNotif = useCallback(() => setLastNotif(null), []);

  const markRead    = useCallback((id) => setN(p => p.map(n => n.id === id ? { ...n, read: true } : n)), []);
  const markAllRead = useCallback(() => setN(p => p.map(n => ({ ...n, read: true }))), []);
  const clearAll    = useCallback(() => setN([]), []);

  const updateSetting = useCallback((key, val) => setS(p => ({ ...p, [key]: val })), []);

  const requestPush = useCallback(async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        const result = await LocalNotifications.requestPermissions();
        if (result.display === "granted") {
          updateSetting("push", true);
          return "granted";
        }
        return result.display;
      } catch {
        return "unsupported";
      }
    }
    if (!("Notification" in window)) return "unsupported";
    if (Notification.permission === "denied") return "denied";
    const perm = await Notification.requestPermission();
    if (perm === "granted") updateSetting("push", true);
    return perm;
  }, [updateSetting]);

  const unreadCount = notifications.filter(n => !n.read).length;

  return {
    notifications, settings, unreadCount,
    open, setOpen,
    showSettings: showSt, setShowSettings: setShowSt,
    addNotification, markRead, markAllRead, clearAll,
    updateSetting, requestPush, speak,
    lastNotif, clearLastNotif,
  };
}
