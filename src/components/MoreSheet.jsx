import { useEffect } from "react";
import Icon from "./Icon";
import { useT } from "../contexts/LanguageContext";

const ITEMS = [
  { id: "finance",  icon: "finance",  tkey: "nav.finance"    },
  { id: "insights", icon: "insights", tkey: "nav.reports"    },
  { id: "settings", icon: "settings", tkey: "settings.title" },
];

function ChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      className="text-slate-300 dark:text-slate-600">
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

export default function MoreSheet({ open, onClose, onNavigate }) {
  const t = useT();

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const go = (id) => { onClose(); onNavigate(id); };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="More options"
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md z-50 bg-white dark:bg-slate-900 rounded-t-3xl shadow-2xl border-t border-slate-100 dark:border-slate-800 px-4 pt-3 pb-[calc(84px+env(safe-area-inset-bottom,0px))]"
      >
        {/* Drag handle */}
        <div className="w-10 h-1 rounded-full bg-slate-200 dark:bg-slate-700 mx-auto mb-4" />

        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-3 px-1">More</p>

        <div className="space-y-1">
          {ITEMS.map(item => (
            <button
              key={item.id}
              onClick={() => go(item.id)}
              className="w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800 active:bg-slate-100 dark:active:bg-slate-700 transition-colors text-left"
            >
              <div className="w-10 h-10 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center flex-shrink-0">
                <Icon name={item.icon} size={20} className="text-slate-600 dark:text-slate-300" />
              </div>
              <span className="text-[15px] font-semibold text-slate-800 dark:text-slate-100 flex-1">
                {t(item.tkey)}
              </span>
              <ChevronRight />
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
