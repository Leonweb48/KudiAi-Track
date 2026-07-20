/**
 * NotificationPreferences — Part 4.
 * Reads/writes notification_preferences table.
 * Mounted from Settings → Notifications row.
 *
 * Master toggle: In-app always on (display only); Push on/off.
 * Per-category: Money approvals · Savings activity · Stock alerts.
 * All preferences stored server-side; enforced in notify-send.
 */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../utils/supabase";
import Modal from "./shared/Modal";

// ── Native push helpers (no-op on web) ────────────────────────────────────────
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

// ── Sub-components ────────────────────────────────────────────────────────────
function Toggle({ on, onChange }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative w-11 h-6 rounded-full transition-colors duration-200 focus-visible:outline-none flex-shrink-0 ${on ? "bg-brand-500 dark:bg-brand-600" : "bg-slate-300 dark:bg-slate-600"}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${on ? "translate-x-5" : "translate-x-0"}`} />
    </button>
  );
}

function PrefRow({ label, sub, on, onChange, disabled = false }) {
  return (
    <div className={`flex items-center justify-between gap-4 py-3.5 ${disabled ? "opacity-50" : ""}`}>
      <div className="min-w-0">
        <p className="text-[14px] font-semibold text-slate-800 dark:text-slate-100 truncate">{label}</p>
        {sub && <p className="text-[12px] text-slate-400 dark:text-slate-500 mt-0.5">{sub}</p>}
      </div>
      <Toggle on={disabled ? true : on} onChange={disabled ? undefined : onChange} />
    </div>
  );
}

// ── Status pill ───────────────────────────────────────────────────────────────
function StatusPill({ status }) {
  const cfg = {
    granted: { bg: "bg-green-100 dark:bg-green-900/30", text: "text-green-700 dark:text-green-400", label: "Permission granted" },
    denied:  { bg: "bg-red-100 dark:bg-red-900/30",   text: "text-red-700 dark:text-red-400",   label: "Permission denied" },
    prompt:  { bg: "bg-amber-100 dark:bg-amber-900/30", text: "text-amber-700 dark:text-amber-400", label: "Not yet enabled" },
  }[status] ?? { bg: "bg-slate-100 dark:bg-slate-800", text: "text-slate-500", label: "Checking…" };

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${cfg.bg} ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${status === "granted" ? "bg-green-500" : status === "denied" ? "bg-red-500" : "bg-amber-500"}`} />
      {cfg.label}
    </span>
  );
}

const DEFAULT_PREFS = { push_enabled: true, pref_money: true, pref_savings: true, pref_stock: true };

export default function NotificationPreferences({ userId, onClose }) {
  const [prefs,        setPrefs]        = useState(DEFAULT_PREFS);
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [saved,        setSaved]        = useState(false);

  // Native push registration state
  const [pushStatus,   setPushStatus]   = useState(null);   // "granted"|"denied"|"prompt"|null
  const [enabling,     setEnabling]     = useState(false);
  const [enableResult, setEnableResult] = useState(null);   // "ok"|"denied"|"error"

  // End-to-end test
  const [testing,      setTesting]      = useState(false);
  const [testResult,   setTestResult]   = useState(null);   // "sent"|"error"|null

  // Load saved preferences
  useEffect(() => {
    if (!userId) return;
    (async () => {
      const { data } = await supabase
        .from("notification_preferences")
        .select("push_enabled, pref_money, pref_savings, pref_stock")
        .eq("user_id", userId)
        .maybeSingle();
      setPrefs(data ?? DEFAULT_PREFS);
      setLoading(false);
    })();
  }, [userId]);

  // Check native push permission on mount
  useEffect(() => {
    if (!isNative()) return;
    (async () => {
      const Push = await getPushPlugin();
      if (!Push) return;
      const { receive } = await Push.checkPermissions();
      setPushStatus(receive);
    })();
  }, []);

  const update = (field) => (val) => setPrefs(p => ({ ...p, [field]: val }));

  const save = async () => {
    setSaving(true);
    await supabase.from("notification_preferences")
      .upsert({ user_id: userId, ...prefs, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // Manually request push permission + register FCM token
  const handleEnablePush = useCallback(async () => {
    setEnabling(true);
    setEnableResult(null);
    try {
      const Push = await getPushPlugin();
      if (!Push) return;

      let status = pushStatus;

      if (status !== "granted") {
        // Clear the one-time-prompt flag so the hook also retries on next launch
        localStorage.removeItem("kt_push_prompted");
        const { receive } = await Push.requestPermissions();
        status = receive;
        setPushStatus(receive);
      }

      if (status === "granted") {
        await Push.register();
        setEnableResult("ok");
      } else {
        setEnableResult("denied");
      }
    } catch {
      setEnableResult("error");
    } finally {
      setEnabling(false);
    }
  }, [pushStatus]);

  // Send a test notification through notify-send → verifies the full pipeline
  const handleTest = useCallback(async () => {
    if (!userId) return;
    setTesting(true);
    setTestResult(null);
    try {
      await supabase.functions.invoke("notify-send", {
        body: {
          action:   "notify",
          userId,
          type:     "test",
          title:    "Test Notification",
          body:     "KudiAI notification pipeline is working.",
          priority: "high",
          category: "money",
        },
      });
      setTestResult("sent");
      setTimeout(() => setTestResult(null), 4000);
    } catch {
      setTestResult("error");
      setTimeout(() => setTestResult(null), 4000);
    } finally {
      setTesting(false);
    }
  }, [userId]);

  return (
    <Modal title="Notification Preferences" onClose={onClose}>
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <div className="w-5 h-5 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="px-4 pb-6 space-y-0">
          {/* Channels */}
          <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider pt-4 pb-1">Channels</p>
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 overflow-hidden divide-y divide-slate-100 dark:divide-slate-700 px-4">
            <PrefRow
              label="In-app Notifications"
              sub="Bell icon + notification center — always on"
              on={true}
              onChange={() => {}}
              disabled
            />
            <PrefRow
              label="Push Notifications"
              sub="Android alerts when the app is closed"
              on={prefs.push_enabled}
              onChange={update("push_enabled")}
            />
          </div>

          {/* Native push permission status + action — shown on native builds only */}
          {isNative() && (
            <div className="mt-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 px-4 py-3.5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">Android permission</p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">Required to receive push alerts</p>
                </div>
                {pushStatus && <StatusPill status={pushStatus} />}
              </div>

              {/* Enable button — shown when not yet granted */}
              {pushStatus !== "granted" && (
                <button
                  onClick={handleEnablePush}
                  disabled={enabling}
                  className="w-full py-2.5 rounded-xl text-[13px] font-bold text-white bg-[#16255A] active:opacity-80 transition-opacity disabled:opacity-60"
                >
                  {enabling ? "Enabling…" : pushStatus === "denied" ? "Re-request Permission" : "Enable Push Notifications"}
                </button>
              )}

              {/* Outcome of enable attempt */}
              {enableResult === "ok" && (
                <p className="text-[12px] text-green-600 dark:text-green-400 font-semibold text-center">
                  Push enabled — your device is now registered.
                </p>
              )}
              {enableResult === "denied" && (
                <p className="text-[12px] text-red-500 dark:text-red-400 font-semibold text-center">
                  Permission denied. Go to Android Settings → Apps → KudiAI Track → Notifications and enable it manually.
                </p>
              )}
              {enableResult === "error" && (
                <p className="text-[12px] text-red-500 dark:text-red-400 font-semibold text-center">
                  Something went wrong. Try again or restart the app.
                </p>
              )}

              {/* Test button — always shown on native */}
              <button
                onClick={handleTest}
                disabled={testing}
                className="w-full py-2.5 rounded-xl text-[13px] font-bold text-[#16255A] dark:text-brand-400 border border-[#16255A]/30 dark:border-brand-400/30 active:bg-[#16255A]/5 transition-colors disabled:opacity-60"
              >
                {testing ? "Sending…" : "Send Test Notification"}
              </button>

              {testResult === "sent" && (
                <p className="text-[12px] text-green-600 dark:text-green-400 font-semibold text-center">
                  Test sent — check your bell icon and (if push is enabled) your notification shade.
                </p>
              )}
              {testResult === "error" && (
                <p className="text-[12px] text-red-500 dark:text-red-400 font-semibold text-center">
                  Test failed — check your internet connection.
                </p>
              )}
            </div>
          )}

          {/* Categories */}
          <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider pt-5 pb-1">Categories</p>
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 overflow-hidden divide-y divide-slate-100 dark:divide-slate-700 px-4">
            <PrefRow
              label="Money & Approvals"
              sub="Collections, withdrawals, capital alerts, security holds"
              on={prefs.pref_money}
              onChange={update("pref_money")}
            />
            <PrefRow
              label="Savings Activity"
              sub="Contribution approvals, payouts, loan updates"
              on={prefs.pref_savings}
              onChange={update("pref_savings")}
            />
            <PrefRow
              label="Stock Alerts"
              sub="Low inventory warnings"
              on={prefs.pref_stock}
              onChange={update("pref_stock")}
            />
          </div>

          <button
            onClick={save}
            disabled={saving}
            className="mt-5 w-full py-3 rounded-2xl text-[15px] font-bold text-white bg-[#16255A] active:opacity-80 transition-opacity disabled:opacity-60"
          >
            {saved ? "Saved!" : saving ? "Saving…" : "Save Preferences"}
          </button>
        </div>
      )}
    </Modal>
  );
}
