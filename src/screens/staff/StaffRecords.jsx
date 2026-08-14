import { useState, useEffect } from "react";
import { canDo, planAvailableText } from "../../utils/plans";
import Credit from "../Credit";
import Aso from "../Aso";
import Invoices from "../Invoices";

/* ═══════════════════════════════════════════════════════════════════
   RECORDS TAB
═══════════════════════════════════════════════════════════════════ */
export default function StaffRecords({ store, staff, livePerms, initialSub, plan, invoiceHook, inventory, ownerId }) {
  const ajoOnPlan = canDo(plan, "aso");
  const invOnPlan = canDo(plan, "invoices");
  const [sub, setSub] = useState(initialSub || "credit");
  useEffect(() => { if (initialSub) setSub(initialSub); }, [initialSub]);
  const allowed = livePerms.filter(p => p.can_view).map(p => p.module);

  // PERM-3: ajo tab requires both plan access and aso.can_view permission
  const ajoAllowed = ajoOnPlan && allowed.includes("aso");

  const tabs = [
    ["credit",   "Credit",   true],
    ["ajo",      "Ajo",      ajoAllowed],
    ["invoices", "Invoices", invOnPlan],
  ].filter(([,, show]) => show);

  return (
    <div className="h-full flex flex-col">

      {/* Pill sub-tabs */}
      <div className="flex-shrink-0 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 px-4 pt-3 pb-3">
        <div className="bg-slate-100 dark:bg-slate-800 rounded-2xl p-1 flex gap-1">
          {tabs.map(([v, l]) => (
            <button key={v} onClick={() => setSub(v)}
              className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                sub === v
                  ? "bg-white dark:bg-slate-700 shadow-sm text-emerald-600 dark:text-white"
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
            ? <div className="h-full overflow-y-auto pb-4"><Credit store={store} plan={plan} inventory={inventory} /></div>
            : <PermBlock msg="Credit not enabled" hint="Contact your manager to enable the credit module." />
        )}
        {sub === "ajo" && !ajoOnPlan && (
          <PermBlock msg="Plan upgrade required" hint={`Ajo / Savings management is ${planAvailableText("aso")} Ask the business owner to upgrade.`} />
        )}
        {sub === "ajo" && ajoOnPlan && !allowed.includes("aso") && (
          <PermBlock msg="Ajo access not enabled" hint="Contact your manager to enable Ajo access for your account." />
        )}
        {sub === "ajo" && ajoOnPlan && allowed.includes("aso") && (
          <div className="h-full overflow-y-auto pb-4"><Aso store={store} plan={plan} staffId={staff?.id} /></div>
        )}
        {sub === "invoices" && !allowed.includes("invoices") && (
          <PermBlock msg="Invoices not enabled" hint="Contact your manager to enable invoice access for your account." />
        )}
        {sub === "invoices" && allowed.includes("invoices") && (
          <div className="h-full overflow-y-auto pb-4">
            <Invoices
              invoiceHook={invoiceHook}
              plan={plan}
              onUpgrade={null}
              profile={{
                email:             store.profile?.email,
                business_name:     store.profile?.business_name,
                profile_image_url: store.profile?.profile_image_url,
                store_image_url:   store.profile?.store_image_url,
              }}
              inventory={inventory}
              addTransaction={store.addTransaction}
              userId={ownerId}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function PermBlock({ msg, hint }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
      <p className="text-base font-bold text-slate-600 dark:text-slate-400">{msg}</p>
      <p className="text-sm text-slate-400">{hint}</p>
    </div>
  );
}
