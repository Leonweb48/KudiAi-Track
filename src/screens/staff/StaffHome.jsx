import { useMemo } from "react";
import { fmt, today } from "../../utils/helpers";
import { canDo } from "../../utils/plans";
import { useT, useLanguage } from "../../contexts/LanguageContext";
import {
  Svg, P, NK, GK, GKL,
  StatCard, TxRow, SectionLabel,
  makeBillServices, fmtDate,
} from "./StaffShared";

/* ═══════════════════════════════════════════════════════════════════
   HOME TAB
═══════════════════════════════════════════════════════════════════ */
export default function StaffHome({ staff, store, inventory, plan, onGoTo, onVoiceOpen, onAddCash }) {
  const t = useT();
  const { lang } = useLanguage();
  const BILL_SERVICES = useMemo(() => makeBillServices(t), [t]);

  const { transactions = [], credits = [], asoClients = [], loading } = store;
  const todayStr     = today();
  const todayTx      = transactions.filter(tx => tx.transaction_date === todayStr);
  const cashIn       = todayTx.filter(tx => tx.type === "in").reduce((s, tx) => s + tx.amount, 0);
  const cashOut      = todayTx.filter(tx => tx.type === "out").reduce((s, tx) => s + tx.amount, 0);
  const profit       = cashIn - cashOut;
  const totalCredit  = credits.reduce((s, c) => s + (c.outstanding || 0), 0);
  const overdueCount = credits.filter(c => c.status === "overdue").length;
  const totalAso     = asoClients.reduce((s, c) => s + (c.current_balance || 0), 0);
  const lowStock     = inventory?.lowStock || [];

  // 4-column quick services (4+4 = 2 clean rows)
  const services = useMemo(() => [
    { id: "cash-in",  label: "Cash In",   icon: P.in,     color: GK,  onClick: () => onAddCash("in") },
    { id: "cash-out", label: "Cash Out",  icon: P.out,    color: NK,  onClick: () => onAddCash("out") },
    { id: "credit",   label: "Credit",    icon: P.credit, color: NK,  onClick: () => onGoTo("records","credit") },
    { id: "bills",    label: "Pay Bills", icon: P.bills,  color: NK,  onClick: () => onGoTo("sales","bills") },
    ...BILL_SERVICES.slice(0, 3).map(s => ({
      ...s,
      color: NK,
      onClick: s.isMic ? onVoiceOpen : () => onGoTo("sales","bills",s.id),
    })),
    canDo(plan, "aso")
      ? { id: "ajo",    label: "Ajo",     icon: P.bank,   color: NK, onClick: () => onGoTo("records","ajo") }
      : { id: "report", label: "Reports", icon: P.report, color: NK, onClick: () => onGoTo("me","reports") },
  ], [BILL_SERVICES, plan, onAddCash, onVoiceOpen, onGoTo]);

  return (
    <div className="overflow-y-auto h-full px-4 pt-4 pb-6 screen-enter">

      {/* Alerts */}
      {overdueCount > 0 && (
        <button onClick={() => onGoTo("records","credit")}
          className="w-full flex items-center gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/40 rounded-2xl px-4 py-3 mb-4 active:scale-[.98] transition text-left">
          <Svg d={P.alert} size={18} color="#ef4444" />
          <p className="flex-1 text-sm font-semibold text-red-700 dark:text-red-400">{overdueCount} overdue credit{overdueCount > 1 ? "s" : ""} — tap to follow up</p>
          <Svg d="M9 18l6-6-6-6" size={16} color="#ef4444" />
        </button>
      )}
      {canDo(plan, "inventory") && lowStock.length > 0 && (
        <button onClick={() => onGoTo("stock")}
          className="w-full flex items-center gap-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700/40 rounded-2xl px-4 py-3 mb-4 active:scale-[.98] transition text-left">
          <Svg d={P.alert} size={18} color="#f97316" />
          <p className="flex-1 text-sm font-semibold text-orange-700 dark:text-orange-400">{lowStock.length} item{lowStock.length > 1 ? "s" : ""} running low in stock</p>
          <Svg d="M9 18l6-6-6-6" size={16} color="#f97316" />
        </button>
      )}

      {/* Hero card — navy */}
      <div className="rounded-3xl px-6 py-6 text-white relative overflow-hidden shadow-hero mb-5"
        style={{ background: "linear-gradient(145deg,#16255A 0%,#1e3370 60%,#243d8a 100%)" }}>
        <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute -bottom-14 -left-10 w-48 h-48 rounded-full bg-white/5 pointer-events-none" />
        <div className="relative">
          <p className="text-[10px] font-bold text-white/50 uppercase tracking-widest">Today's Profit</p>
          <p className="text-[11px] text-white/35 mb-1">{fmtDate(lang)}</p>
          {loading
            ? <div className="h-12 w-44 bg-white/20 rounded-xl animate-pulse mt-2 mb-5" />
            : <p className={`text-4xl font-black tracking-tight mt-1 mb-5 tabular ${profit < 0 ? "text-red-300" : "text-white"}`}>
                {profit < 0 && "−"}{fmt(Math.abs(profit))}
              </p>
          }
          <div className="h-px bg-white/10 mb-4" />
          <div className="flex gap-5">
            <div>
              <p className="text-[10px] font-bold text-white/50 uppercase tracking-widest mb-0.5">Cash In</p>
              <p className="text-base font-bold tabular" style={{ color: GKL }}>{loading ? "—" : fmt(cashIn)}</p>
            </div>
            <div className="w-px bg-white/15 self-stretch" />
            <div>
              <p className="text-[10px] font-bold text-white/50 uppercase tracking-widest mb-0.5">Cash Out</p>
              <p className="text-base font-bold tabular text-red-300">{loading ? "—" : fmt(cashOut)}</p>
            </div>
            <div className="w-px bg-white/15 self-stretch" />
            <div>
              <p className="text-[10px] font-bold text-white/50 uppercase tracking-widest mb-0.5">Txns</p>
              <p className="text-base font-bold tabular">{loading ? "—" : todayTx.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <StatCard label="Cash In"        value={fmt(cashIn)}      icon={P.in}     iconBg="bg-[#E8F7E3] dark:bg-[#3DA829]/20"  iconColor={GK}      loading={loading} onClick={() => onGoTo("sales","cash")} />
        <StatCard label="Cash Out"       value={fmt(cashOut)}     icon={P.out}    iconBg="bg-red-100 dark:bg-red-900/40"        iconColor="#ef4444" loading={loading} onClick={() => onGoTo("sales","all")} />
        <StatCard label="Pending Credit" value={fmt(totalCredit)} icon={P.credit} iconBg="bg-amber-100 dark:bg-amber-900/40"    iconColor="#d97706"
          sub={overdueCount > 0 ? `⚠ ${overdueCount} overdue` : `${credits.length} records`}
          loading={loading} onClick={() => onGoTo("records","credit")} />
        {canDo(plan, "aso") && (
          <StatCard label="Ajo Balance" value={fmt(totalAso)} icon={P.bank} iconBg="bg-[#EEF1FA] dark:bg-[#16255A]/30" iconColor={NK}
            sub={`${asoClients.length} clients`} loading={loading} onClick={() => onGoTo("records","ajo")} />
        )}
      </div>

      {/* Quick Services — 4-col grid, navy icons on light-green tiles */}
      <div className="flex items-center justify-between px-1 mb-3">
        <SectionLabel>Quick Services</SectionLabel>
        <button onClick={() => onGoTo("sales","bills")}
          className="text-[11px] font-bold" style={{ color: GK }}>See all</button>
      </div>
      <div className="grid grid-cols-4 gap-3 mb-6">
        {services.map(s => (
          <button key={s.id} onClick={s.onClick}
            className="flex flex-col items-center gap-2 active:scale-90 transition-transform duration-150">
            <div className="w-14 h-14 rounded-full bg-[#E8F7E3] dark:bg-[#16255A]/25 flex items-center justify-center shadow-sm">
              <Svg d={s.icon} size={22} color={s.color} sw={2} />
            </div>
            <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-400 text-center leading-tight w-full truncate px-0.5">{s.label}</span>
          </button>
        ))}
      </div>

      {/* Recent Transactions */}
      <div className="flex items-center justify-between mb-3">
        <SectionLabel>Recent</SectionLabel>
        <button onClick={() => onGoTo("sales","all")} className="text-[11px] font-bold" style={{ color: GK }}>View all →</button>
      </div>
      {loading
        ? [1,2,3].map(i => <div key={i} className="h-[68px] bg-slate-100 dark:bg-slate-700/60 rounded-2xl animate-pulse mb-2" />)
        : transactions.slice(0, 5).length === 0
          ? <p className="text-center text-sm text-slate-400 py-8">No sales recorded yet</p>
          : transactions.slice(0, 5).map((tx, i) => (
              <div key={tx.id || i} className="mb-2">
                <TxRow t={tx} onClick={() => onGoTo("sales","receipt",tx)} />
              </div>
            ))
      }
    </div>
  );
}
