import { canDo, planAvailableText } from "../../utils/plans";
import Inventory from "../Inventory";

/* ═══════════════════════════════════════════════════════════════════
   STOCK TAB
═══════════════════════════════════════════════════════════════════ */
export default function StaffStock({ inventory, staff, livePerms, plan }) {
  const planAllows = canDo(plan, "inventory");
  const allowed    = livePerms.filter(p => p.can_view).map(p => p.module);
  const canView    = planAllows && allowed.includes("inventory");
  const canAdd     = planAllows && (livePerms.find(p => p.module === "inventory")?.can_create || false);

  if (!planAllows) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-8 text-center">
        <p className="text-base font-bold text-slate-600 dark:text-slate-400">Plan upgrade required</p>
        <p className="text-sm text-slate-400">Inventory management is {planAvailableText("inventory")} Ask the business owner to upgrade.</p>
      </div>
    );
  }
  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-8 text-center">
        <p className="text-base font-bold text-slate-600 dark:text-slate-400">Stock access not enabled</p>
        <p className="text-sm text-slate-400">Your manager hasn't enabled inventory for your account.</p>
      </div>
    );
  }
  return (
    <div className="h-full overflow-hidden">
      <Inventory inventory={inventory} isOwner={false} canAdd={canAdd} plan={plan || "starter"} staffBranchId={staff?.branch_id || null} />
    </div>
  );
}
