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

      {/* Sub-tab bar */}
      <div className="sticky top-0 z-20 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
        <div className="flex">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 py-3.5 text-[13px] font-bold tracking-wide transition-colors relative ${
                tab === t.id
                  ? "text-brand-600 dark:text-brand-400"
                  : "text-slate-400 dark:text-slate-500"
              }`}
            >
              {t.label}
              {tab === t.id && (
                <span className="absolute bottom-0 left-1/4 right-1/4 h-[2.5px] bg-brand-600 dark:bg-brand-400 rounded-full" />
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
