import { useState, useEffect, useCallback, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { speakText } from "../utils/tts";

const MAX = 100;
let _nativeNotifId = 1;

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

export function useNotifications(userId) {
  const [notifications, setN] = useState([]);
  const [settings,      setS] = useState(DEFAULT_SETTINGS);
  const [open,       setOpen] = useState(false);
  const [showSt,   setShowSt] = useState(false);
  const ready  = useRef(false);
  const setRef = useRef(DEFAULT_SETTINGS);

  // Load from localStorage once userId is ready
  useEffect(() => {
    if (!userId || ready.current) return;
    ready.current = true;
    setN(loadLS(`kt_notifs_${userId}`, []));
    const s = loadLS(`kt_notif_settings_${userId}`, DEFAULT_SETTINGS);
    setS(s);
    setRef.current = s;
  }, [userId]);

  // Keep ref in sync with state (avoids stale closure in addNotification)
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

  const pushNative = useCallback(async (title, body) => {
    try {
      await LocalNotifications.schedule({
        notifications: [{
          id:    _nativeNotifId++,
          title,
          body,
          sound: "default",
          smallIcon: "ic_stat_icon_config_sample",
          iconColor: "#4f46e5",
        }],
      });
    } catch { /* non-critical */ }
  }, []);

  const pushBrowser = useCallback((title, body) => {
    if (Capacitor.isNativePlatform()) {
      pushNative(title, body);
      return;
    }
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try { new Notification(title, { body, icon: "/logo.png", badge: "/logo.png" }); } catch {}
  }, [pushNative]);

  const speak = useCallback((text) => {
    speakText(text, "en").catch(() => {});
  }, []);

  const addNotification = useCallback((type, title, message) => {
    const s = setRef.current;
    if (s[type] === false) return; // type disabled in settings

    const n = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type, title, message,
      ts: new Date().toISOString(),
      read: false,
    };
    setN(p => [n, ...p].slice(0, MAX));
    if (s.push)  pushBrowser(title, message);
    if (s.voice) speak(`${title}. ${message}`);
  }, [pushBrowser, speak]);

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
  };
}
