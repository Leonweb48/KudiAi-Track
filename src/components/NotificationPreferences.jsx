/**
 * NotificationPreferences — Part 4.
 * Reads/writes notification_preferences table.
 * Mounted from Settings → Notifications row.
 */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../utils/supabase";
import Modal from "./shared/Modal";
import { webPushSupported, webPushConfigured, webPushPermission, needsIosInstall, enableWebPush } from "../utils/webPush";

// ── Native push helpers ────────────────────────────────────────────────────────
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
function Toggle({ on, onChange, locked = false }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={locked ? undefined : () => onChange(!on)}
      disabled={locked}
      className={`relative w-11 h-6 rounded-full transition-colors duration-200 focus-visible:outline-none flex-shrink-0
        ${on ? "bg-[#16255A]" : "bg-slate-300 dark:bg-slate-600"}
        ${locked ? "cursor-default" : ""}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${on ? "translate-x-5" : "translate-x-0"}`} />
    </button>
  );
}

function PrefRow({ label, sub, on, onChange, locked = false }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-[14px] font-semibold text-slate-800 dark:text-slate-100 truncate">{label}</p>
          {locked && (
            <span className="text-[10px] font-bold text-[#16255A] dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded-full flex-shrink-0">
              Always on
            </span>
          )}
        </div>
        {sub && <p className="text-[12px] text-slate-400 dark:text-slate-500 mt-0.5">{sub}</p>}
      </div>
      <Toggle on={on} onChange={onChange} locked={locked} />
    </div>
  );
}

// ── Status pill ───────────────────────────────────────────────────────────────
function StatusPill({ status }) {
  const cfg = {
    granted: { dot: "bg-green-500", bg: "bg-green-100 dark:bg-green-900/30", text: "text-green-700 dark:text-green-400", label: "Permission granted" },
    denied:  { dot: "bg-red-500",   bg: "bg-red-100 dark:bg-red-900/30",     text: "text-red-700 dark:text-red-400",   label: "Permission denied" },
    prompt:  { dot: "bg-amber-500", bg: "bg-amber-100 dark:bg-amber-900/30", text: "text-amber-700 dark:text-amber-400", label: "Not yet enabled" },
  }[status] ?? { dot: "bg-slate-400", bg: "bg-slate-100 dark:bg-slate-800", text: "text-slate-500", label: "Checking…" };

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold ${cfg.bg} ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function InfoMsg({ children, type = "info" }) {
  const styles = {
    success: "text-green-600 dark:text-green-400",
    error:   "text-red-500 dark:text-red-400",
    warn:    "text-amber-600 dark:text-amber-400",
    info:    "text-slate-500 dark:text-slate-400",
  };
  return <p className={`text-[12px] font-semibold text-center ${styles[type]}`}>{children}</p>;
}

const DEFAULT_PREFS = {
  push_enabled:                true,
  pref_money:                  true,
  pref_savings:                true,
  pref_stock:                  true,
  pref_permissions:            true,
  pref_approvals:              true,
  pref_credit:                 true,
  pref_alert:                  true,
  pref_bills:                  true,
  pref_milestone:              true,
  email_enabled:               true,
  large_txn_threshold:         null,
};

const PREF_COLUMNS = "push_enabled, pref_money, pref_savings, pref_stock, pref_permissions, pref_approvals, pref_credit, pref_alert, pref_bills, pref_milestone, email_enabled, large_txn_threshold";

// Category rows shown per portal
const PORTAL_CATEGORIES = {
  owner: [
    { field: "pref_money",     label: "Money & Sales",      sub: "Sales, cash-ins, withdrawals, security holds" },
    { field: "pref_savings",   label: "Ajo & Savings",      sub: "Contributions, payouts, collection reminders" },
    { field: "pref_credit",    label: "Credit & Invoice",   sub: "Credit sales, repayments, due reminders, invoices" },
    { field: "pref_alert",     label: "Alerts & Warnings",  sub: "Unusual transactions, capital alerts" },
    { field: "pref_stock",     label: "Stock",              sub: "Low inventory warnings" },
    { field: "pref_bills",     label: "Bills & Payments",   sub: "Airtime, data, and bill payment confirmations" },
    { field: "pref_milestone", label: "Milestones",         sub: "Sales targets reached" },
  ],
  staff: [
    { field: "pref_money",       label: "Money Alerts",        sub: "Security holds, cash-in alerts" },
    { field: "pref_credit",      label: "Credit Sales",        sub: "Credit extended and repayments" },
    { field: "pref_approvals",   label: "Collection Approvals", sub: "Approval and rejection of your recorded collections" },
    { field: "pref_permissions", label: "Permissions & Access", sub: "Permission changes, shift updates, invitations" },
  ],
  manager: [
    { field: "pref_money",       label: "Branch Money Alerts",  sub: "Cash-in alerts and security holds for your branch" },
    { field: "pref_approvals",   label: "Approvals",            sub: "Collection approvals from branch staff" },
    { field: "pref_permissions", label: "Permissions & Access", sub: "Permission changes and role updates" },
  ],
  ajo: [
    { field: "pref_savings", label: "Savings Activity",    sub: "Contribution approvals, payouts, group releases" },
    { field: "pref_money",   label: "Money Transactions",  sub: "Deposits confirmed/rejected, withdrawals approved/rejected" },
  ],
  coop: [
    { field: "pref_savings", label: "Savings & Programs",  sub: "Savings activity, programs, announcements" },
    { field: "pref_credit",  label: "Loans",               sub: "Loan requests, approvals, repayments" },
    { field: "pref_money",   label: "Money Transactions",  sub: "Withdrawals and disbursements" },
  ],
};

// eslint-disable-next-line no-unused-vars
export default function NotificationPreferences({ userId, onClose, portal = "owner" }) {
  const [prefs,        setPrefs]        = useState(DEFAULT_PREFS);
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [saved,        setSaved]        = useState(false);

  // Native push state
  const [pushStatus,   setPushStatus]   = useState(null);
  const [enabling,     setEnabling]     = useState(false);
  const [enableResult, setEnableResult] = useState(null); // "ok"|"denied"|"timeout"|"error"

  // Browser (web) push state — separate from the native Android flow above
  const [webStatus,    setWebStatus]    = useState(() => webPushPermission()); // "default"|"granted"|"denied"|"unsupported"
  const [webEnabling,  setWebEnabling]  = useState(false);
  const [webResult,    setWebResult]    = useState(null); // "ok"|"denied"|"dismissed"|"error"

  const handleEnableWeb = useCallback(async () => {
    setWebEnabling(true);
    setWebResult(null);
    const result = await enableWebPush(userId);
    setWebResult(result);
    setWebStatus(webPushPermission());
    setWebEnabling(false);
  }, [userId]);

  // Load saved preferences
  useEffect(() => {
    if (!userId) return;
    (async () => {
      const { data } = await supabase
        .from("notification_preferences")
        .select(PREF_COLUMNS)
        .eq("user_id", userId)
        .maybeSingle();
      setPrefs({ ...DEFAULT_PREFS, ...(data ?? {}) });
      setLoading(false);
    })();
  }, [userId]);

  // Check native push permission on mount
  useEffect(() => {
    if (!isNative()) return;
    (async () => {
      const Push = await getPushPlugin();
      if (!Push) return;
      try {
        const { receive } = await Push.checkPermissions();
        setPushStatus(receive);
      } catch { /* bridge unavailable — leave null */ }
    })();
  }, []);

  const update = (field) => (val) => setPrefs(p => ({ ...p, [field]: val }));

  const save = async () => {
    setSaving(true);
    await supabase.from("notification_preferences").upsert({
      user_id:                     userId,
      push_enabled:                prefs.push_enabled,
      pref_money:                  prefs.pref_money,
      pref_savings:                prefs.pref_savings,
      pref_stock:                  prefs.pref_stock,
      pref_permissions:            prefs.pref_permissions,
      pref_approvals:              prefs.pref_approvals,
      pref_credit:                 prefs.pref_credit,
      pref_alert:                  prefs.pref_alert,
      pref_bills:                  prefs.pref_bills,
      pref_milestone:              prefs.pref_milestone,
      email_enabled:               prefs.email_enabled,
      large_txn_threshold:         prefs.large_txn_threshold || null,
      updated_at:                  new Date().toISOString(),
    }, { onConflict: "user_id" });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleEnablePush = useCallback(async () => {
    setEnabling(true);
    setEnableResult(null);
    try {
      const Push = await getPushPlugin();
      if (!Push) { setEnableResult("error"); return; }

      // If already denied by Android, requestPermissions() can hang forever —
      // skip it and tell the user to use Android Settings instead.
      if (pushStatus === "denied") {
        setEnableResult("denied");
        return;
      }

      let currentStatus = pushStatus;

      if (currentStatus !== "granted") {
        localStorage.removeItem("kt_push_prompted");

        // Race against 10 s — requestPermissions can hang if the dialog
        // doesn't appear (e.g. after "Don't ask again" on some Android builds).
        const result = await Promise.race([
          Push.requestPermissions(),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 10000)),
        ]);

        currentStatus = result.receive;
        setPushStatus(result.receive);
      }

      if (currentStatus === "granted") {
        await Push.register();
        setEnableResult("ok");
      } else {
        setEnableResult("denied");
      }
    } catch (err) {
      setEnableResult(err?.message === "timeout" ? "timeout" : "error");
    } finally {
      setEnabling(false);
    }
  }, [pushStatus]);


  return (
    <Modal title="Notification Preferences" onClose={onClose}>
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <div className="w-5 h-5 border-2 border-[#16255A] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="px-4 pb-6 space-y-0">

          {/* ── Channels ── */}
          <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider pt-4 pb-1">Channels</p>
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700 px-4">
            <PrefRow
              label="In-app Notifications"
              sub="Bell icon and notification center"
              on={true}
              onChange={() => {}}
              locked
            />
            <PrefRow
              label="Push Notifications"
              sub="Alerts when the app is closed (Android app and browser)"
              on={prefs.push_enabled}
              onChange={update("push_enabled")}
            />
            {portal === "owner" && (
              <PrefRow
                label="Summary & Alert Emails"
                sub="Daily summary, low-stock, and bill payment emails"
                on={prefs.email_enabled}
                onChange={update("email_enabled")}
              />
            )}
          </div>

          {/* ── Native push permission card (device only) ── */}
          {isNative() && (
            <div className="mt-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 px-4 py-4 space-y-3">

              {/* Status row */}
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">Android permission</p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">Required to receive push alerts</p>
                </div>
                {pushStatus ? <StatusPill status={pushStatus} /> : (
                  <span className="text-[11px] text-slate-400">Checking…</span>
                )}
              </div>

              {/* Enable button — only when not yet granted */}
              {pushStatus !== "granted" && (
                <button
                  onClick={handleEnablePush}
                  disabled={enabling}
                  className="w-full py-2.5 rounded-xl text-[13px] font-bold text-white bg-[#16255A] active:opacity-80 transition-opacity disabled:opacity-60"
                >
                  {enabling
                    ? "Waiting for Android response…"
                    : pushStatus === "denied"
                      ? "Open Android Settings"
                      : "Enable Push Notifications"}
                </button>
              )}

              {/* Result messages */}
              {enableResult === "ok" && (
                <InfoMsg type="success">Push enabled — your device is now registered.</InfoMsg>
              )}
              {enableResult === "denied" && (
                <InfoMsg type="warn">
                  Go to Android Settings → Apps → KudiAI Track → Notifications and turn it on.
                </InfoMsg>
              )}
              {enableResult === "timeout" && (
                <InfoMsg type="warn">
                  The Android dialog didn't appear. Go to Android Settings → Apps → KudiAI Track → Notifications.
                </InfoMsg>
              )}
              {enableResult === "error" && (
                <InfoMsg type="error">Something went wrong. Try restarting the app.</InfoMsg>
              )}

            </div>
          )}

          {/* ── Browser push (web only) ── */}
          {!isNative() && webPushConfigured() && webPushSupported() && (
            <div className="mt-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 px-4 py-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">Browser notifications</p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">Alerts on this device even when the tab is closed</p>
                </div>
                <StatusPill status={webStatus === "default" ? "prompt" : webStatus} />
              </div>

              {webStatus !== "granted" && webStatus !== "denied" && (
                <button
                  onClick={handleEnableWeb}
                  disabled={webEnabling}
                  className="w-full py-2.5 rounded-xl text-[13px] font-bold text-white bg-[#16255A] active:opacity-80 transition-opacity disabled:opacity-60"
                >
                  {webEnabling ? "Waiting for your browser…" : "Enable browser notifications"}
                </button>
              )}

              {webStatus === "denied" && (
                <InfoMsg type="warn">
                  Notifications are blocked for this site. Click the padlock icon beside the address bar → Site settings → Notifications → Allow, then reload the page.
                </InfoMsg>
              )}
              {webResult === "ok" && (
                <InfoMsg type="success">Browser notifications are on for this device.</InfoMsg>
              )}
              {webResult === "dismissed" && (
                <InfoMsg type="warn">You closed the permission prompt — tap the button again whenever you're ready.</InfoMsg>
              )}
              {webResult === "error" && (
                <InfoMsg type="error">Couldn't turn on browser notifications. Try again, or reload the page first.</InfoMsg>
              )}
            </div>
          )}
          {!isNative() && webPushConfigured() && needsIosInstall() && (
            <div className="mt-3 px-1">
              <InfoMsg type="info">
                On iPhone or iPad: tap Share → Add to Home Screen, then open KudiAI Track from your Home Screen to turn on notifications.
              </InfoMsg>
            </div>
          )}

          {/* ── Categories ── */}
          <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider pt-5 pb-1">Categories</p>
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700 px-4">
            {(PORTAL_CATEGORIES[portal] ?? PORTAL_CATEGORIES.owner).map(cat => (
              <PrefRow
                key={cat.field}
                label={cat.label}
                sub={cat.sub}
                on={prefs[cat.field] ?? true}
                onChange={update(cat.field)}
              />
            ))}
          </div>

          {/* ── Thresholds (owner only) ── */}
          {portal === "owner" && (
            <>
              <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider pt-5 pb-1">Thresholds</p>
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700 px-4">
                <div className="py-3.5">
                  <p className="text-[14px] font-semibold text-slate-800 dark:text-slate-100">Large transaction alert (₦)</p>
                  <p className="text-[12px] text-slate-400 dark:text-slate-500 mt-0.5 mb-2">
                    Flags a staff-recorded transaction at or above this amount. Default ₦50,000.
                  </p>
                  <input
                    type="number" min="0" inputMode="numeric" placeholder="50000"
                    value={prefs.large_txn_threshold ?? ""}
                    onChange={e => update("large_txn_threshold")(e.target.value === "" ? null : parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-[14px] text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-400"
                  />
                </div>
              </div>
            </>
          )}

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
