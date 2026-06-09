import { useMemo } from "react";
import { fmt, today } from "../utils/helpers";
import { NotificationBell } from "../components/NotificationCenter";
import { useT } from "../contexts/LanguageContext";
import { getSalesPrediction } from "../utils/predictions";

function greetingKey() {
  const h = new Date().getHours();
  if (h < 12) return "greet.morning";
  if (h < 17) return "greet.afternoon";
  return "greet.evening";
}

function fmtDate() {
  return new Date().toLocaleDateString("en-NG", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

/* ── Tiny SVG helper ─────────────────────────────────────────────── */
function Svg({ d, size = 18, color = "currentColor", sw = 2 }) {
  const paths = d.split("|");
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      {paths.map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}

const P = {
  mic:    "M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z|M19 10v2a7 7 0 01-14 0v-2|M12 19v4|M8 23h8",
  in:     "M12 19V5|M5 12l7-7 7 7",
  out:    "M12 5v14|M19 12l-7 7-7-7",
  credit: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2|M9 11a4 4 0 100-8 4 4 0 000 8|M23 21v-2a4 4 0 00-3-3.87|M16 3.13a4 4 0 010 7.75",
  bank:   "M3 22h18|M6 18v-7|M10 18v-7|M14 18v-7|M18 18v-7|M12 2L2 7h20L12 2z",
  bills:  "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2|M9 5a2 2 0 002 2h2a2 2 0 002-2|M9 5a2 2 0 012-2h2a2 2 0 012 2|M9 13h6|M9 17h4",
  report: "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z|M14 2v6h6|M16 13H8|M16 17H8|M10 9H8",
  person: "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2|M12 11a4 4 0 100-8 4 4 0 000 8",
};

/* ── Stat card ───────────────────────────────────────────────────── */
function StatCard({ label, value, icon, iconBg, iconColor, sub, onClick, loading }) {
  return (
    <button onClick={onClick}
      className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-card border border-slate-100 dark:border-slate-700/50 text-left active:scale-95 transition-all duration-150 w-full">
      <div className="flex items-center gap-2.5 mb-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
          <Svg d={icon} size={16} color={iconColor} sw={2.5} />
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

/* ── Quick action button ─────────────────────────────────────────── */
function ActionBtn({ label, icon, bg, iconColor, onClick }) {
  return (
    <button onClick={onClick}
      className="flex flex-col items-center gap-2 active:scale-90 transition-transform duration-150 focus-visible:outline-none">
      <div className={`w-[56px] h-[56px] rounded-2xl flex items-center justify-center shadow-md ${bg}`}>
        <Svg d={icon} size={22} color={iconColor} sw={2} />
      </div>
      <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 text-center leading-tight max-w-[60px]">
        {label}
      </span>
    </button>
  );
}

/* ── Recent tx row ───────────────────────────────────────────────── */
function TxRow({ t }) {
  const isIn = t.type === "in";
  return (
    <div className="flex items-center gap-3 bg-white dark:bg-slate-800 rounded-2xl px-4 py-3.5 shadow-card border border-slate-100 dark:border-slate-700/50">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isIn ? "bg-green-50 dark:bg-green-900/30" : "bg-red-50 dark:bg-red-900/30"}`}>
        <Svg d={isIn ? P.in : P.out} size={16} color={isIn ? "#16a34a" : "#ef4444"} sw={2.5} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{t.item_name || "Transaction"}</p>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">{t.category} · {t.payment_type}</p>
      </div>
      <p className={`text-sm font-extrabold tabular flex-shrink-0 ${isIn ? "text-green-600" : "text-red-500"}`}>
        {isIn ? "+" : "−"}{fmt(t.amount)}
      </p>
    </div>
  );
}

/* ── Sales forecast card ─────────────────────────────────────────── */
function SalesForecastCard({ prediction, t }) {
  const { projectedWeek, projectedMonth, thisWeekActual, thisMonthActual, trend, trendPct } = prediction;

  const trendColor = trend === "up" ? "text-green-500" : trend === "down" ? "text-red-400" : "text-slate-400 dark:text-slate-500";
  const trendIcon  = trend === "up" ? "↑" : trend === "down" ? "↓" : "→";
  const trendLabel = trendPct !== null
    ? `${trendIcon} ${Math.abs(trendPct)}% ${t("pred.vsLastWeeks")}`
    : `${trendIcon} ${t("pred.stable")}`;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[13px] font-bold text-slate-700 dark:text-slate-300 tracking-wide">
          📈 {t("pred.title")}
        </h2>
        <span className={`text-[11px] font-bold ${trendColor}`}>{trendLabel}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-card border border-slate-100 dark:border-slate-700/50">
          <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">{t("pred.thisWeek")}</p>
          <p className="text-lg font-extrabold text-slate-800 dark:text-slate-100 tabular leading-tight">{fmt(projectedWeek)}</p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{t("pred.projected")}</p>
          <p className="text-[11px] text-brand-600 dark:text-brand-400 font-semibold mt-1">{fmt(thisWeekActual)} {t("pred.actualSoFar")}</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-card border border-slate-100 dark:border-slate-700/50">
          <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">{t("pred.thisMonth")}</p>
          <p className="text-lg font-extrabold text-slate-800 dark:text-slate-100 tabular leading-tight">{fmt(projectedMonth)}</p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{t("pred.projected")}</p>
          <p className="text-[11px] text-brand-600 dark:text-brand-400 font-semibold mt-1">{fmt(thisMonthActual)} {t("pred.actualSoFar")}</p>
        </div>
      </div>
    </div>
  );
}

/* ── Main ────────────────────────────────────────────────────────── */
export default function Home({ store, setTab, onQuickAction, onVoiceOpen, notif }) {
  const { transactions, credits, asoClients, profile, loading } = store;
  const t = useT();

  const todayTx    = transactions.filter(t => t.transaction_date === today());
  const cashIn     = todayTx.filter(t => t.type === "in" ).reduce((s, t) => s + t.amount, 0);
  const cashOut    = todayTx.filter(t => t.type === "out").reduce((s, t) => s + t.amount, 0);
  const profit     = cashIn - cashOut;
  const totalCredit  = credits.reduce((s, c) => s + c.outstanding, 0);
  const overdueCount = credits.filter(c => c.status === "overdue").length;
  const totalAso     = asoClients.reduce((s, c) => s + c.current_balance, 0);
  const forecast     = useMemo(() => getSalesPrediction(transactions), [transactions]);

  return (
    <div className="px-4 pt-5 pb-32 screen-enter space-y-5">

      {/* ── Top bar ──────────────────────────────────────────────────── */}
      <div className="flex items-center -mx-4 px-4 py-3 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700/60 shadow-sm sticky top-0 z-10 -mt-5 mb-1">

        {/* Left — logo */}
        <img src="/logo.png" alt="KudiAI Track" className="w-9 h-9 object-contain rounded-xl bg-white flex-shrink-0" />

        {/* Centre — brand wordmark */}
        <div className="flex-1 flex justify-center items-center gap-0.5 select-none">
          <span className="text-[17px] font-black tracking-tight text-slate-800 dark:text-white leading-none">
            KUDI
          </span>
          <span className="text-[17px] font-black tracking-tight leading-none"
            style={{ background: "linear-gradient(135deg,#16a34a,#059669)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            AI
          </span>
          <span className="text-[13px] font-semibold text-slate-400 dark:text-slate-500 tracking-widest uppercase leading-none ml-1.5 mt-0.5">
            Track
          </span>
        </div>

        {/* Right — bell + profile avatar */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <NotificationBell
            unreadCount={notif?.unreadCount || 0}
            onClick={() => notif?.setOpen(true)}
          />
          <button onClick={() => setTab("settings")} aria-label="Profile"
            className="w-9 h-9 rounded-full border-2 border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden active:scale-95 transition-transform">
            {profile.profile_image_url
              ? <img src={profile.profile_image_url} alt="Profile" className="w-full h-full object-cover" />
              : <div className="w-full h-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
                  <Svg d={P.person} size={18} color="white" sw={2} />
                </div>
            }
          </button>
        </div>
      </div>

      {/* ── Greeting ─────────────────────────────────────────────────── */}
      <div className="pt-4">
        <p className="text-sm text-slate-400 dark:text-slate-500 font-medium">{t(greetingKey())} 👋</p>
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white leading-tight mt-0.5 truncate">
          {profile.business_name || profile.owner_name || "Welcome"}
        </h1>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{fmtDate()}</p>
      </div>

      {/* ── Hero profit card ────────────────────────────────────────── */}
      <div className="rounded-3xl px-6 py-6 text-white relative overflow-hidden shadow-hero"
        style={{ background: "linear-gradient(145deg,#059669 0%,#047857 55%,#065f46 100%)" }}>
        {/* decorative circles */}
        <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute -bottom-14 -left-10 w-48 h-48 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute top-6 right-24  w-14 h-14 rounded-full bg-white/5 pointer-events-none" />

        <div className="relative">
          <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest">{t("home.todayProfit")}</p>

          {loading ? (
            <div className="h-12 w-44 bg-white/20 rounded-xl animate-pulse mt-2 mb-5" />
          ) : (
            <p className={`text-4xl font-black tracking-tight mt-1.5 mb-5 tabular ${profit < 0 ? "text-red-300" : "text-white"}`}>
              {profit < 0 && "−"}{fmt(Math.abs(profit))}
            </p>
          )}

          <div className="flex gap-5">
            <div>
              <p className="text-[10px] font-semibold text-white/60 uppercase tracking-widest mb-0.5">{t("home.cashIn")}</p>
              <p className="text-base font-bold tabular">{loading ? "—" : fmt(cashIn)}</p>
            </div>
            <div className="w-px bg-white/20 self-stretch" />
            <div>
              <p className="text-[10px] font-semibold text-white/60 uppercase tracking-widest mb-0.5">{t("home.cashOut")}</p>
              <p className="text-base font-bold tabular">{loading ? "—" : fmt(cashOut)}</p>
            </div>
            <div className="w-px bg-white/20 self-stretch" />
            <div>
              <p className="text-[10px] font-semibold text-white/60 uppercase tracking-widest mb-0.5">{t("home.txns")}</p>
              <p className="text-base font-bold tabular">{loading ? "—" : todayTx.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── 4 stat cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard label={t("home.cashIn")}       value={fmt(cashIn)}      icon={P.in}     iconBg="bg-green-100 dark:bg-green-900/40" iconColor="#16a34a" loading={loading} onClick={() => setTab("transactions")} />
        <StatCard label={t("home.cashOut")}      value={fmt(cashOut)}     icon={P.out}    iconBg="bg-red-100 dark:bg-red-900/40"   iconColor="#ef4444" loading={loading} onClick={() => setTab("transactions")} />
        <StatCard label={t("home.pendingCredit")} value={fmt(totalCredit)} icon={P.credit} iconBg="bg-amber-100 dark:bg-amber-900/40" iconColor="#d97706"
          sub={overdueCount > 0 ? `⚠ ${overdueCount} ${t("home.overdueLabel")}` : `${credits.length} ${t("home.recordsLabel")}`} loading={loading} onClick={() => setTab("credit")} />
        <StatCard label={t("home.asoBalance")}   value={fmt(totalAso)}    icon={P.bank}   iconBg="bg-blue-100 dark:bg-blue-900/40" iconColor="#2563eb"
          sub={`${asoClients.length} ${t("home.clientsLabel")}`} loading={loading} onClick={() => setTab("aso")} />
      </div>

      {/* ── Quick Actions ────────────────────────────────────────────── */}
      <div>
        <h2 className="text-[13px] font-bold text-slate-700 dark:text-slate-300 mb-3 tracking-wide">{t("home.quickActions")}</h2>
        <div className="grid grid-cols-3 gap-y-4 gap-x-2">
          <ActionBtn label={t("home.voiceRecord")} icon={P.mic}    bg="bg-gradient-to-br from-green-500 to-green-600"  iconColor="white" onClick={() => onVoiceOpen?.()} />
          <ActionBtn label={t("home.cashIn")}      icon={P.in}     bg="bg-gradient-to-br from-green-500 to-emerald-600" iconColor="white" onClick={() => onQuickAction?.("transactions","in")} />
          <ActionBtn label={t("home.cashOut")}     icon={P.out}    bg="bg-gradient-to-br from-red-500 to-red-600"       iconColor="white" onClick={() => onQuickAction?.("transactions","out")} />
          <ActionBtn label={t("home.payBills")}    icon={P.bills}  bg="bg-gradient-to-br from-cyan-500 to-teal-600"     iconColor="white" onClick={() => setTab("bills")} />
          <ActionBtn label={t("home.creditSale")}  icon={P.credit} bg="bg-gradient-to-br from-amber-400 to-amber-500"   iconColor="white" onClick={() => onQuickAction?.("credit")} />
          <ActionBtn label={t("home.asoClient")}   icon={P.bank}   bg="bg-gradient-to-br from-blue-500 to-blue-600"     iconColor="white" onClick={() => onQuickAction?.("aso")} />
          <ActionBtn label={t("home.reports")}     icon={P.report} bg="bg-gradient-to-br from-purple-500 to-violet-600" iconColor="white" onClick={() => setTab("insights")} />
        </div>
      </div>

      {/* ── Sales Forecast ───────────────────────────────────────────── */}
      {!loading && forecast && <SalesForecastCard prediction={forecast} t={t} />}

      {/* ── Recent Transactions ──────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[13px] font-bold text-slate-700 dark:text-slate-300 tracking-wide">{t("home.recentTxns")}</h2>
          <button onClick={() => setTab("transactions")}
            className="text-xs text-brand-600 dark:text-brand-400 font-bold tracking-wide">
            {t("home.seeAll")}
          </button>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[1,2,3].map(i => (
              <div key={i} className="h-16 bg-white dark:bg-slate-800 rounded-2xl animate-pulse border border-slate-100 dark:border-slate-700/50" />
            ))}
          </div>
        ) : transactions.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/50">
            <div className="w-14 h-14 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center mx-auto mb-3">
              <Svg d={P.report} size={22} color="#94a3b8" sw={1.5} />
            </div>
            <p className="text-slate-500 dark:text-slate-400 text-sm font-semibold">{t("home.noTxns")}</p>
            <p className="text-slate-400 dark:text-slate-500 text-xs mt-1">{t("home.startRecord")}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {transactions.slice(0, 5).map(t => <TxRow key={t.id} t={t} />)}
          </div>
        )}
      </div>

    </div>
  );
}
