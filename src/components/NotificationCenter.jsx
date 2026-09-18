/**
 * NotificationCenter — bell icon + notification drawer.
 *
 * Mobile: right-anchored full-height panel, 85vw, slides in on the X axis.
 * Desktop (md:): a 380px dropdown anchored near the bell, fades in/out.
 *
 * Props:
 *   userId       string   auth user id
 *   onNavigate   fn(deepLink)  portal-specific navigation handler
 *   toast        fn       optional useToast() override — NotificationCenter
 *                         obtains its own via useToast() internally (it's a
 *                         genuine descendant of a ToastProvider everywhere
 *                         it's mounted — either the root one in index.js or,
 *                         for the owner portal, App.jsx's own nested one),
 *                         so most callers don't need to pass this at all.
 *
 * Deep-link shape: { tab, sub?, id? } — some producers also send
 * { openWallet: true } for portals whose wallet isn't a routed tab.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useNotifications } from "../hooks/useNotifications";
import { categoryMeta } from "../lib/notificationCategories";
import { useToast } from "./Toast";

// Types that represent something the owner still needs to act on — get an
// "Approve" chip instead of the default "View". Deliberately conservative:
// only types that are unambiguously always a pending request (not also used
// for an already-resolved outcome elsewhere).
const APPROVE_TYPES = new Set([
  "withdrawal_request", "manual_deposit", "reactivation_request",
  "assigned_client_deposit",
]);

function NotifIcon({ category }) {
  const meta = categoryMeta(category);
  return (
    <div className="relative w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: meta.hex + "20" }}>
      <svg viewBox="0 0 24 24" fill="none" stroke={meta.hex} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
        <path d={meta.icon} />
      </svg>
      {meta.sparkle && (
        <svg viewBox="0 0 24 24" fill={meta.hex} className="absolute -top-0.5 -right-0.5 w-3 h-3">
          <path d="M12 0l1.8 6.2L20 8l-6.2 1.8L12 16l-1.8-6.2L4 8l6.2-1.8z" />
        </svg>
      )}
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

function absTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// ── Date section label — Today / Yesterday / This Week / Earlier ───────────────
function dayBucket(iso) {
  const d = new Date(iso);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.floor((startOfToday - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays > 1 && diffDays <= 7) return "This Week";
  return "Earlier";
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
        <span className="absolute top-1 right-1 min-w-[16px] h-4 rounded-full bg-brand-500 flex items-center justify-center text-white text-[9px] font-extrabold leading-none px-0.5 ring-2 ring-white dark:ring-slate-900">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </button>
  );
}

// ── Notification row — swipe left to dismiss, swipe right to mark read ─────────
const SWIPE_THRESHOLD = 64;

function NotifRow({ notif, onTap, onDismiss, onMarkRead }) {
  const [dragX, setDragX]   = useState(0);
  const [dragging, setDragging] = useState(false);
  const startRef = useRef(null);

  const onTouchStart = (e) => {
    startRef.current = e.touches[0].clientX;
    setDragging(true);
  };
  const onTouchMove = (e) => {
    if (startRef.current == null) return;
    setDragX(e.touches[0].clientX - startRef.current);
  };
  const onTouchEnd = () => {
    setDragging(false);
    if (dragX <= -SWIPE_THRESHOLD) {
      onDismiss(notif.id);
    } else if (dragX >= SWIPE_THRESHOLD && !notif.read_at) {
      onMarkRead(notif.id);
    }
    startRef.current = null;
    setDragX(0);
  };

  const meta = categoryMeta(notif.category);
  const showApprove = APPROVE_TYPES.has(notif.type);
  const showChip = !!notif.deep_link;

  return (
    <div className="relative overflow-hidden">
      {/* Swipe affordance backgrounds */}
      <div className="absolute inset-0 flex items-center justify-between px-5 pointer-events-none">
        <span className="text-[11px] font-bold text-brand-600">Mark read</span>
        <span className="text-[11px] font-bold text-red-500">Dismiss</span>
      </div>
      <button
        onClick={() => { if (!dragging && Math.abs(dragX) < 4) onTap(notif); }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className={`relative w-full flex items-start gap-3 pl-3 pr-4 py-3.5 text-left bg-white dark:bg-slate-900 active:bg-slate-50 dark:active:bg-slate-800/50 ${!notif.read_at ? "bg-brand-50/40 dark:bg-brand-900/10" : ""}`}
        style={{
          transform: `translateX(${dragX}px)`,
          transition: dragging ? "none" : "transform 0.2s ease-out",
        }}
      >
        <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-[18px] ${!notif.read_at ? "bg-brand-500" : "bg-transparent"}`} />
        <NotifIcon category={notif.category} />
        <div className="flex-1 min-w-0">
          <p className={`text-[13.5px] leading-snug ${!notif.read_at ? "font-semibold text-slate-800 dark:text-slate-100" : "font-medium text-slate-700 dark:text-slate-300"}`}>
            {notif.title}
          </p>
          {notif.body && (
            <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug line-clamp-2">
              {notif.body}
            </p>
          )}
          <div className="flex items-center gap-2 mt-1.5">
            <p className="text-[11px] text-slate-400 dark:text-slate-500">{relTime(notif.created_at)} · {absTime(notif.created_at)}</p>
            {showChip && (
              <span
                className="text-[10.5px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                style={{ background: meta.hex + "18", color: meta.hex }}
              >
                {showApprove ? "Approve" : "View"}
              </span>
            )}
          </div>
        </div>
      </button>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="text-5xl mb-3">🎉</div>
      <p className="text-[15px] font-semibold text-slate-700 dark:text-slate-300 mb-1">You're all caught up</p>
      <p className="text-[13px] text-slate-400 dark:text-slate-500">
        Notifications for sales, savings, stock, and more will appear here.
      </p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function NotificationCenter({ userId, onNavigate, toast: toastProp }) {
  const [open, setOpen] = useState(false);
  const sheetRef        = useRef(null);
  const openRef         = useRef(open);
  useEffect(() => { openRef.current = open; }, [open]);

  const internalToast = useToast();
  const toast = toastProp ?? internalToast;

  const { notifications, unreadCount, loading, hasMore, loadMore, markRead, markAllRead, dismiss } = useNotifications(userId, (n) => {
    // Called only for realtime INSERT — never for page loads. No prevCount race.
    if (toast && !n.read_at && n.priority === "high" && !openRef.current) {
      toast({ title: n.title, body: n.body, type: "info", deepLink: n.deep_link });
    }
  });

  // Close on outside tap
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

  // ── Group by Today / Yesterday / This Week / Earlier ────────────────────────
  const grouped = [];
  let lastBucket = null;
  for (const n of notifications) {
    const bucket = dayBucket(n.created_at);
    if (bucket !== lastBucket) { grouped.push({ kind: "header", bucket }); lastBucket = bucket; }
    grouped.push({ kind: "notif", notif: n });
  }

  return (
    <>
      <BellButton unreadCount={unreadCount} onClick={() => setOpen(v => !v)} />

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-drawer bg-black/20 dark:bg-black/40 transition-opacity duration-200"
          style={{ backdropFilter: "blur(1px)" }}
          onClick={() => setOpen(false)}
        />
      )}

      {/* Panel: right slide-in on mobile, anchored dropdown on desktop */}
      <div
        ref={sheetRef}
        aria-hidden={!open}
        className={[
          "fixed z-drawer bg-white dark:bg-slate-900 shadow-2xl flex flex-col",
          "inset-y-0 right-0 w-[85vw] max-w-[360px]",
          "transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "translate-x-full",
          "md:inset-y-auto md:top-16 md:bottom-auto md:right-4 md:left-auto",
          "md:w-[380px] md:max-h-[600px] md:rounded-2xl md:overflow-hidden",
          "md:translate-x-0 md:transition-opacity md:duration-200 md:ease-out",
          open ? "md:opacity-100 md:pointer-events-auto" : "md:opacity-0 md:pointer-events-none md:invisible",
        ].join(" ")}
      >
        {/* Drag handle — mobile only, decorative native-feel cue */}
        <div className="md:hidden flex-none flex justify-center pt-2.5 pb-1">
          <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700" />
        </div>

        {/* Header */}
        <div className="flex-none flex items-center justify-between px-4 py-3.5 border-b border-slate-100 dark:border-slate-800">
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
            item.kind === "header"
              ? <div key={`hd-${i}`} className="px-4 py-2 bg-slate-50 dark:bg-slate-800/50">
                  <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">{item.bucket}</p>
                </div>
              : <NotifRow key={item.notif.id} notif={item.notif} onTap={handleTap} onDismiss={dismiss} onMarkRead={markRead} />,
          )}
          {hasMore && (
            <button onClick={loadMore} disabled={loading}
              className="w-full py-3 text-[13px] font-semibold text-brand-600 dark:text-brand-400 active:opacity-60 transition-opacity">
              {loading ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
