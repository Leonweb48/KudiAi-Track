import Icon from "./Icon";
import { useT } from "../contexts/LanguageContext";

const NAV_IDS = [
  { id: "home",         icon: "home",      tkey: "nav.home"  },
  { id: "transactions", icon: "txn",       tkey: "nav.sales" },
  { id: "bills",        icon: "bills",     tkey: "nav.bills" },
  { id: "inventory",    icon: "inventory", tkey: "nav.stock" },
  { id: "more",         icon: "settings",  tkey: "nav.more"  },
];

export default function BottomNav({ active, onNavigate }) {
  const t = useT();
  return (
    <nav
      className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md z-40 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 shadow-float will-change-transform"
      role="navigation" aria-label="Main navigation"
    >
      <div className="flex items-stretch h-[64px] px-1">
        {NAV_IDS.map((n) => {
          const isActive = active === n.id;
          const label = t(n.tkey);
          return (
            <button
              key={n.id}
              onClick={() => onNavigate(n.id)}
              aria-label={label}
              aria-current={isActive ? "page" : undefined}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 relative transition-colors duration-150 focus-visible:outline-none py-1.5"
            >
              {/* Active pill background */}
              {isActive && (
                <span className="absolute inset-x-0.5 top-1.5 bottom-1.5 rounded-2xl bg-brand-50 dark:bg-brand-900/20 transition-all duration-200" />
              )}

              {/* Icon */}
              <div className={`relative z-10 transition-all duration-200 ${isActive ? "scale-110" : "scale-100"}`}>
                <Icon
                  name={n.icon}
                  size={22}
                  className={isActive
                    ? "text-brand-600 dark:text-brand-400"
                    : "text-slate-400 dark:text-slate-500"}
                />
              </div>

              {/* Label */}
              <span className={`relative z-10 text-[9px] font-bold uppercase tracking-wide leading-none transition-colors duration-150 ${
                isActive
                  ? "text-brand-600 dark:text-brand-400"
                  : "text-slate-400 dark:text-slate-500"
              }`}>
                {label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Safe area spacer for iOS home indicator */}
      <div className="bg-white dark:bg-slate-900" style={{ height: "env(safe-area-inset-bottom, 0px)" }} />
    </nav>
  );
}
