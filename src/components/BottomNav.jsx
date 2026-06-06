import Icon from "./Icon";

const NAV_ITEMS = [
  { id: "home",         icon: "home",     label: "Home"     },
  { id: "transactions", icon: "txn",      label: "Sales"    },
  { id: "credit",       icon: "credit",   label: "Credit"   },
  { id: "aso",          icon: "aso",      label: "Aso"      },
  { id: "insights",     icon: "insights", label: "AI"       },
  { id: "settings",     icon: "settings", label: "Settings" },
];

export default function BottomNav({ active, onNavigate }) {
  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-white border-t border-gray-100 shadow-2xl z-40">
      <div className="flex">
        {NAV_ITEMS.map((n) => {
          const isActive = active === n.id;
          return (
            <button
              key={n.id}
              onClick={() => onNavigate(n.id)}
              className={`flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 transition-colors ${
                isActive ? "text-green-600" : "text-gray-400"
              }`}
            >
              <div className={`transition-transform ${isActive ? "scale-110" : "scale-100"}`}>
                <Icon name={n.icon} size={isActive ? 22 : 20} />
              </div>
              <span
                className={`text-[9px] font-extrabold uppercase tracking-wide ${
                  isActive ? "text-green-600" : "text-gray-400"
                }`}
              >
                {n.label}
              </span>
              {isActive && (
                <div className="w-1 h-1 rounded-full bg-green-600 mt-0.5" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
