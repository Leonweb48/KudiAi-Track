import { useState, useEffect } from "react";
import { fmt, applyPeriodFilter } from "../../utils/helpers";
import PeriodFilter from "../../components/shared/PeriodFilter";
import { supabase } from "../../utils/supabase";
import { Svg, P, GK, NK, TxRow } from "./StaffShared";
import TransactionDetailModal from "../../components/shared/TransactionDetailModal";
import { buildTransactionReceipt } from "../../utils/receiptConfig";
import BillPayments from "../BillPayments";

/* ═══════════════════════════════════════════════════════════════════
   SALES TAB
═══════════════════════════════════════════════════════════════════ */
export default function StaffSales({ store, staff, session, livePerms, initialSub, initialData, onVoiceOpen, inventory, onAddCash, plan }) {
  const [sub,          setSub]          = useState(initialSub || "cash");
  const [receipt,      setReceipt]      = useState(initialData);
  const [search,       setSearch]       = useState("");
  const [period,       setPeriod]       = useState("all");
  const [typeFilter,   setTypeFilter]   = useState("all");
  const [dateFrom,     setDateFrom]     = useState("");
  const [dateTo,       setDateTo]       = useState("");
  const [showApprReq,  setShowApprReq]  = useState(false);
  const [apprForm,     setApprForm]     = useState({ type: "refund", amount: "", reason: "" });
  const [apprSaving,   setApprSaving]   = useState(false);
  const [apprMsg,      setApprMsg]      = useState("");
  const { transactions = [], loading } = store;
  const allowed      = livePerms.filter(p => p.can_view).map(p => p.module);
  const canRefund    = livePerms.find(p => p.module === "refunds")?.can_create || false;
  const canDiscount  = livePerms.find(p => p.module === "discounts")?.can_create || false;
  const canCreate    = livePerms.find(p => p.module === "transactions")?.can_create || false;

  const submitApproval = async () => {
    const staffId = staff?.id;
    const ownerId = staff?.owner_id;
    if (!staffId || !ownerId || !apprForm.amount) return;
    setApprSaving(true); setApprMsg("");
    const { error } = await supabase.from("approval_requests").insert({
      owner_id: ownerId,
      staff_id: staffId,
      type:     apprForm.type,
      amount:   Number(apprForm.amount),
      reason:   apprForm.reason || null,
    });
    if (error) {
      setApprMsg("Failed: " + error.message);
    } else {
      setApprMsg("Approval request sent to manager!");
      setTimeout(() => { setShowApprReq(false); setApprMsg(""); setApprForm({ type: "refund", amount: "", reason: "" }); }, 1800);
    }
    setApprSaving(false);
  };

  useEffect(() => { if (initialSub)  setSub(initialSub);       }, [initialSub]);
  useEffect(() => { if (initialData) setReceipt(initialData);  }, [initialData]);
  useEffect(() => { setTypeFilter("all"); },                      [sub]);

  const filtered = applyPeriodFilter(
    transactions.filter(tx =>
      !search || [tx.item_name, tx.customer_name, tx.category].some(v => (v || "").toLowerCase().includes(search.toLowerCase()))
    ),
    period, dateFrom, dateTo, tx => tx.transaction_date
  );
  const cashOnly = filtered.filter(tx => tx.payment_type !== "bill_payment");

  const allHistory = (() => {
    if (typeFilter === "in")    return filtered.filter(tx => tx.type === "in"  && tx.payment_type !== "bill_payment");
    if (typeFilter === "out")   return filtered.filter(tx => tx.type === "out" && tx.payment_type !== "bill_payment");
    if (typeFilter === "bills") return filtered.filter(tx => tx.payment_type === "bill_payment");
    return filtered;
  })();

  const displaySet = sub === "cash" ? cashOnly : allHistory;
  const totalIn    = displaySet.filter(tx => tx.type === "in"  && tx.payment_type !== "bill_payment").reduce((s, tx) => s + tx.amount, 0);
  const totalOut   = displaySet.filter(tx => tx.type === "out" && tx.payment_type !== "bill_payment").reduce((s, tx) => s + tx.amount, 0);

  return (
    <div className="h-full flex flex-col">

      {/* Pill sub-tabs */}
      <div className="flex-shrink-0 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 px-4 pt-3 pb-3">
        <div className="bg-slate-100 dark:bg-slate-800 rounded-2xl p-1 flex gap-1">
          {[["cash","Cash Sales"],["bills","Bill Payments"],["all","All History"]].map(([v, l]) => (
            <button key={v} onClick={() => setSub(v)}
              className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${
                sub === v
                  ? "bg-white dark:bg-slate-700 shadow-sm text-emerald-600 dark:text-white"
                  : "text-slate-500 dark:text-slate-400"
              }`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Bills */}
      {sub === "bills" && (
        <div className="flex-1 overflow-hidden">
          {!allowed.includes("bills")
            ? <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
                <p className="text-base font-bold text-slate-600 dark:text-slate-400">Bills not enabled</p>
                <p className="text-sm text-slate-400">Contact your manager to enable bill payments.</p>
              </div>
            : <div className="h-full overflow-y-auto pb-4">
                <BillPayments
                  store={store}
                  plan={plan}
                  markup={1.098}
                  pointsEnabled
                  staffName={staff?.full_name}
                  staffEmail={session?.user?.email || staff?.email || ""}
                  businessName={staff?.business_name || store.profile?.business_name}
                />
              </div>
          }
        </div>
      )}

      {/* Cash / All */}
      {sub !== "bills" && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Filters */}
          <div className="flex-shrink-0 px-4 py-3 space-y-2 bg-slate-50 dark:bg-slate-900/50">
            <div className="relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                <Svg d={P.search} size={16} color="#94a3b8" />
              </div>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search sales…"
                className="w-full h-10 pl-9 pr-4 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
            </div>

            {/* Period + type filters */}
            <div className="flex gap-2 overflow-x-auto no-scrollbar mb-0.5">
              <button onClick={onVoiceOpen}
                className="flex-shrink-0 min-h-[36px] flex items-center gap-1.5 px-3 rounded-xl text-[11px] font-bold text-white"
                style={{ backgroundColor: GK }}>
                <Svg d={P.mic} size={12} color="white" />
                Mic Sale
              </button>
            </div>
            <PeriodFilter period={period} setPeriod={setPeriod} dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} />

            {/* Type filter (All History only) */}
            {sub === "all" && (
              <div className="flex gap-2 overflow-x-auto no-scrollbar">
                {[["all","All"],["in","Cash In"],["out","Cash Out"],["bills","Bills"]].map(([v, l]) => (
                  <button key={v} onClick={() => setTypeFilter(v)}
                    className={`flex-shrink-0 min-h-[44px] px-3 rounded-xl text-[11px] font-bold transition flex items-center ${
                      typeFilter === v
                        ? "bg-emerald-600 dark:bg-slate-200 text-white dark:text-slate-900"
                        : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400"
                    }`}>
                    {l}
                  </button>
                ))}
              </div>
            )}

            {/* Cash In / Cash Out add buttons — hidden when transactions.can_create is off (PERM-1) */}
            {canCreate && (
              <div className="flex gap-2">
                <button onClick={() => onAddCash("in")}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-2xl text-white text-xs font-bold active:scale-[0.97] transition"
                  style={{ backgroundColor: GK }}>
                  <Svg d="M12 5v14|M5 12h14" size={14} color="white" sw={2.5} />
                  Cash In
                </button>
                <button onClick={() => onAddCash("out")}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-2xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 text-red-600 dark:text-red-400 text-xs font-bold active:scale-[0.97] transition">
                  <Svg d="M5 12h14" size={14} color="currentColor" sw={2.5} />
                  Cash Out
                </button>
              </div>
            )}
            {/* D5: Request approval for refund/discount if no permission */}
            {(!canRefund || !canDiscount) && (
              <button onClick={() => {
                  const firstType = !canRefund ? "refund" : !canDiscount ? "discount" : "expense";
                  setApprForm({ type: firstType, amount: "", reason: "" });
                  setShowApprReq(true);
                }}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-2xl border border-dashed border-slate-300 dark:border-slate-600 text-xs font-semibold text-slate-500 dark:text-slate-400 active:scale-[0.98] transition">
                Request Refund / Discount Approval
              </button>
            )}
          </div>

          {/* Summary bar */}
          <div className="flex-shrink-0 grid grid-cols-3 gap-px bg-slate-100 dark:bg-slate-700/50 border-y border-slate-100 dark:border-slate-700/50">
            {[
              ["Cash In",  fmt(totalIn),               "text-emerald-600 dark:text-emerald-400"],
              ["Cash Out", fmt(totalOut),               "text-red-500"],
              ["Count",    displaySet.length + " txns", "text-slate-700 dark:text-slate-200"],
            ].map(([l, v, c]) => (
              <div key={l} className="bg-white dark:bg-slate-800 px-3 py-2.5 text-center">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{l}</p>
                <p className={`text-sm font-extrabold tabular mt-0.5 ${c}`}>{v}</p>
              </div>
            ))}
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 pb-4">
            {loading
              ? [1,2,3,4].map(i => <div key={i} className="h-[72px] bg-slate-100 dark:bg-slate-700/60 rounded-2xl animate-pulse" />)
              : (sub === "cash" ? cashOnly : allHistory).length === 0
                ? <p className="text-center text-sm text-slate-400 py-12">No transactions found</p>
                : (sub === "cash" ? cashOnly : allHistory).map((tx, i) => (
                    <TxRow key={tx.id || i} t={tx} onClick={() => setReceipt(tx)} />
                  ))
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

      {/* D5: Approval request modal */}
      {showApprReq && (
        <div className="fixed inset-0 z-sheet flex items-end justify-center bg-black/40">
          <div className="bg-white dark:bg-slate-900 rounded-t-3xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-base font-bold text-slate-800 dark:text-white">Request Manager Approval</p>
              <button onClick={() => setShowApprReq(false)} className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-slate-500" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="flex gap-2">
              {(!canRefund   ? ["refund"]   : []).concat(!canDiscount ? ["discount"] : []).concat(["expense"]).map(type => (
                <button key={type} onClick={() => setApprForm(f => ({ ...f, type }))}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold capitalize border-2 transition-colors ${apprForm.type === type ? "border-green-500 bg-green-50 text-green-700" : "border-slate-200 dark:border-slate-700 text-slate-500"}`}>
                  {type}
                </button>
              ))}
            </div>
            <input type="number" min="0" placeholder="Amount (₦)"
              value={apprForm.amount}
              onChange={e => setApprForm(f => ({ ...f, amount: e.target.value }))}
              className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500" />
            <input type="text" placeholder="Reason (optional)"
              value={apprForm.reason}
              onChange={e => setApprForm(f => ({ ...f, reason: e.target.value }))}
              className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500" />
            {apprMsg && <p className={`text-xs px-3 py-2 rounded-xl border ${apprMsg.includes("Failed") ? "bg-red-50 border-red-200 text-red-600" : "bg-green-50 border-green-200 text-green-700"}`}>{apprMsg}</p>}
            <button onClick={submitApproval} disabled={apprSaving || !apprForm.amount}
              className="w-full py-3.5 rounded-xl text-white text-sm font-bold disabled:opacity-50 transition-colors"
              style={{ backgroundColor: NK }}>
              {apprSaving ? "Sending…" : "Send Request"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
