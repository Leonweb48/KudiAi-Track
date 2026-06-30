import { useState, useEffect } from "react";
import Credit   from "./Credit";
import Aso      from "./Aso";
import CoopList from "./CoopList";
import Invoices from "./Invoices";

const TABS = [
  { id: "credit",   label: "Credit" },
  { id: "ajo",      label: "Ajo" },
  { id: "invoices", label: "Invoices" },
  { id: "org",      label: "Organisation" },
];

export default function Finance({
  store, plan, onUpgrade,
  autoOpenTab, onAutoOpened,
  userId, session,
  onSelectCoopOrg,
  inventory,
  invoiceHook,
}) {
  const [tab, setTab] = useState(autoOpenTab || "credit");

  useEffect(() => {
    if (autoOpenTab) setTab(autoOpenTab);
  }, [autoOpenTab]);

  return (
    <div className="flex flex-col min-h-full">

      {/* Sub-tab bar — X/Twitter style */}
      <div className="sticky top-0 z-20 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
        <div className="flex overflow-x-auto scrollbar-none">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative flex-1 min-w-[80px] px-4 py-3.5 text-[14px] font-semibold whitespace-nowrap transition-colors
                hover:bg-slate-100 dark:hover:bg-slate-800/60
                ${tab === t.id
                  ? "text-slate-900 dark:text-white"
                  : "text-slate-500 dark:text-slate-400"
                }`}
            >
              {t.label}
              {tab === t.id && (
                <span className="absolute bottom-0 left-0 right-0 h-[3px] bg-brand-600 dark:bg-brand-400" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {tab === "credit" && (
        <Credit
          store={store}
          plan={plan}
          autoOpen={autoOpenTab === "credit"}
          onAutoOpened={onAutoOpened}
          onUpgrade={onUpgrade}
          embedded
        />
      )}
      {tab === "ajo" && (
        <Aso
          store={store}
          plan={plan}
          autoOpen={autoOpenTab === "ajo"}
          onAutoOpened={onAutoOpened}
          onUpgrade={onUpgrade}
          embedded
        />
      )}
      {tab === "invoices" && (
        <Invoices
          invoiceHook={invoiceHook}
          plan={plan}
          onUpgrade={onUpgrade}
          profile={store.profile}
          inventory={inventory}
        />
      )}
      {tab === "org" && (
        <CoopList
          userId={userId}
          onOpen={onSelectCoopOrg}
          onClose={null}
          embedded
        />
      )}

    </div>
  );
}
