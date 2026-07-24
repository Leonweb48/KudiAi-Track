import { useState, useEffect } from "react";
import { canDo, planAvailableText } from "../../utils/plans";
import Credit   from "../Credit";
import Aso      from "../Aso";
import Invoices from "../Invoices";

function PermBlock({ msg, hint }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
      <p className="text-base font-bold text-slate-600 dark:text-slate-400">{msg}</p>
      <p className="text-sm text-slate-400">{hint}</p>
    </div>
  );
}

export default function ManagerRecords({ store, staff, livePerms, initialSub, plan, invoiceHook, inventory, ownerId }) {
  const ajoOnPlan = canDo(plan, "aso");
  const invOnPlan = canDo(plan, "invoices");
  const allowed   = livePerms.filter(p => p.can_view).map(p => p.module);
  const ajoAllowed = ajoOnPlan && allowed.includes("aso");

  const tabs = [
    ["credit",   "Credit",   true],
    ["ajo",      "Ajo",      ajoAllowed],
    ["invoices", "Invoices", invOnPlan],
  ].filter(([,, show]) => show);

  const [sub, setSub] = useState(initialSub || "credit");
  useEffect(() => { if (initialSub) setSub(initialSub); }, [initialSub]);

  return (
    <div className="h-full flex flex-col">
      {/* Pill sub-tabs — matches staff pattern */}
      <div className="flex-shrink-0 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 px-4 pt-3 pb-3">
        <div className="bg-slate-100 dark:bg-slate-800 rounded-2xl p-1 flex gap-1">
          {tabs.map(([v, l]) => (
            <button key={v} onClick={() => setSub(v)}
              className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                sub === v
                  ? "bg-white dark:bg-slate-700 shadow-sm text-brand-600 dark:text-white"
                  : "text-slate-500 dark:text-slate-400"
              }`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {sub === "credit" && (
          allowed.includes("credit")
            ? <div className="h-full overflow-y-auto pb-4"><Credit store={store} plan={plan} /></div>
            : <PermBlock msg="Credit not enabled" hint="Contact the business owner to enable the credit module." />
        )}

        {sub === "ajo" && !ajoAllowed && (
          ajoOnPlan
            ? <PermBlock msg="Ajo access not enabled" hint="Contact the business owner to enable Ajo for your account." />
            : <PermBlock msg="Plan upgrade required" hint={`Ajo / Savings is ${planAvailableText("aso")} Ask the business owner to upgrade.`} />
        )}
        {sub === "ajo" && ajoAllowed && (
          <div className="h-full overflow-y-auto pb-4">
            <Aso store={store} plan={plan} staffId={staff?.id} />
          </div>
        )}

        {sub === "invoices" && !invOnPlan && (
          <PermBlock msg="Plan upgrade required" hint={`Invoices are ${planAvailableText("invoices")} Ask the business owner to upgrade.`} />
        )}
        {sub === "invoices" && invOnPlan && invoiceHook && (
          <div className="h-full overflow-y-auto pb-4">
            <Invoices invoiceHook={invoiceHook} plan={plan} onUpgrade={null}
              profile={store.profile} inventory={inventory}
              addTransaction={store.addTransaction} userId={ownerId}
            />
          </div>
        )}
      </div>
    </div>
  );
}
