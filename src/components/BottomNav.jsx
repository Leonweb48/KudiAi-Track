import Icon from "./Icon";

const NAV_ITEMS = [
  { id: "home",         icon: "home",     label: "Home"         },
  { id: "transactions", icon: "txn",      label: "Transactions" },
  { id: "credit",       icon: "credit",   label: "Credit"       },
  { id: "aso",          icon: "aso",      label: "Aso"          },
  { id: "insights",     icon: "insights", label: "Insights"     },
  { id: "settings",     icon: "settings", label: "Settings"     },
];

export default function BottomNav({ active, onNavigate }) {
  return (
    <nav
      className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md z-40 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 shadow-float"
      role="navigation" aria-label="Main navigation"
    >
      <div className="flex items-stretch h-[60px]">
        {NAV_ITEMS.map((n) => {
          const isActive = active === n.id;
          return (
            <button
              key={n.id}
              onClick={() => onNavigate(n.id)}
              aria-label={n.label}
              aria-current={isActive ? "page" : undefined}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 relative transition-colors duration-150 focus-visible:outline-none"
            >
              {/* Active indicator dot at top */}
              {isActive && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-5 h-0.5 rounded-full bg-brand-600 dark:bg-brand-400" />
              )}

              {/* Icon */}
              <div className={`transition-all duration-200 ${isActive ? "scale-110" : "scale-100"}`}>
                <Icon
                  name={n.icon}
                  size={21}
                  className={isActive
                    ? "text-brand-600 dark:text-brand-400"
                    : "text-slate-400 dark:text-slate-500"}
                />
              </div>

              {/* Label */}
              <span className={`text-[9px] font-bold uppercase tracking-wide leading-none transition-colors duration-150 ${
                isActive
                  ? "text-brand-600 dark:text-brand-400"
                  : "text-slate-400 dark:text-slate-500"
              }`}>
                {n.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Safe area spacer for iOS home indicator */}
      <div className="h-safe-bottom bg-white dark:bg-slate-900" style={{ height: "env(safe-area-inset-bottom, 0px)" }} />
    </nav>
  );
}
