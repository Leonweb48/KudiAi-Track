/**
 * NotificationCenter — bell icon + slide-up sheet.
 *
 * Props:
 *   userId       string   auth user id
 *   onNavigate   fn(deepLink)  portal-specific navigation handler
 *   toast        fn       useToast() result (for high-pri toast on new notif)
 *
 * Deep-link shape: { tab, sub?, id? }
 *
 * Unread badge count is derived from the notifications table (COUNT read_at IS NULL),
 * not a parallel counter — consistent with the spec.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useNotifications } from "../hooks/useNotifications";

// ── Type → icon SVG path ──────────────────────────────────────────────────────
const TYPE_ICON = {
  staff_collection:      { d: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z", c: "#f59e0b" },
  withdrawal_request:    { d: "M12 5v14M5 12l7-7 7 7",                                                                           c: "#3b82f6" },
  manual_deposit:        { d: "M12 5v14M5 12l7 7 7-7",                                                                           c: "#10b981" },
  contribution_approved: { d: "M20 6L9 17l-5-5",                                                                                 c: "#10b981" },
  contribution_rejected: { d: "M18 6L6 18M6 6l12 12",                                                                            c: "#ef4444" },
  payout_received:       { d: "M12 2v6l3 3M21 12a9 9 0 11-18 0 9 9 0 0118 0z",                                                  c: "#10b981" },
  capital_transition:    { d: "M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z", c: "#f59e0b" },
  low_stock:             { d: "M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z",                                                   c: "#f59e0b" },
  credit_overdue:        { d: "M12 2a10 10 0 110 20A10 10 0 0112 2zM12 8v4M12 16h.01",                                          c: "#ef4444" },
  staff_invite:          { d: "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z",                        c: "#6366f1" },
  permission_change:     { d: "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4", c: "#8b5cf6" },
  held_24h:              { d: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",                                                    c: "#ef4444" },
  // Ajo-write event types
  collection_approved:   { d: "M20 6L9 17l-5-5",                                                                                 c: "#10b981" },
  collection_rejected:   { d: "M18 6L6 18M6 6l12 12",                                                                            c: "#ef4444" },
  deposit_confirmed:     { d: "M12 5v14M5 12l7 7 7-7",                                                                           c: "#10b981" },
  deposit_rejected:      { d: "M18 6L6 18M6 6l12 12",                                                                            c: "#ef4444" },
  withdrawal_approved:   { d: "M12 5v14M5 12l7-7 7 7",                                                                           c: "#3b82f6" },
  withdrawal_rejected:   { d: "M18 6L6 18M6 6l12 12",                                                                            c: "#ef4444" },
  group_funds_released:  { d: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z", c: "#10b981" },
  manual_deposit_confirmed: { d: "M12 5v14M5 12l7 7 7-7",                                                                        c: "#10b981" },
  manual_deposit_rejected:  { d: "M18 6L6 18M6 6l12 12",                                                                         c: "#ef4444" },
  commission_processed:  { d: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z", c: "#f59e0b" },
  shift_changed:         { d: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",                                              c: "#6366f1" },
};

function NotifIcon({ type }) {
  const cfg = TYPE_ICON[type] ?? { d: "M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z", c: "#64748b" };
  return (
    <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: cfg.c + "20" }}>
      <svg viewBox="0 0 24 24" fill="none" stroke={cfg.c} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4.5 h-4.5" style={{ width: 18, height: 18 }}>
        <path d={cfg.d} />
      </svg>
    </div>
  );
}

// ── Relative time ─────────────────────────────────────────────────────────────
function relTime(iso) {
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (diff < 60)   return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ── Date section label ────────────────────────────────────────────────────────
function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

// ── Bell button ───────────────────────────────────────────────────────────────
export function BellButton({ unreadCount, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-label={unreadCount ? `${unreadCount} unread notifications` : "Notifications"}
      className="relative w-9 h-9 flex items-center justify-center rounded-full active:scale-90 transition-transform focus-visible:outline-none"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5.5 h-5.5 text-slate-600 dark:text-slate-300" style={{ width: 22, height: 22 }}>
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" />
      </svg>
      {unreadCount > 0 && (
        <span className="absolute top-1 right-1 min-w-[16px] h-4 rounded-full bg-red-500 flex items-center justify-center text-white text-[9px] font-extrabold leading-none px-0.5 ring-2 ring-white dark:ring-slate-900">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </button>
  );
}

// ── Notification row ──────────────────────────────────────────────────────────
function NotifRow({ notif, onTap }) {
  return (
    <button
      onClick={() => onTap(notif)}
      className={`w-full flex items-start gap-3 px-4 py-3.5 text-left active:bg-slate-50 dark:active:bg-slate-800/50 transition-colors relative ${!notif.read_at ? "bg-brand-50/40 dark:bg-brand-900/10" : ""}`}
    >
      <NotifIcon type={notif.type} />
      <div className="flex-1 min-w-0">
        <p className={`text-[13.5px] leading-snug ${!notif.read_at ? "font-semibold text-slate-800 dark:text-slate-100" : "font-medium text-slate-700 dark:text-slate-300"}`}>
          {notif.title}
        </p>
        {notif.body && (
          <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug line-clamp-2">
            {notif.body}
          </p>
        )}
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">{relTime(notif.created_at)}</p>
      </div>
      {!notif.read_at && (
        <span className="w-2 h-2 rounded-full bg-brand-500 flex-shrink-0 mt-1.5" />
      )}
    </button>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7 text-slate-400 dark:text-slate-500">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" />
        </svg>
      </div>
      <p className="text-[15px] font-semibold text-slate-700 dark:text-slate-300 mb-1">All caught up</p>
      <p className="text-[13px] text-slate-400 dark:text-slate-500">
        Notifications for collections, withdrawals, alerts, and more will appear here.
      </p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function NotificationCenter({ userId, onNavigate, toast }) {
  const [open, setOpen] = useState(false);
  const sheetRef        = useRef(null);
  const openRef         = useRef(open);
  useEffect(() => { openRef.current = open; }, [open]);

  const { notifications, unreadCount, loading, hasMore, loadMore, markRead, markAllRead } = useNotifications(userId, (n) => {
    // Called only for realtime INSERT — never for page loads. No prevCount race.
    if (toast && !n.read_at && n.priority === "high" && !openRef.current) {
      toast({ title: n.title, body: n.body, type: "info", deepLink: n.deep_link });
    }
  });

  // Close sheet on outside tap
  useEffect(() => {
    if (!open) return;
    const handle = (e) => {
      if (sheetRef.current && !sheetRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    document.addEventListener("touchstart", handle);
    return () => { document.removeEventListener("mousedown", handle); document.removeEventListener("touchstart", handle); };
  }, [open]);

  const handleTap = useCallback(async (notif) => {
    if (!notif.read_at) await markRead(notif.id);
    setOpen(false);
    if (notif.deep_link) onNavigate?.(notif.deep_link);
  }, [markRead, onNavigate]);

  // ── Group by day ─────────────────────────────────────────────────────────────
  const grouped = [];
  let lastDay = null;
  for (const n of notifications) {
    const day = dayLabel(n.created_at);
    if (day !== lastDay) { grouped.push({ type: "header", day }); lastDay = day; }
    grouped.push({ type: "notif", notif: n });
  }

  return (
    <>
      <BellButton unreadCount={unreadCount} onClick={() => setOpen(v => !v)} />

      {/* Overlay */}
      {open && (
        <div className="fixed inset-0 z-[350] bg-black/20 dark:bg-black/40" style={{ backdropFilter: "blur(1px)" }} />
      )}

      {/* Sheet */}
      <div
        ref={sheetRef}
        className="fixed inset-x-0 z-[360] max-w-md mx-auto"
        style={{
          top: "max(8px, env(safe-area-inset-top, 8px))",
          transform: open ? "translateY(0)" : "translateY(-110%)",
          transition: "transform 0.3s cubic-bezier(0.34,1.56,0.64,1)",
          maxHeight: "calc(100dvh - 80px)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col mx-3"
          style={{ maxHeight: "calc(100dvh - 100px)" }}>

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-bold text-slate-800 dark:text-slate-100">Notifications</h2>
              {unreadCount > 0 && (
                <span className="text-[11px] font-bold text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/30 px-1.5 py-0.5 rounded-full">
                  {unreadCount} new
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button onClick={markAllRead}
                  className="text-[12px] font-semibold text-brand-600 dark:text-brand-400 active:opacity-60 transition-opacity">
                  Mark all read
                </button>
              )}
              <button onClick={() => setOpen(false)} aria-label="Close"
                className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 active:opacity-60 transition-opacity">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* List */}
          <div className="overflow-y-auto overscroll-contain flex-1 divide-y divide-slate-100 dark:divide-slate-800">
            {loading && notifications.length === 0 && (
              <div className="flex items-center justify-center py-10">
                <div className="w-5 h-5 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {!loading && notifications.length === 0 && <EmptyState />}
            {grouped.map((item, i) =>
              item.type === "header"
                ? <div key={`hd-${i}`} className="px-4 py-2 bg-slate-50 dark:bg-slate-800/50">
                    <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">{item.day}</p>
                  </div>
                : <NotifRow key={item.notif.id} notif={item.notif} onTap={handleTap} />,
            )}
            {hasMore && (
              <button onClick={loadMore} disabled={loading}
                className="w-full py-3 text-[13px] font-semibold text-brand-600 dark:text-brand-400 active:opacity-60 transition-opacity">
                {loading ? "Loading…" : "Load more"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Progress animation for toast bar */}
      <style>{`
        @keyframes kt-toast-shrink {
          from { width: 100%; }
          to   { width: 0%; }
        }
      `}</style>
    </>
  );
}
