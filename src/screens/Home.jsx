import { fmt, today } from "../utils/helpers";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function fmtDate() {
  return new Date().toLocaleDateString("en-NG", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

/* ── Inline SVG paths ──────────────────────────────────────────── */
const P = {
  mic:     "M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z M19 10v2a7 7 0 01-14 0v-2 M12 19v4 M8 23h8",
  arrowD:  "M12 5v14 M19 12l-7 7-7-7",
  arrowU:  "M12 19V5 M5 12l7-7 7 7",
  credit:  "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2 M9 11a4 4 0 100-8 4 4 0 000 8 M23 21v-2a4 4 0 00-3-3.87 M16 3.13a4 4 0 010 7.75",
  bank:    "M3 22h18 M6 18v-7 M10 18v-7 M14 18v-7 M18 18v-7 M12 2L2 7h20L12 2z",
  report:  "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8",
  person:  "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2 M12 11a4 4 0 100-8 4 4 0 000 8z",
};

function Svg({ d, size = 18, color = "currentColor", strokeWidth = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {d.split(" M").map((seg, i) => (
        <path key={i} d={i === 0 ? seg : "M" + seg} />
      ))}
    </svg>
  );
}

/* ── Stat card ─────────────────────────────────────────────────── */
function StatCard({ label, value, icon, iconBg, iconColor, sub, onClick, loading }) {
  return (
    <button onClick={onClick}
      className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-card border border-slate-100 dark:border-slate-700/60 text-left active:scale-95 transition-all duration-150 w-full">
      <div className="flex items-center gap-2.5 mb-2.5">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
          <Svg d={icon} size={16} color={iconColor} strokeWidth={2.5} />
        </div>
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 leading-tight">{label}</span>
      </div>
      {loading
        ? <div className="h-6 w-20 bg-slate-100 dark:bg-slate-700 rounded-lg animate-pulse" />
        : <p className="text-lg font-extrabold text-slate-800 dark:text-slate-100 tabular leading-tight">{value}</p>
      }
      {sub && !loading && (
        <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 mt-1">{sub}</p>
      )}
    </button>
  );
}

/* ── Quick action button ───────────────────────────────────────── */
function ActionBtn({ label, icon, bg, iconColor, onClick }) {
  return (
    <button onClick={onClick}
      className="flex flex-col items-center gap-2 active:scale-95 transition-transform duration-150">
      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-sm ${bg}`}>
        <Svg d={icon} size={22} color={iconColor} strokeWidth={2} />
      </div>
      <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 text-center leading-tight">{label}</span>
    </button>
  );
}

/* ── Recent tx row ─────────────────────────────────────────────── */
function TxRow({ t }) {
  const isIn = t.type === "in";
  return (
    <div className="flex items-center gap-3 bg-white dark:bg-slate-800 rounded-2xl px-4 py-3 shadow-card border border-slate-100 dark:border-slate-700/60">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${isIn ? "bg-green-50 dark:bg-green-900/30" : "bg-red-50 dark:bg-red-900/30"}`}>
        <span className={`text-base font-black leading-none ${isIn ? "text-green-600" : "text-red-500"}`}>
          {isIn ? "+" : "−"}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{t.item_name || "Transaction"}</p>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{t.category} · {t.payment_type}</p>
      </div>
      <p className={`text-sm font-extrabold tabular ${isIn ? "text-green-600" : "text-red-500"}`}>
        {isIn ? "+" : "−"}{fmt(t.amount)}
      </p>
    </div>
  );
}

/* ── Main component ────────────────────────────────────────────── */
export default function Home({ store, setTab, onQuickAction, onVoiceOpen }) {
  const { transactions, credits, asoClients, profile, loading } = store;

  const todayTx     = transactions.filter((t) => t.transaction_date === today());
  const cashIn      = todayTx.filter((t) => t.type === "in" ).reduce((s, t) => s + t.amount, 0);
  const cashOut     = todayTx.filter((t) => t.type === "out").reduce((s, t) => s + t.amount, 0);
  const profit      = cashIn - cashOut;
  const totalCredit = credits.reduce((s, c) => s + c.outstanding, 0);
  const overdueCount= credits.filter((c) => c.status === "overdue").length;
  const totalAso    = asoClients.reduce((s, c) => s + c.current_balance, 0);
  const initials    = profile.owner_name?.[0]?.toUpperCase() || "A";

  return (
    <div className="px-4 pt-5 pb-32 screen-enter space-y-5">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1 pr-3">
          <p className="text-sm text-slate-400 dark:text-slate-500 font-medium">
            {greeting()} 👋
          </p>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white leading-tight mt-0.5 truncate">
            {profile.business_name || profile.owner_name || "Welcome"}
          </h1>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{fmtDate()}</p>
        </div>

        {/* Avatar */}
        <button onClick={() => setTab("settings")} aria-label="Settings"
          className="w-11 h-11 rounded-full border-2 border-white dark:border-slate-700 shadow-card-md flex-shrink-0 overflow-hidden active:scale-95 transition-transform">
          {profile.profile_image_url
            ? <img src={profile.profile_image_url} alt="Profile" className="w-full h-full object-cover" />
            : (
              <div className="w-full h-full bg-brand-600 flex items-center justify-center">
                <Svg d={P.person} size={20} color="white" strokeWidth={2} />
              </div>
            )
          }
        </button>
      </div>

      {/* ── Hero profit card ────────────────────────────────────── */}
      <div className="rounded-3xl px-6 py-6 text-white relative overflow-hidden shadow-hero"
        style={{ background: "linear-gradient(145deg, #059669 0%, #047857 50%, #065f46 100%)" }}>
        {/* Decorative circles */}
        <div className="absolute -top-10 -right-10 w-36 h-36 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute -bottom-12 -left-8  w-44 h-44 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute top-4 right-20     w-16 h-16 rounded-full bg-white/5 pointer-events-none" />

        <p className="text-xs font-semibold text-white/70 uppercase tracking-widest relative">Today's Profit</p>

        {loading ? (
          <div className="h-11 w-40 bg-white/20 rounded-xl animate-pulse mt-2 mb-5" />
        ) : (
          <p className="text-4xl font-black tracking-tight mt-1.5 mb-5 relative tabular">{fmt(profit)}</p>
        )}

        <div className="flex gap-5 relative">
          <div>
            <p className="text-[10px] font-semibold text-white/60 uppercase tracking-widest mb-0.5">↓ In</p>
            <p className="text-base font-bold text-white tabular">{loading ? "—" : fmt(cashIn)}</p>
          </div>
          <div className="w-px bg-white/20" />
          <div>
            <p className="text-[10px] font-semibold text-white/60 uppercase tracking-widest mb-0.5">↑ Out</p>
            <p className="text-base font-bold text-white tabular">{loading ? "—" : fmt(cashOut)}</p>
          </div>
        </div>
      </div>

      {/* ── 4 stat cards ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Cash In"
          value={fmt(cashIn)}
          icon={P.arrowD}
          iconBg="bg-green-100 dark:bg-green-900/40"
          iconColor="#16a34a"
          loading={loading}
          onClick={() => setTab("transactions")}
        />
        <StatCard
          label="Cash Out"
          value={fmt(cashOut)}
          icon={P.arrowU}
          iconBg="bg-red-100 dark:bg-red-900/40"
          iconColor="#ef4444"
          loading={loading}
          onClick={() => setTab("transactions")}
        />
        <StatCard
          label="Pending Credit"
          value={fmt(totalCredit)}
          icon={P.credit}
          iconBg="bg-amber-100 dark:bg-amber-900/40"
          iconColor="#d97706"
          sub={overdueCount > 0 ? `${overdueCount} overdue` : `${credits.length} records`}
          loading={loading}
          onClick={() => setTab("credit")}
        />
        <StatCard
          label="Aso Balance"
          value={fmt(totalAso)}
          icon={P.bank}
          iconBg="bg-blue-100 dark:bg-blue-900/40"
          iconColor="#2563eb"
          sub={`${asoClients.length} clients`}
          loading={loading}
          onClick={() => setTab("aso")}
        />
      </div>

      {/* ── Quick Actions ────────────────────────────────────────── */}
      <div>
        <h2 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3">Quick Actions</h2>
        <div className="grid grid-cols-3 gap-y-4 gap-x-2">
          <ActionBtn label="Voice Record" icon={P.mic}    bg="bg-green-500"  iconColor="white" onClick={() => onVoiceOpen?.()} />
          <ActionBtn label="Cash In"      icon={P.arrowD} bg="bg-green-500"  iconColor="white" onClick={() => onQuickAction?.("transactions","in")} />
          <ActionBtn label="Cash Out"     icon={P.arrowU} bg="bg-red-500"    iconColor="white" onClick={() => onQuickAction?.("transactions","out")} />
          <ActionBtn label="Credit Sale"  icon={P.credit} bg="bg-amber-500"  iconColor="white" onClick={() => onQuickAction?.("credit")} />
          <ActionBtn label="Aso Client"   icon={P.bank}   bg="bg-blue-600"   iconColor="white" onClick={() => onQuickAction?.("aso")} />
          <ActionBtn label="Reports"      icon={P.report} bg="bg-purple-600" iconColor="white" onClick={() => setTab("insights")} />
        </div>
      </div>

      {/* ── Recent Transactions ──────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-slate-700 dark:text-slate-300">Recent Transactions</h2>
          <button onClick={() => setTab("transactions")}
            className="text-xs text-brand-600 dark:text-brand-400 font-bold">
            See all →
          </button>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[1,2,3].map(i => (
              <div key={i} className="h-[62px] bg-white dark:bg-slate-800 rounded-2xl animate-pulse border border-slate-100 dark:border-slate-700/60" />
            ))}
          </div>
        ) : transactions.length === 0 ? (
          <div className="text-center py-10 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60">
            <p className="text-slate-400 dark:text-slate-500 text-sm font-semibold">No transactions yet</p>
            <p className="text-slate-300 dark:text-slate-600 text-xs mt-1">
              Tap "Cash In" or use Voice Record to get started
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {transactions.slice(0, 5).map((t) => <TxRow key={t.id} t={t} />)}
          </div>
        )}
      </div>

    </div>
  );
}
