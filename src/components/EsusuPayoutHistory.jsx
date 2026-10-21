import { useEffect, useState } from "react";
import { supabase } from "../utils/supabase";
import { fmt, fmtDate } from "../utils/helpers";
import TransactionDetailModal from "./shared/TransactionDetailModal";
import { buildEsusuPayoutReceipt } from "../utils/receiptConfig";
import { useT, tNow } from "../contexts/LanguageContext";

// Owner / staff: every round of one esusu group with its payouts (ajo-portal get-esusu-history), newest first. Each payout
// opens the shareable receipt (image / PDF / share, verifiable at kudiai.app/verify). `openPayoutId` opens that payout's
// receipt as soon as the history has loaded — used straight after Pay Out.
export default function EsusuPayoutHistory({ groupId, groupName, businessName, biz, openPayoutId = null, onOpened }) {
  const t = useT();
  const [rounds,  setRounds]  = useState(null);
  const [error,   setError]   = useState("");
  const [receipt, setReceipt] = useState(null);   // { payout, roundNumber }

  // Load once per group. (`t` must NOT be a dependency: useT returns a new function on every render, which made this
  // refetch after every load and throw the result away — the history never appeared.)
  useEffect(() => {
    let live = true;
    setRounds(null); setError("");
    supabase.functions.invoke("ajo-portal", { body: { action: "get-esusu-history", group_id: groupId } })
      .then(({ data, error: e }) => {
        if (!live) return;
        if (e || data?.error) { setError(tNow("ajo.rot.historyLoadFailed")); return; }
        setRounds(data?.rounds || []);
      })
      .catch(() => { if (live) setError(tNow("ajo.rot.historyLoadFailed")); });
    return () => { live = false; };
  }, [groupId]);

  useEffect(() => {
    if (!openPayoutId || !rounds) return;
    for (const r of rounds) {
      const p = r.payouts.find(x => x.id === openPayoutId);
      if (p) { setReceipt({ payout: p, roundNumber: r.round_number }); break; }
    }
    onOpened?.();
  }, [openPayoutId, rounds]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <p className="text-sm text-red-500 text-center py-8">{error}</p>;
  if (!rounds) {
    return (
      <div className="space-y-3 py-2" aria-busy="true">
        {[0, 1, 2].map(i => <div key={i} className="h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 animate-pulse" />)}
      </div>
    );
  }
  const withPayouts = rounds.filter(r => r.payouts.length > 0);
  if (!withPayouts.length) {
    return (
      <div className="flex flex-col items-center py-10 gap-2 text-center px-4">
        <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">{t("ajo.rot.noPayoutsYet")}</p>
        <p className="text-xs text-slate-400">{t("ajo.rot.noPayoutsYetBody")}</p>
      </div>
    );
  }

  const statusLabel = (s) => s === "active" ? t("ajo.rot.roundInProgress") : s === "completed" ? t("ajo.rot.roundCompleted") : t("ajo.rot.roundClosedShort");

  return (
    <div className="space-y-4">
      {withPayouts.map(r => (
        <div key={r.id} className="rounded-2xl border border-slate-100 dark:border-slate-700 overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60">
            <div className="min-w-0">
              <p className="text-[13px] font-extrabold text-slate-800 dark:text-white">{t("ajo.rot.roundN", { n: r.round_number })}</p>
              <p className="text-[10px] text-slate-400">
                {statusLabel(r.status)} · {fmtDate(r.started_at)}{r.ended_at ? ` – ${fmtDate(r.ended_at)}` : ""}
              </p>
            </div>
            <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300 tabular-nums whitespace-nowrap">{t("ajo.rot.paidOutTotal", { amount: fmt(r.total_paid) })}</p>
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {r.payouts.map(p => (
              <li key={p.id}>
                <button onClick={() => setReceipt({ payout: p, roundNumber: r.round_number })}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40 active:scale-[0.99] transition">
                  <span className="w-8 h-8 rounded-full bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-300 flex items-center justify-center text-[11px] font-extrabold flex-shrink-0">
                    {p.position}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-bold text-slate-800 dark:text-white truncate">{p.client_name || "—"}</span>
                    <span className="block text-[10px] text-slate-400">{fmtDate(p.created_at)}{p.receipt_ref ? ` · ${p.receipt_ref}` : ""}</span>
                  </span>
                  <span className="text-right flex-shrink-0">
                    <span className="block text-sm font-extrabold text-green-600 dark:text-green-400 tabular-nums">{fmt(p.amount)}</span>
                    <span className="block text-[10px] font-semibold text-brand-500">{t("ajo.rot.receipt")} ›</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {receipt && (
        <TransactionDetailModal
          data={buildEsusuPayoutReceipt(receipt.payout, { groupName, roundNumber: receipt.roundNumber, businessName, biz })}
          onClose={() => setReceipt(null)}
        />
      )}
    </div>
  );
}
