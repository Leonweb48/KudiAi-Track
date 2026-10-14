/**
 * NotificationPreferences — Part 4.
 * Reads/writes notification_preferences table.
 * Mounted from Settings → Notifications row.
 */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../utils/supabase";
import Modal from "./shared/Modal";
import { useT } from "../contexts/LanguageContext";
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
  const t = useT();
  return (
    <div className="flex items-center justify-between gap-4 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-[14px] font-semibold text-slate-800 dark:text-slate-100 truncate">{label}</p>
          {locked && (
            <span className="text-[10px] font-bold text-[#16255A] dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded-full flex-shrink-0">
              {t("settings.notif.alwaysOn")}
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
  const t = useT();
  const cfg = {
    granted: { dot: "bg-green-500", bg: "bg-green-100 dark:bg-green-900/30", text: "text-green-700 dark:text-green-400", label: t("settings.notif.status.granted") },
    denied:  { dot: "bg-red-500",   bg: "bg-red-100 dark:bg-red-900/30",     text: "text-red-700 dark:text-red-400",   label: t("settings.notif.status.denied") },
    prompt:  { dot: "bg-amber-500", bg: "bg-amber-100 dark:bg-amber-900/30", text: "text-amber-700 dark:text-amber-400", label: t("settings.notif.status.prompt") },
  }[status] ?? { dot: "bg-slate-400", bg: "bg-slate-100 dark:bg-slate-800", text: "text-slate-500", label: t("settings.notif.status.checking") };

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

// ── Test notification ─────────────────────────────────────────────────────────
// Sends a real push to THIS account's registered devices (server: notify-send
// "send-test") and shows what Google's push service answered for each one, so
// "did it work?" has a real answer instead of a green tick that only proves a
// token was stored. A short delay gives the user time to leave the tab/app —
// browsers hide the OS popup while a KudiAI tab is visible.
const DEVICE_LABEL = { web: "settings.notif.device.web", android: "settings.notif.device.android", ios: "settings.notif.device.ios" };

function TestNotificationCard({ native, enabled }) {
  const t = useT();
  const [phase,     setPhase]     = useState("idle"); // idle | waiting | done
  const [countdown, setCountdown] = useState(0);
  const [result,    setResult]    = useState(null);

  const run = useCallback(async () => {
    const delay = native ? 4 : 8;
    setResult(null);
    setPhase("waiting");
    setCountdown(delay);
    const timer = setInterval(() => setCountdown((c) => (c > 0 ? c - 1 : 0)), 1000);
    try {
      const { data, error } = await supabase.functions.invoke("notify-send", {
        body: { action: "send-test", delay_seconds: delay },
      });
      if (error) throw new Error(error.message);
      setResult(data || {});
    } catch (e) {
      setResult({ error: String(e?.message || e) });
    } finally {
      clearInterval(timer);
      setPhase("done");
    }
  }, [native]);

  if (!enabled) return null;

  const devices = result?.devices || [];
  return (
    <div className="mt-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 px-4 py-4 space-y-3">
      <div>
        <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">{t("settings.notif.test.title")}</p>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{t("settings.notif.test.sub")}</p>
      </div>

      <button
        onClick={run}
        disabled={phase === "waiting"}
        className="w-full py-2.5 rounded-xl text-[13px] font-bold text-[#16255A] dark:text-slate-100 border border-slate-200 dark:border-slate-600 active:opacity-80 transition-opacity disabled:opacity-60"
      >
        {phase === "waiting" ? t("settings.notif.test.sending") : t("settings.notif.test.send")}
      </button>

      {phase === "waiting" && (
        <InfoMsg type="warn">
          {native
            ? t("settings.notif.test.leaveApp", { n: countdown })
            : t("settings.notif.test.switchTab", { n: countdown })}
        </InfoMsg>
      )}

      {phase === "done" && result?.error && (
        <InfoMsg type="error">{t("settings.notif.test.failed", { error: result.error })}</InfoMsg>
      )}
      {phase === "done" && !result?.error && result?.registered_devices === 0 && (
        <InfoMsg type="warn">{t("settings.notif.test.noDevice")}</InfoMsg>
      )}
      {phase === "done" && !result?.error && devices.length > 0 && (
        <div className="space-y-1.5">
          {devices.map((d, i) => (
            <p key={i} className={`text-[12px] font-semibold text-center ${d.ok ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
              {DEVICE_LABEL[d.platform] ? t(DEVICE_LABEL[d.platform]) : d.platform}:{" "}
              {d.ok ? t("settings.notif.test.accepted") : t("settings.notif.test.deviceFailed", { reason: `${d.errCode || t("settings.notif.test.status", { status: d.status })}${d.errMsg ? ` (${d.errMsg})` : ""}` })}
            </p>
          ))}
          <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center leading-snug">
            {t("settings.notif.test.note")}
          </p>
        </div>
      )}
    </div>
  );
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
  pref_promotions:             true,
  email_enabled:               true,
  large_txn_threshold:         null,
};

const PREF_COLUMNS = "push_enabled, pref_money, pref_savings, pref_stock, pref_permissions, pref_approvals, pref_credit, pref_alert, pref_bills, pref_milestone, pref_promotions, email_enabled, large_txn_threshold";

// Category rows shown per portal
const PORTAL_CATEGORIES = {
  owner: [
    { field: "pref_money",     lkey: "settings.notif.cat.owner.money", skey: "settings.notif.cat.owner.moneySub" },
    { field: "pref_savings",   lkey: "settings.notif.cat.owner.savings", skey: "settings.notif.cat.owner.savingsSub" },
    { field: "pref_credit",    lkey: "settings.notif.cat.owner.credit", skey: "settings.notif.cat.owner.creditSub" },
    { field: "pref_alert",     lkey: "settings.notif.cat.owner.alert", skey: "settings.notif.cat.owner.alertSub" },
    { field: "pref_stock",     lkey: "settings.notif.cat.owner.stock", skey: "settings.notif.cat.owner.stockSub" },
    { field: "pref_bills",     lkey: "settings.notif.cat.owner.bills", skey: "settings.notif.cat.owner.billsSub" },
    { field: "pref_milestone", lkey: "settings.notif.cat.owner.milestone", skey: "settings.notif.cat.owner.milestoneSub" },
  ],
  staff: [
    { field: "pref_money",       lkey: "settings.notif.cat.staff.money", skey: "settings.notif.cat.staff.moneySub" },
    { field: "pref_credit",      lkey: "settings.notif.cat.staff.credit", skey: "settings.notif.cat.staff.creditSub" },
    { field: "pref_approvals",   lkey: "settings.notif.cat.staff.approvals", skey: "settings.notif.cat.staff.approvalsSub" },
    { field: "pref_permissions", lkey: "settings.notif.cat.staff.permissions", skey: "settings.notif.cat.staff.permissionsSub" },
  ],
  manager: [
    { field: "pref_money",       lkey: "settings.notif.cat.manager.money", skey: "settings.notif.cat.manager.moneySub" },
    { field: "pref_approvals",   lkey: "settings.notif.cat.manager.approvals", skey: "settings.notif.cat.manager.approvalsSub" },
    { field: "pref_permissions", lkey: "settings.notif.cat.manager.permissions", skey: "settings.notif.cat.manager.permissionsSub" },
  ],
  ajo: [
    { field: "pref_savings", lkey: "settings.notif.cat.ajo.savings", skey: "settings.notif.cat.ajo.savingsSub" },
    { field: "pref_money",   lkey: "settings.notif.cat.ajo.money", skey: "settings.notif.cat.ajo.moneySub" },
  ],
  coop: [
    { field: "pref_savings", lkey: "settings.notif.cat.coop.savings", skey: "settings.notif.cat.coop.savingsSub" },
    { field: "pref_credit",  lkey: "settings.notif.cat.coop.credit", skey: "settings.notif.cat.coop.creditSub" },
    { field: "pref_money",   lkey: "settings.notif.cat.coop.money", skey: "settings.notif.cat.coop.moneySub" },
  ],
};

// Offers & updates — on every portal; turning it off stops promotional messages (push and bell) from KudiAI Track.
const PROMO_ROW = { field: "pref_promotions", lkey: "settings.notif.cat.promo", skey: "settings.notif.cat.promoSub" };

// eslint-disable-next-line no-unused-vars
export default function NotificationPreferences({ userId, onClose, portal = "owner" }) {
  const t = useT();
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
      pref_promotions:             prefs.pref_promotions,
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
    <Modal title={t("settings.notif.title")} onClose={onClose}>
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <div className="w-5 h-5 border-2 border-[#16255A] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="px-4 pb-6 space-y-0">

          {/* ── Channels ── */}
          <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider pt-4 pb-1">{t("settings.notif.channels")}</p>
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700 px-4">
            <PrefRow
              label={t("settings.notif.inApp")}
              sub={t("settings.notif.inAppSub")}
              on={true}
              onChange={() => {}}
              locked
            />
            <PrefRow
              label={t("settings.notif.push")}
              sub={t("settings.notif.pushSub")}
              on={prefs.push_enabled}
              onChange={update("push_enabled")}
            />
            {portal === "owner" && (
              <PrefRow
                label={t("settings.notif.email")}
                sub={t("settings.notif.emailSub")}
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
                  <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">{t("settings.notif.androidPerm")}</p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{t("settings.notif.androidPermSub")}</p>
                </div>
                {pushStatus ? <StatusPill status={pushStatus} /> : (
                  <span className="text-[11px] text-slate-400">{t("settings.notif.status.checking")}</span>
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
                    ? t("settings.notif.android.waiting")
                    : pushStatus === "denied"
                      ? t("settings.notif.android.openSettings")
                      : t("settings.notif.android.enable")}
                </button>
              )}

              {/* Result messages */}
              {enableResult === "ok" && (
                <InfoMsg type="success">{t("settings.notif.android.ok")}</InfoMsg>
              )}
              {enableResult === "denied" && (
                <InfoMsg type="warn">
                  {t("settings.notif.android.denied")}
                </InfoMsg>
              )}
              {enableResult === "timeout" && (
                <InfoMsg type="warn">
                  {t("settings.notif.android.timeout")}
                </InfoMsg>
              )}
              {enableResult === "error" && (
                <InfoMsg type="error">{t("settings.notif.android.error")}</InfoMsg>
              )}

            </div>
          )}

          {/* ── Browser push (web only) ── */}
          {!isNative() && webPushConfigured() && webPushSupported() && (
            <div className="mt-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 px-4 py-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">{t("settings.notif.web.title")}</p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{t("settings.notif.web.sub")}</p>
                </div>
                <StatusPill status={webStatus === "default" ? "prompt" : webStatus} />
              </div>

              {webStatus !== "granted" && webStatus !== "denied" && (
                <button
                  onClick={handleEnableWeb}
                  disabled={webEnabling}
                  className="w-full py-2.5 rounded-xl text-[13px] font-bold text-white bg-[#16255A] active:opacity-80 transition-opacity disabled:opacity-60"
                >
                  {webEnabling ? t("settings.notif.web.waiting") : t("settings.notif.web.enable")}
                </button>
              )}

              {webStatus === "denied" && (
                <InfoMsg type="warn">
                  {t("settings.notif.web.blocked")}
                </InfoMsg>
              )}
              {webResult === "ok" && (
                <InfoMsg type="success">{t("settings.notif.web.ok")}</InfoMsg>
              )}
              {webResult === "dismissed" && (
                <InfoMsg type="warn">{t("settings.notif.web.dismissed")}</InfoMsg>
              )}
              {webResult === "error" && (
                <InfoMsg type="error">{t("settings.notif.web.error")}</InfoMsg>
              )}
            </div>
          )}
          <TestNotificationCard
            native={!!isNative()}
            enabled={isNative() ? pushStatus === "granted" : (webPushConfigured() && webStatus === "granted")}
          />
          {!isNative() && webPushConfigured() && needsIosInstall() && (
            <div className="mt-3 px-1">
              <InfoMsg type="info">
                {t("settings.notif.iosInstall")}
              </InfoMsg>
            </div>
          )}

          {/* ── Categories ── */}
          <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider pt-5 pb-1">{t("settings.notif.categories")}</p>
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700 px-4">
            {[...(PORTAL_CATEGORIES[portal] ?? PORTAL_CATEGORIES.owner), PROMO_ROW].map(cat => (
              <PrefRow
                key={cat.field}
                label={t(cat.lkey)}
                sub={t(cat.skey)}
                on={prefs[cat.field] ?? true}
                onChange={update(cat.field)}
              />
            ))}
          </div>

          {/* ── Thresholds (owner only) ── */}
          {portal === "owner" && (
            <>
              <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider pt-5 pb-1">{t("settings.notif.thresholds")}</p>
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700 px-4">
                <div className="py-3.5">
                  <p className="text-[14px] font-semibold text-slate-800 dark:text-slate-100">{t("settings.notif.largeTxn")}</p>
                  <p className="text-[12px] text-slate-400 dark:text-slate-500 mt-0.5 mb-2">
                    {t("settings.notif.largeTxnSub")}
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
            {saved ? t("settings.notif.saved") : saving ? t("common.saving") : t("settings.notif.savePrefs")}
          </button>
        </div>
      )}
    </Modal>
  );
}
