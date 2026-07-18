import { useRef, useEffect } from "react";
import Icon from "../Icon";

export default function Modal({ title, onClose, children, id = "modal-panel" }) {
  const panelRef = useRef(null);

  // Focus the first focusable element once on open — runs only on mount so typing
  // in an input never re-triggers focus and closes the mobile keyboard.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = Array.from(
      panel.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    ).filter(el => !el.disabled);
    focusable[0]?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard trap — re-registers when onClose changes but never steals focus.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const handleKey = (e) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab") return;
      const focusable = Array.from(
        panel.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter(el => !el.disabled);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last  = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        id={id}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-2xl shadow-2xl max-h-[92dvh] overflow-y-auto"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700 sticky top-0 bg-white dark:bg-slate-800 z-10">
          <span id="modal-title" className="font-bold text-slate-800 dark:text-white text-base">{title}</span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-11 h-11 flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 transition"
          >
            <Icon name="x" size={18} className="text-slate-500 dark:text-slate-400" />
          </button>
        </div>
        <div className="px-5 py-4" style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}>{children}</div>
      </div>
    </div>
  );
}
