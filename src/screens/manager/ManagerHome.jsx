import { AmountDisplay } from "../../components/shared/AmountDisplay";
import { canDo }         from "../../utils/plans";
import { fmt, today }    from "../../utils/helpers";
import SyncBar           from "../../components/SyncBar";
import {
  Svg, P, StatCard, TxRow,
  greetingText, fmtDate,
  useManagerBillServices, ActionBtn,
} from "./ManagerShared";
import { useT, useLanguage } from "../../contexts/LanguageContext";

export default function ManagerHome({ staff, store, inventory, plan, onGoTo, onVoiceOpen, onAddCash }) {
  const t            = useT();
  const { lang }     = useLanguage();
  const BILL_SVCS    = useManagerBillServices();

  const { transactions = [], credits = [], asoClients = [], loading, isOnline, loadError, clearLoadError } = store;
  const todayStr    = today();
  const todayTx     = transactions.filter(tx => tx.transaction_date === todayStr);
  const cashIn      = todayTx.filter(tx => tx.type === "in").reduce((s, tx) => s + tx.amount, 0);
  const cashOut     = todayTx.filter(tx => tx.type === "out").reduce((s, tx) => s + tx.amount, 0);
  const netCash     = cashIn - cashOut;
  const totalCredit = credits.reduce((s, c) => s + (c.outstanding || 0), 0);
  const overdueCnt  = credits.filter(c => c.status === "overdue").length;
  const totalAso    = asoClients.reduce((s, c) => s + (c.current_balance || 0), 0);
  const lowStock    = inventory?.lowStock || [];
  const name        = (staff?.full_name || "Manager").split(" ")[0];

  return (
    <div className="overflow-y-auto h-full pb-6 screen-enter">
      <SyncBar isOnline={isOnline} />

      {/* loadError banner */}
      {loadError && (
        <div className="mx-4 mt-3 flex items-center gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-2xl px-4 py-3">
          <Svg d={P.alert} size={16} color="#f59e0b" />
          <p className="flex-1 text-sm font-semibold text-amber-700 dark:text-amber-400">{loadError}</p>
          <button onClick={() => { clearLoadError(); store.reloadData?.(); }}
            className="text-xs font-bold text-amber-700 dark:text-amber-300 underline">Retry</button>
        </div>
      )}

      {/* Greeting */}
      <div className="px-4 pt-5 pb-2">
        <p className="text-sm text-slate-400 dark:text-slate-500 font-medium">{greetingText(t)} 👋</p>
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white leading-tight mt-0.5 truncate">{name}</h1>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{fmtDate(lang)}</p>
      </div>

      {/* Alerts */}
      <div className="px-4 space-y-2 mb-4">
        {overdueCnt > 0 && (
          <button onClick={() => onGoTo("records", "credit")}
            className="w-full flex items-center gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/40 rounded-2xl px-4 py-3 active:scale-[.98] transition text-left">
            <Svg d={P.alert} size={18} color="#ef4444" />
            <p className="flex-1 text-sm font-semibold text-red-700 dark:text-red-400">{overdueCnt} overdue credit{overdueCnt > 1 ? "s" : ""} — tap to follow up</p>
            <Svg d="M9 18l6-6-6-6" size={16} color="#ef4444" />
          </button>
        )}
        {canDo(plan, "inventory") && lowStock.length > 0 && (
          <button onClick={() => onGoTo("stock")}
            className="w-full flex items-center gap-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700/40 rounded-2xl px-4 py-3 active:scale-[.98] transition text-left">
            <Svg d={P.alert} size={18} color="#f97316" />
            <p className="flex-1 text-sm font-semibold text-orange-700 dark:text-orange-400">{lowStock.length} item{lowStock.length > 1 ? "s" : ""} running low in stock</p>
            <Svg d="M9 18l6-6-6-6" size={16} color="#f97316" />
          </button>
        )}
      </div>

      {/* Hero card */}
      <div className="px-4 mb-5">
        <div className="rounded-3xl px-6 py-6 text-white relative overflow-hidden shadow-hero bg-[linear-gradient(145deg,#059669_0%,#047857_55%,#065f46_100%)]">
          <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-white/5 pointer-events-none" />
          <div className="absolute -bottom-14 -left-10 w-48 h-48 rounded-full bg-white/5 pointer-events-none" />
          <div className="relative">
            <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest">Branch Net Cash</p>
            {loading
              ? <div className="h-12 w-44 bg-white/20 rounded-xl animate-pulse mt-2 mb-5" />
              : <AmountDisplay amount={Math.abs(netCash)} size="hero" align="left" className="mt-1.5 mb-5" style={{ color: netCash < 0 ? "#fca5a5" : "#fff" }} />
            }
            <div className="flex gap-5">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold text-white/60 uppercase tracking-widest mb-0.5">Cash In</p>
                {loading ? <p className="text-base font-bold tabular">—</p> : <AmountDisplay amount={cashIn} size="row" align="left" className="text-white font-bold" />}
              </div>
              <div className="w-px bg-white/20 self-stretch" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold text-white/60 uppercase tracking-widest mb-0.5">Cash Out</p>
                {loading ? <p className="text-base font-bold tabular">—</p> : <AmountDisplay amount={cashOut} size="row" align="left" className="text-white font-bold" />}
              </div>
              <div className="w-px bg-white/20 self-stretch" />
              <div>
                <p className="text-[10px] font-semibold text-white/60 uppercase tracking-widest mb-0.5">Txns</p>
                <p className="text-base font-bold tabular">{loading ? "—" : todayTx.length}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Services */}
      <div className="px-4 mb-5">
        <div className="bg-white dark:bg-slate-800 rounded-3xl p-4 shadow-card border border-slate-100 dark:border-slate-700/50">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[12px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Quick Services</p>
            <button onClick={() => onGoTo("sales", "bills")} className="text-[11px] font-bold text-brand-600 dark:text-brand-400">See all</button>
          </div>
          <div className="grid grid-cols-3 gap-y-5">
            {BILL_SVCS.map(s => (
              <button key={s.id} onClick={() => s.isMic ? onVoiceOpen() : onGoTo("sales", "bills", s.id)}
                className="flex flex-col items-center gap-2 active:scale-90 transition-transform">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-sm"
                  style={{ background: `linear-gradient(135deg,${s.g1},${s.g2})` }}>
                  <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    {s.icon.split("|").map((d, i) => <path key={i} d={d} />)}
                  </svg>
                </div>
                <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 text-center leading-tight">{s.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="px-4 grid grid-cols-2 gap-3 mb-5">
        <StatCard label="Cash In"        value={fmt(cashIn)}      icon={P.in}     iconBg="bg-green-100 dark:bg-green-900/40"  iconColor="#16a34a" loading={loading} onClick={() => onGoTo("sales", "cash")} />
        <StatCard label="Cash Out"       value={fmt(cashOut)}     icon={P.out}    iconBg="bg-red-100 dark:bg-red-900/40"     iconColor="#ef4444" loading={loading} onClick={() => onGoTo("sales", "all")} />
        <StatCard label="Pending Credit" value={fmt(totalCredit)} icon={P.credit} iconBg="bg-amber-100 dark:bg-amber-900/40" iconColor="#d97706"
          sub={overdueCnt > 0 ? `⚠ ${overdueCnt} overdue` : `${credits.length} records`} loading={loading} onClick={() => onGoTo("records", "credit")} />
        {canDo(plan, "aso") && (
          <StatCard label="Ajo Balance" value={fmt(totalAso)} icon={P.bank} iconBg="bg-blue-100 dark:bg-blue-900/40" iconColor="#2563eb"
            sub={`${asoClients.length} clients`} loading={loading} onClick={() => onGoTo("records", "ajo")} />
        )}
      </div>

      {/* Quick Actions */}
      <div className="px-4 mb-5">
        <h2 className="text-[13px] font-bold text-slate-700 dark:text-slate-300 mb-3 tracking-wide">Quick Actions</h2>
        <div className="grid grid-cols-3 gap-y-4 gap-x-2">
          <ActionBtn label="Cash In"   icon={P.in}     bg="bg-gradient-to-br from-green-500 to-emerald-600" onClick={() => onAddCash("in")} />
          <ActionBtn label="Cash Out"  icon={P.out}    bg="bg-gradient-to-br from-red-500 to-red-600"       onClick={() => onAddCash("out")} />
          <ActionBtn label="Pay Bills" icon={P.bills}  bg="bg-gradient-to-br from-cyan-500 to-teal-600"     onClick={() => onGoTo("sales", "bills")} />
          <ActionBtn label="Credit"    icon={P.credit} bg="bg-gradient-to-br from-amber-400 to-amber-500"   onClick={() => onGoTo("records", "credit")} />
          {canDo(plan, "aso") && (
            <ActionBtn label="Ajo" icon={P.bank} bg="bg-gradient-to-br from-blue-500 to-blue-600" onClick={() => onGoTo("records", "ajo")} />
          )}
          <ActionBtn label="Reports" icon={P.report} bg="bg-gradient-to-br from-purple-500 to-violet-600" onClick={() => onGoTo("me", "reports")} />
        </div>
      </div>

      {/* Recent Transactions */}
      <div className="px-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[13px] font-bold text-slate-700 dark:text-slate-300 tracking-wide">Recent Transactions</h2>
          <button onClick={() => onGoTo("sales", "all")} className="text-[11px] font-bold text-brand-600 dark:text-brand-400">View all →</button>
        </div>
        {loading
          ? [1,2,3].map(i => <div key={i} className="h-[68px] bg-slate-100 dark:bg-slate-700/60 rounded-2xl animate-pulse mb-2" />)
          : transactions.slice(0, 5).length === 0
            ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-1">
                  <Svg d={P.in} size={22} color="#94a3b8" />
                </div>
                <p className="text-sm font-semibold text-slate-400">No sales recorded yet</p>
                <p className="text-xs text-slate-300 dark:text-slate-600">Tap Cash In to record your first sale</p>
              </div>
            )
            : transactions.slice(0, 5).map((tx, i) => (
              <div key={tx.id || i} className="mb-2">
                <TxRow t={tx} onClick={() => onGoTo("sales", "receipt", tx)} />
              </div>
            ))
        }
      </div>
    </div>
  );
}
