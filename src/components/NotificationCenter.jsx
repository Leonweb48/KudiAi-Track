import { useState, useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

/* ── helpers ─────────────────────────────────────────────────────── */
function timeAgo(ts) {
  if (!ts) return "";
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/* ── type config ─────────────────────────────────────────────────── */
const TYPE = {
  sales:    { label: "Sales",          dot: "bg-green-500",  ring: "bg-green-100 dark:bg-green-900/30",   text: "text-green-600 dark:text-green-400"   },
  credits:  { label: "Credits",        dot: "bg-amber-500",  ring: "bg-amber-100 dark:bg-amber-900/30",   text: "text-amber-600 dark:text-amber-400"   },
  payments: { label: "Payments",       dot: "bg-blue-500",   ring: "bg-blue-100 dark:bg-blue-900/30",     text: "text-blue-600 dark:text-blue-400"     },
  stock:    { label: "Stock",          dot: "bg-orange-500", ring: "bg-orange-100 dark:bg-orange-900/30", text: "text-orange-600 dark:text-orange-400" },
  bills:    { label: "Bills",          dot: "bg-red-500",    ring: "bg-red-100 dark:bg-red-900/30",       text: "text-red-600 dark:text-red-400"       },
  aso:      { label: "Ajo",            dot: "bg-violet-500", ring: "bg-violet-100 dark:bg-violet-900/30", text: "text-violet-600 dark:text-violet-400" },
  system:   { label: "System",         dot: "bg-slate-400",  ring: "bg-slate-100 dark:bg-slate-700",      text: "text-slate-500 dark:text-slate-400"   },
};

function getType(t) { return TYPE[t] || TYPE.system; }

/* ── Type icon ───────────────────────────────────────────────────── */
function TypeIcon({ type }) {
  const paths = {
    sales:    "M12 19V5|M5 12l7-7 7 7",
    credits:  "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2|M9 11a4 4 0 100-8 4 4 0 000 8",
    payments: "M20 6L9 17l-5-5",
    stock:    "M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z",
    bills:    "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2|M9 5a2 2 0 002 2h2a2 2 0 002-2|M9 5a2 2 0 012-2h2a2 2 0 012 2|M9 13h6|M9 17h4",
    aso:      "M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z|M9 22V12h6v10",
    system:   "M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9|M13.73 21a2 2 0 01-3.46 0",
  };
  const d = paths[type] || paths.system;
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {d.split("|").map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}

/* ── Toggle ──────────────────────────────────────────────────────── */
function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      role="switch" aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      className={`w-11 h-6 rounded-full relative transition-colors duration-200 flex-shrink-0 ${
        checked ? "bg-green-500" : "bg-slate-200 dark:bg-slate-600"
      } ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}>
      <span className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all duration-200"
        style={{ left: checked ? "calc(100% - 22px)" : "2px" }} />
    </button>
  );
}

/* ── Settings Panel ──────────────────────────────────────────────── */
function SettingsView({ settings, updateSetting, requestPush, speak, onBack, allowedTypeKeys }) {
  const [pushStatus,  setPushStatus]  = useState(null);
  const [systemPerm,  setSystemPerm]  = useState(null); // null = still checking

  // Check actual OS permission state on mount so the toggle reflects reality immediately
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    LocalNotifications.checkPermissions()
      .then(r => setSystemPerm(r.display))
      .catch(() => setSystemPerm("prompt"));
  }, []);

  const handlePushToggle = async (val) => {
    if (!val) { updateSetting("push", false); return; }
    const result = await requestPush();
    if (result === "denied")           { setPushStatus("denied"); setSystemPerm("denied"); }
    else if (result === "unsupported") setPushStatus("unsupported");
    else                               { setPushStatus(null); setSystemPerm("granted"); }
  };

  const pushSupported = Capacitor.isNativePlatform() || "Notification" in window;
  // On native, use the real OS state; on web, use the browser Notification API
  const pushDenied = Capacitor.isNativePlatform()
    ? systemPerm === "denied"
    : pushSupported && Notification.permission === "denied";

  const ALL_TYPE_SETTINGS = [
    { key: "sales",    label: "Sales & Expenses",  icon: "💰", desc: "Every recorded sale and expense" },
    { key: "credits",  label: "Credit Alerts",     icon: "👥", desc: "New credits and overdue alerts"  },
    { key: "payments", label: "Payments Received", icon: "✅", desc: "When a debtor makes a payment"   },
    { key: "stock",    label: "Stock Alerts",      icon: "📦", desc: "Low stock and inventory changes" },
    { key: "bills",    label: "Bill Payments",     icon: "🧾", desc: "Utility and bill payments"       },
    { key: "aso",      label: "Ajo Reminders",     icon: "🏦", desc: "Contributions and missed payments"},
    { key: "system",   label: "System Alerts",     icon: "🔔", desc: "App-level alerts and summaries"  },
  ];
  const TYPE_SETTINGS = allowedTypeKeys
    ? ALL_TYPE_SETTINGS.filter(t => allowedTypeKeys.includes(t.key))
    : ALL_TYPE_SETTINGS;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 px-4 pt-12 pb-3 flex items-center gap-3 flex-shrink-0">
        <button onClick={onBack}
          className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center active:scale-95 transition-transform">
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>
        <h2 className="text-lg font-bold text-slate-800 dark:text-white">Notification Settings</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5">

        {/* Delivery methods */}
        <div>
          <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3">Delivery Methods</p>

          {/* Push */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 overflow-hidden mb-3">
            <div className="flex items-center justify-between px-4 py-3.5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth={2} strokeLinecap="round">
                    <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-white">Push Notifications</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    {!pushSupported ? "Not supported on this device"
                      : pushDenied ? "Blocked — go to Settings → Apps → KudiAI Track → Notifications"
                      : systemPerm === null && Capacitor.isNativePlatform() ? "Checking permission…"
                      : "Alerts even when the app is in the background"}
                  </p>
                </div>
              </div>
              <Toggle
                checked={settings.push && !pushDenied}
                onChange={handlePushToggle}
                disabled={!pushSupported || pushDenied}
              />
            </div>
            {(pushDenied || pushStatus === "denied") && (
              <p className="text-xs text-red-500 px-4 pb-3">
                Notifications are blocked. Open your phone&apos;s{" "}
                <strong>Settings → Apps → KudiAI Track → Notifications</strong>{" "}
                and turn them on, then come back here.
              </p>
            )}
          </div>

          {/* Voice */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700">
            <div className="flex items-center justify-between px-4 py-3.5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth={2} strokeLinecap="round">
                    <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                    <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-white">Voice Notifications</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">Speaks alert text aloud</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {settings.voice && (
                  <button onClick={() => speak("Voice notifications are on. Test successful.")}
                    className="text-xs font-bold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-2.5 py-1 rounded-lg active:scale-95 transition-transform">
                    Test
                  </button>
                )}
                <Toggle checked={settings.voice} onChange={val => updateSetting("voice", val)} />
              </div>
            </div>
          </div>
        </div>

        {/* Per-type toggles */}
        <div>
          <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3">Notify Me For</p>
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 divide-y divide-slate-50 dark:divide-slate-700/60">
            {TYPE_SETTINGS.map(({ key, label, icon, desc }) => (
              <div key={key} className="flex items-center justify-between px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <span className="text-xl leading-none">{icon}</span>
                  <div>
                    <p className="text-sm font-semibold text-slate-800 dark:text-white">{label}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500">{desc}</p>
                  </div>
                </div>
                <Toggle checked={settings[key] !== false} onChange={val => updateSetting(key, val)} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Notification item ───────────────────────────────────────────── */
function NotifItem({ n, onRead }) {
  const cfg = getType(n.type);
  return (
    <button onClick={() => !n.read && onRead(n.id)}
      className={`w-full text-left flex items-start gap-3 px-4 py-3.5 border-b border-slate-50 dark:border-slate-700/60 transition-colors ${
        n.read ? "bg-white dark:bg-slate-800" : "bg-green-50/60 dark:bg-green-900/10"
      } active:bg-slate-50 dark:active:bg-slate-700/40`}>
      <div className={`w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center ${cfg.ring} ${cfg.text}`}>
        <TypeIcon type={n.type} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-bold truncate ${n.read ? "text-slate-600 dark:text-slate-300" : "text-slate-800 dark:text-white"}`}>
          {n.title}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2 leading-relaxed">{n.message}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${cfg.ring} ${cfg.text}`}>
            {getType(n.type).label}
          </span>
          <span className="text-[10px] text-slate-400 dark:text-slate-500">{timeAgo(n.ts)}</span>
        </div>
      </div>
      {!n.read && (
        <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0 mt-1.5" />
      )}
    </button>
  );
}

/* ── Notification list view ──────────────────────────────────────── */
function NotifList({ notifications, unreadCount, markRead, markAllRead, clearAll, onSettings, allowedTypeKeys }) {
  const [activeFilter, setActiveFilter] = useState("all");

  const filtered = activeFilter === "unread"
    ? notifications.filter(n => !n.read)
    : activeFilter === "all"
    ? notifications
    : notifications.filter(n => n.type === activeFilter);

  const ALL_FILTERS = [
    { key: "all",      label: "All" },
    { key: "unread",   label: `Unread${unreadCount > 0 ? ` (${unreadCount})` : ""}` },
    { key: "sales",    label: "Sales"    },
    { key: "credits",  label: "Credits"  },
    { key: "payments", label: "Payments" },
    { key: "bills",    label: "Bills"    },
    { key: "aso",      label: "Ajo"      },
  ];
  const FILTERS = allowedTypeKeys
    ? ALL_FILTERS.filter(f => ["all", "unread"].includes(f.key) || allowedTypeKeys.includes(f.key))
    : ALL_FILTERS;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 px-4 pt-12 pb-2 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-black text-slate-800 dark:text-white tracking-tight">Notifications</h2>
          <div className="flex items-center gap-1.5">
            {unreadCount > 0 && (
              <button onClick={markAllRead}
                className="text-xs font-bold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-3 py-1.5 rounded-lg active:scale-95 transition-transform">
                Mark all read
              </button>
            )}
            {notifications.length > 0 && (
              <button onClick={clearAll}
                className="text-xs font-bold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg active:scale-95 transition-transform">
                Clear
              </button>
            )}
            <button onClick={onSettings}
              className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center active:scale-95 transition-transform">
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Filter chips */}
        <div className="flex gap-1.5 overflow-x-auto pb-2 no-scrollbar">
          {FILTERS.map(({ key, label }) => (
            <button key={key} onClick={() => setActiveFilter(key)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition-all active:scale-95 ${
                activeFilter === key
                  ? "bg-slate-800 dark:bg-white text-white dark:text-slate-900 shadow-sm"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full pb-20 px-6 text-center">
            <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-4">
              <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth={1.5} strokeLinecap="round" className="text-slate-400 dark:text-slate-500">
                <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" />
              </svg>
            </div>
            <p className="text-slate-500 dark:text-slate-400 text-sm font-semibold">
              {activeFilter === "unread" ? "All caught up!" : "No notifications yet"}
            </p>
            <p className="text-slate-400 dark:text-slate-500 text-xs mt-1">
              {activeFilter === "unread" ? "You've read everything" : "Activity will appear here"}
            </p>
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-800">
            {filtered.map(n => (
              <NotifItem key={n.id} n={n} onRead={markRead} />
            ))}
            <div className="h-20" />
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Bell button (exported for use in headers) ───────────────────── */
export function NotificationBell({ unreadCount = 0, onClick }) {
  return (
    <button onClick={onClick} aria-label="Notifications"
      className="relative w-9 h-9 rounded-full flex items-center justify-center bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 active:scale-95 transition-transform">
      <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth={2} strokeLinecap="round" className="text-slate-600 dark:text-slate-300">
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 01-3.46 0" />
      </svg>
      {unreadCount > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-red-500 rounded-full flex items-center justify-center text-[9px] font-black text-white px-1 leading-none shadow-sm">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </button>
  );
}

/* ── Main panel (full-screen overlay, rendered in App.jsx) ───────── */
export default function NotificationCenter({ notif, allowedTypeKeys }) {
  const {
    notifications, settings, unreadCount,
    open, setOpen, showSettings, setShowSettings,
    markRead, markAllRead, clearAll,
    updateSetting, requestPush, speak,
  } = notif;

  if (!open) return null;

  return (
    <>
      {/* Backdrop (only visible on wide screens beside the max-w-md panel) */}
      <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setOpen(false)} />

      {/* Panel */}
      <div className="fixed inset-0 z-50 flex justify-center pointer-events-none">
        <div className="w-full max-w-md h-full bg-slate-50 dark:bg-slate-900 flex flex-col pointer-events-auto shadow-2xl">

          {/* Close button (absolute positioned top-right) */}
          <button onClick={() => { setOpen(false); setShowSettings(false); }}
            className="absolute top-3.5 right-4 z-10 w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center active:scale-95 transition-transform">
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          {showSettings ? (
            <SettingsView
              settings={settings}
              updateSetting={updateSetting}
              requestPush={requestPush}
              speak={speak}
              onBack={() => setShowSettings(false)}
              allowedTypeKeys={allowedTypeKeys}
            />
          ) : (
            <NotifList
              notifications={notifications}
              unreadCount={unreadCount}
              markRead={markRead}
              markAllRead={markAllRead}
              clearAll={clearAll}
              onSettings={() => setShowSettings(true)}
              allowedTypeKeys={allowedTypeKeys}
            />
          )}
        </div>
      </div>
    </>
  );
}
