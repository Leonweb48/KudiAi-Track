import { fmt, today } from "../utils/helpers";

const ICONS = {
  person:   "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2 M12 11a4 4 0 100-8 4 4 0 000 8z",
  mic:      "M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z M19 10v2a7 7 0 01-14 0v-2 M12 19v4 M8 23h8",
  plus:     "M12 5v14 M5 12h14",
  arrow:    "M5 12h14 M12 5l7 7-7 7",
};

function Svg({ d, size = 20, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {d.split(" M").map((seg, i) => (
        <path key={i} d={i === 0 ? seg : "M" + seg} />
      ))}
    </svg>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function fmtDate() {
  return new Date().toLocaleDateString("en-NG", { weekday: "long", day: "numeric", month: "long" });
}

function TxRow({ t }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3 flex items-center gap-3 shadow-sm border border-slate-100 dark:border-slate-700">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${t.type === "in" ? "bg-green-100 dark:bg-green-900/30" : "bg-red-100 dark:bg-red-900/30"}`}>
        <span className={`text-sm font-black ${t.type === "in" ? "text-green-600" : "text-red-500"}`}>
          {t.type === "in" ? "+" : "−"}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{t.item_name}</p>
        <p className="text-[11px] text-slate-400 dark:text-slate-500">{t.category} · {t.payment_type}</p>
      </div>
      <p className={`font-extrabold text-sm ${t.type === "in" ? "text-green-600" : "text-red-500"}`}>
        {t.type === "in" ? "+" : "−"}{fmt(t.amount)}
      </p>
    </div>
  );
}

export default function Home({ store, setTab, onQuickAction, onVoiceOpen }) {
  const { transactions, credits, asoClients, profile, loading } = store;

  const todayTx      = transactions.filter((t) => t.transaction_date === today());
  const cashIn       = todayTx.filter((t) => t.type === "in").reduce((s, t) => s + t.amount, 0);
  const cashOut      = todayTx.filter((t) => t.type === "out").reduce((s, t) => s + t.amount, 0);
  const profit       = cashIn - cashOut;
  const totalCredit  = credits.reduce((s, c) => s + c.outstanding, 0);
  const overdueCount = credits.filter((c) => c.status === "overdue").length;
  const totalAso     = asoClients.reduce((s, c) => s + c.current_balance, 0);

  const initials = profile.owner_name?.[0]?.toUpperCase() || "A";

  return (
    <div className="px-4 pt-4 pb-28 screen-enter">

      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <p className="text-sm text-slate-400 dark:text-slate-500 font-medium">
            {greeting()}, {profile.owner_name?.split(" ")[0] || "there"} 👋
          </p>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white leading-tight mt-0.5 truncate max-w-[200px]">
            {profile.business_name || profile.owner_name || "Welcome"}
          </h1>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{fmtDate()}</p>
        </div>
        <button
          onClick={() => setTab("settings")}
          aria-label="Profile settings"
          className="w-11 h-11 rounded-full bg-brand-50 dark:bg-brand-900/30 border-2 border-brand-100 dark:border-brand-800 flex items-center justify-center flex-shrink-0 overflow-hidden active:scale-95 transition-transform"
        >
          {profile.profile_image_url
            ? <img src={profile.profile_image_url} alt="Profile" className="w-full h-full object-cover" />
            : <div className="w-full h-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold text-base">{initials}</div>
          }
        </button>
      </div>

      {/* Hero profit card */}
      <div className="rounded-3xl px-6 py-6 text-white relative overflow-hidden shadow-hero mb-4"
        style={{ background: "linear-gradient(135deg,#059669 0%,#047857 55%,#065f46 100%)" }}>
        <div className="absolute -top-8 -right-8 w-32 h-32 bg-white/5 rounded-full" />
        <div className="absolute -bottom-10 -left-6 w-40 h-40 bg-white/5 rounded-full" />
        <p className="text-sm font-medium text-white/75 relative">Today's Profit</p>
        {loading ? (
          <div className="h-10 w-36 bg-white/20 rounded-xl animate-pulse mt-1 mb-4" />
        ) : (
          <p className="text-[2.2rem] font-bold tracking-tight mt-1 mb-4 relative">{fmt(profit)}</p>
        )}
        <div className="flex gap-4 relative">
          <div className="flex-1">
            <p className="text-[10px] text-white/60 font-medium uppercase tracking-wide">Cash In</p>
            <p className="text-base font-bold text-white">{loading ? "—" : fmt(cashIn)}</p>
          </div>
          <div className="w-px bg-white/20" />
          <div className="flex-1">
            <p className="text-[10px] text-white/60 font-medium uppercase tracking-wide">Cash Out</p>
            <p className="text-base font-bold text-white">{loading ? "—" : fmt(cashOut)}</p>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-3 gap-2.5 mb-5">
        <button
          onClick={() => onQuickAction?.("transactions", "in")}
          className="bg-green-600 hover:bg-green-700 text-white rounded-2xl py-3 flex flex-col items-center gap-1 active:scale-95 transition-transform shadow-sm">
          <Svg d={ICONS.plus} size={18} color="white" />
          <span className="text-[11px] font-bold">Add Sale</span>
        </button>
        <button
          onClick={() => onQuickAction?.("transactions", "out")}
          className="bg-red-500 hover:bg-red-600 text-white rounded-2xl py-3 flex flex-col items-center gap-1 active:scale-95 transition-transform shadow-sm">
          <Svg d={ICONS.arrow} size={18} color="white" />
          <span className="text-[11px] font-bold">Add Expense</span>
        </button>
        <button
          onClick={() => onVoiceOpen?.()}
          className="bg-slate-800 dark:bg-slate-700 hover:bg-slate-700 text-white rounded-2xl py-3 flex flex-col items-center gap-1 active:scale-95 transition-transform shadow-sm">
          <Svg d={ICONS.mic} size={18} color="white" />
          <span className="text-[11px] font-bold">Voice</span>
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <button onClick={() => setTab("credit")}
          className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-card border border-slate-100 dark:border-slate-700 text-left active:scale-95 transition-transform">
          <p className="text-[10px] font-bold text-amber-500 uppercase tracking-wider mb-1">Credit Out</p>
          <p className="text-lg font-extrabold text-slate-800 dark:text-slate-100">{fmt(totalCredit)}</p>
          {overdueCount > 0 && (
            <p className="text-[11px] text-red-500 font-semibold mt-1">{overdueCount} overdue</p>
          )}
        </button>
        <button onClick={() => setTab("aso")}
          className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-card border border-slate-100 dark:border-slate-700 text-left active:scale-95 transition-transform">
          <p className="text-[10px] font-bold text-violet-500 uppercase tracking-wider mb-1">Aso Savings</p>
          <p className="text-lg font-extrabold text-slate-800 dark:text-slate-100">{fmt(totalAso)}</p>
          <p className="text-[11px] text-slate-400 font-semibold mt-1">{asoClients.length} clients</p>
        </button>
      </div>

      {/* Recent transactions */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-slate-700 dark:text-slate-300 text-sm">Recent Transactions</h2>
        <button onClick={() => setTab("transactions")} className="text-xs text-brand-600 dark:text-brand-400 font-bold">
          See all →
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1,2,3].map(i => <div key={i} className="h-16 bg-slate-100 dark:bg-slate-800 rounded-2xl animate-pulse" />)}
        </div>
      ) : transactions.length === 0 ? (
        <div className="text-center py-10">
          <p className="text-slate-400 dark:text-slate-500 text-sm font-medium">No transactions yet</p>
          <p className="text-slate-300 dark:text-slate-600 text-xs mt-1">Tap "Add Sale" or use Voice to record your first one</p>
        </div>
      ) : (
        <div className="space-y-2">
          {transactions.slice(0, 5).map((t) => <TxRow key={t.id} t={t} />)}
        </div>
      )}

    </div>
  );
}
