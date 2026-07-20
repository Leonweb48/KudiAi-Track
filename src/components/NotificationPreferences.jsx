/**
 * NotificationPreferences — Part 4.
 * Reads/writes notification_preferences table.
 * Mounted from Settings → Notifications row.
 *
 * Master toggle: In-app always on (display only); Push on/off.
 * Per-category: Money approvals · Savings activity · Stock alerts.
 * All preferences stored server-side; enforced in notify-send.
 */

import { useState, useEffect } from "react";
import { supabase } from "../utils/supabase";
import Modal from "./shared/Modal";

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

const DEFAULT_PREFS = { push_enabled: true, pref_money: true, pref_savings: true, pref_stock: true };

export default function NotificationPreferences({ userId, onClose }) {
  const [prefs,   setPrefs]   = useState(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);

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

  const update = (field) => (val) => setPrefs(p => ({ ...p, [field]: val }));

  const save = async () => {
    setSaving(true);
    await supabase.from("notification_preferences")
      .upsert({ user_id: userId, ...prefs, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

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
