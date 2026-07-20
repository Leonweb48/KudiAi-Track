/**
 * Toast — single branded toast implementation for the entire platform.
 * Replaces all 4 hand-rolled toast implementations found in the census.
 *
 * Usage:
 *   1. Wrap your tree with <ToastProvider>
 *   2. const toast = useToast();
 *   3. toast({ title, body, type, deepLink, duration })
 *
 * Props on show():
 *   title    string   required
 *   body     string   optional
 *   type     "info" | "success" | "error" | "warning"   default "info"
 *   deepLink object   optional { tab, sub, id } — makes the toast tappable
 *   duration number   ms, default 4000
 */

import { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";

const ToastCtx = createContext(null);

// ── Type config ───────────────────────────────────────────────────────────────
const TYPES = {
  success: { bg: "bg-[#16255A]", bar: "bg-brand-400", icon: "M20 6L9 17l-5-5" },
  error:   { bg: "bg-red-600",   bar: "bg-red-300",   icon: "M18 6L6 18|M6 6l12 12" },
  warning: { bg: "bg-amber-600", bar: "bg-amber-300",  icon: "M12 9v4|M12 17h.01|M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" },
  info:    { bg: "bg-[#16255A]", bar: "bg-brand-400",  icon: "M12 16v-4|M12 8h.01|M12 2a10 10 0 110 20A10 10 0 0112 2z" },
};

// ── Single toast tile ────────────────────────────────────────────────────────
function ToastTile({ id, title, body, type = "info", deepLink, duration = 4000, onDismiss, onTap }) {
  const cfg      = TYPES[type] ?? TYPES.info;
  const startY   = useRef(null);
  const [dy, setDy] = useState(0);
  const [out, setOut] = useState(false);

  const dismiss = useCallback(() => {
    setOut(true);
    setTimeout(onDismiss, 300);
  }, [onDismiss]);

  // Auto-dismiss
  useEffect(() => {
    const t = setTimeout(dismiss, duration);
    return () => clearTimeout(t);
  }, [duration, dismiss]);

  // Swipe-up to dismiss
  const onTouchStart = (e) => { startY.current = e.touches[0].clientY; };
  const onTouchMove  = (e) => {
    if (startY.current == null) return;
    const d = e.touches[0].clientY - startY.current;
    if (d < 0) setDy(d);
  };
  const onTouchEnd = () => {
    if (dy < -40) { dismiss(); } else { setDy(0); }
    startY.current = null;
  };

  const iconParts = cfg.icon.split("|");

  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        transform: `translateY(${out ? "-120px" : dy + "px"})`,
        opacity: out ? 0 : 1,
        transition: out ? "transform 0.3s ease, opacity 0.3s ease" : dy ? "none" : "transform 0.3s cubic-bezier(0.34,1.56,0.64,1)",
        willChange: "transform, opacity",
      }}
      className={`${cfg.bg} text-white rounded-2xl shadow-xl overflow-hidden mx-3 select-none`}
      onClick={deepLink ? () => { dismiss(); onTap?.(deepLink); } : undefined}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div className="flex items-start gap-3 px-4 py-3.5">
        {/* Icon */}
        <div className="flex-shrink-0 mt-0.5">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 opacity-90">
            {iconParts.map((d, i) => <path key={i} d={d} />)}
          </svg>
        </div>
        {/* Text */}
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-bold leading-snug truncate">{title}</p>
          {body && <p className="text-[12px] opacity-80 leading-snug mt-0.5 line-clamp-2">{body}</p>}
        </div>
        {/* Dismiss × */}
        <button
          onClick={(e) => { e.stopPropagation(); dismiss(); }}
          className="flex-shrink-0 -mr-1 opacity-60 hover:opacity-100 active:opacity-80 transition-opacity p-0.5"
          aria-label="Dismiss"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      {/* Progress bar */}
      <div className={`h-0.5 ${cfg.bar} opacity-40`}
        style={{ animation: `kt-toast-shrink ${duration}ms linear forwards` }} />
    </div>
  );
}

// ── Provider ──────────────────────────────────────────────────────────────────
export function ToastProvider({ children, onDeepLink }) {
  const [queue, setQueue] = useState([]);

  const show = useCallback(({ title, body, type = "info", deepLink = null, duration = 4000 }) => {
    const id = Date.now() + Math.random();
    setQueue(q => [...q, { id, title, body, type, deepLink, duration }]);
  }, []);

  const dismiss = useCallback((id) => setQueue(q => q.filter(t => t.id !== id)), []);

  const current = queue[0] ?? null;

  return (
    <ToastCtx.Provider value={show}>
      {children}
      {current && (
        <div
          className="fixed left-0 right-0 z-[400] flex justify-center"
          style={{ top: "max(16px, env(safe-area-inset-top, 16px))", pointerEvents: "none" }}
        >
          <div className="w-full max-w-md" style={{ pointerEvents: "auto" }}>
            <ToastTile
              key={current.id}
              {...current}
              onDismiss={() => dismiss(current.id)}
              onTap={onDeepLink}
            />
          </div>
        </div>
      )}
    </ToastCtx.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be within ToastProvider");
  return ctx;
}
