import { useState, useEffect } from "react";
import { fmt }                  from "../../utils/helpers";
import { applyPeriodFilter }    from "../../utils/helpers";
import PeriodFilter             from "../../components/shared/PeriodFilter";
import TransactionDetailModal   from "../../components/shared/TransactionDetailModal";
import { buildTransactionReceipt } from "../../utils/receiptConfig";
import BillPayments             from "../BillPayments";
import { Svg, P, TxRow }       from "./ManagerShared";

export default function ManagerSales({ store, staff, session, livePerms, initialSub, initialData, onVoiceOpen, inventory, onAddCash, plan }) {
  const [sub,        setSub]       = useState(initialSub || "cash");
  const [receipt,    setReceipt]   = useState(initialData);
  const [search,     setSearch]    = useState("");
  const [period,     setPeriod]    = useState("all");
  const [dateFrom,   setDateFrom]  = useState("");
  const [dateTo,     setDateTo]    = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const { transactions = [], loading } = store;
  const allowed = livePerms.filter(p => p.can_view).map(p => p.module);

  useEffect(() => { if (initialSub)  setSub(initialSub); },    [initialSub]);
  useEffect(() => { if (initialData) setReceipt(initialData); }, [initialData]);
  useEffect(() => { setTypeFilter("all"); }, [sub]);

  const filtered = applyPeriodFilter(
    transactions.filter(tx =>
      !search || [tx.item_name, tx.customer_name, tx.category].some(v => (v || "").toLowerCase().includes(search.toLowerCase()))
    ),
    period, dateFrom, dateTo, tx => tx.transaction_date
  );
  const cashOnly = filtered.filter(tx => tx.payment_type !== "bill_payment");
  const cashIn   = cashOnly.filter(tx => tx.type === "in").reduce((s, tx) => s + tx.amount, 0);
  const cashOut  = cashOnly.filter(tx => tx.type === "out").reduce((s, tx) => s + tx.amount, 0);

  const allHistory = (() => {
    if (typeFilter === "in")    return filtered.filter(tx => tx.type === "in"  && tx.payment_type !== "bill_payment");
    if (typeFilter === "out")   return filtered.filter(tx => tx.type === "out" && tx.payment_type !== "bill_payment");
    if (typeFilter === "bills") return filtered.filter(tx => tx.payment_type === "bill_payment");
    return filtered;
  })();

  const activeList = sub === "cash" ? cashOnly : allHistory;

  return (
    <div className="h-full flex flex-col">
      {/* Sub-tab bar */}
      <div className="flex-shrink-0 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 px-4 pt-3 pb-0">
        <div className="flex gap-1">
          {[["cash","Cash Sales"],["bills","Bill Payments"],["all","All History"]].map(([v, l]) => (
            <button key={v} onClick={() => setSub(v)}
              className={`px-4 py-2.5 text-[12px] font-bold transition-all border-b-2 ${sub === v ? "border-brand-600 text-brand-600 dark:text-brand-400 dark:border-brand-400" : "border-transparent text-slate-400 dark:text-slate-500"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Bills */}
      {sub === "bills" && (
        <div className="flex-1 overflow-hidden">
          {!allowed.includes("bills")
            ? <PermBlock msg="Bills not enabled" hint="Contact the business owner to enable bill payments." />
            : <div className="h-full overflow-y-auto pb-4">
                <BillPayments store={store} plan={plan} markup={1.098} pointsEnabled
                  staffName={staff?.full_name}
                  staffEmail={session?.user?.email || staff?.email || ""}
                  businessName={staff?.business_name || store.profile?.business_name}
                />
              </div>
          }
        </div>
      )}

      {/* Cash / All History */}
      {sub !== "bills" && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-shrink-0 px-4 py-3 space-y-2 bg-slate-50 dark:bg-slate-900/50">
            <div className="relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                <Svg d={P.search} size={16} color="#94a3b8" />
              </div>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search sales…"
                className="w-full h-10 pl-9 pr-4 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
            </div>
            <div className="flex gap-2">
              <button onClick={onVoiceOpen}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-green-500 text-white">
                <Svg d={P.mic} size={12} color="white" />
                Mic Sale
              </button>
            </div>
            <PeriodFilter period={period} setPeriod={setPeriod} dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} />
            {sub === "all" && (
              <div className="flex gap-2 overflow-x-auto no-scrollbar">
                {[["all","All"],["in","Cash In"],["out","Cash Out"],["bills","Bills"]].map(([v, l]) => (
                  <button key={v} onClick={() => setTypeFilter(v)}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-[11px] font-bold transition ${typeFilter === v ? "bg-slate-700 dark:bg-slate-200 text-white dark:text-slate-900" : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400"}`}>
                    {l}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => onAddCash("in")}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-green-600 text-white text-xs font-bold active:scale-[0.97] transition">
                <Svg d="M12 5v14|M5 12h14" size={14} color="white" sw={2.5} />
                Cash In
              </button>
              <button onClick={() => onAddCash("out")}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-red-500 text-white text-xs font-bold active:scale-[0.97] transition">
                <Svg d="M5 12h14" size={14} color="white" sw={2.5} />
                Cash Out
              </button>
            </div>
          </div>
          {/* Summary bar */}
          <div className="flex-shrink-0 grid grid-cols-3 gap-px bg-slate-100 dark:bg-slate-700/50 border-y border-slate-100 dark:border-slate-700/50">
            {[["Cash In", fmt(cashIn), "text-green-600"],["Cash Out", fmt(cashOut), "text-red-500"],["Count", activeList.length + " txns", "text-slate-700 dark:text-slate-200"]].map(([l, v, c]) => (
              <div key={l} className="bg-white dark:bg-slate-800 px-3 py-2.5 text-center">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{l}</p>
                <p className={`text-sm font-extrabold tabular mt-0.5 ${c}`}>{v}</p>
              </div>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 pb-4">
            {loading
              ? [1,2,3,4].map(i => <div key={i} className="h-[72px] bg-slate-100 dark:bg-slate-700/60 rounded-2xl animate-pulse" />)
              : activeList.length === 0
                ? (
                  <div className="flex flex-col items-center gap-2 py-12 text-center">
                    <Svg d={P.in} size={28} color="#cbd5e1" />
                    <p className="text-sm font-semibold text-slate-400">No transactions found</p>
                  </div>
                )
                : activeList.map((tx, i) => <TxRow key={tx.id || i} t={tx} onClick={() => setReceipt(tx)} />)
            }
          </div>
        </div>
      )}

      {receipt && (
        <TransactionDetailModal
          data={buildTransactionReceipt(receipt, store.profile || { business_name: staff?.business_name })}
          onClose={() => setReceipt(null)}
        />
      )}
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
