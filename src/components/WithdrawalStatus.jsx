import { withdrawalStage, expectedDay } from "../utils/withdrawalStage";
import { fmt } from "../utils/helpers";

// Card on the client's Home for an APPROVED withdrawal that is still on its way to their KudiAI Wallet.
export function ProcessingWithdrawalCard({ request }) {
  const st = withdrawalStage(request);
  if (!st) return null;
  return (
    <div className="bg-sky-50 dark:bg-sky-900/20 rounded-xl px-3 py-3 border border-sky-200 dark:border-sky-800/60 flex items-center gap-3">
      <div className="w-8 h-8 bg-sky-100 dark:bg-sky-900/40 rounded-xl flex items-center justify-center flex-shrink-0">
        <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-sky-500" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-sky-700 dark:text-sky-300">{st.label}</p>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">{st.detail}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-xs font-extrabold text-sky-700 dark:text-sky-300">
          {request.payout_amount_kobo != null ? fmt(request.payout_amount_kobo / 100) : fmt(request.amount)}
        </p>
      </div>
    </div>
  );
}

// One line above the wallet's transactions: what is pending and when it should land.
export function PendingPayoutNotice({ payouts = [] }) {
  if (!payouts.length) return null;
  const total = payouts.reduce((s, p) => s + Number(p.amount_kobo || 0), 0) / 100;
  const day = payouts[0]?.scheduled_date ? expectedDay(payouts[0].scheduled_date) : "";
  return (
    <p className="text-[11px] font-semibold text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-900/20 rounded-xl px-3 py-2 mb-1">
      {fmt(total)} from your approved withdrawal is pending{day ? ` — expected ${day}` : " — arriving on the next business day"}. It will show in your balance once it lands.
    </p>
  );
}

// The pending payouts as wallet transaction rows are built by the caller from these (a credit that has not landed yet).
export const pendingPayoutRow = (p) => ({
  id: `payout-${p.id}`, source: "ajo_payout", direction: "credit", status: "pending", amount_kobo: p.amount_kobo, created_at: p.created_at,
});
