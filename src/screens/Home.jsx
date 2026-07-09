import { useState, useMemo } from "react";
import { fmt, today } from "../utils/helpers";
import { AmountDisplay } from "../components/shared/AmountDisplay";
import { NotificationBell } from "../components/NotificationCenter";
import { useT } from "../contexts/LanguageContext";
import AppLogo from "../components/AppLogo";
import { getSalesPrediction } from "../utils/predictions";
import ProfilePreviewModal from "../components/shared/ProfilePreviewModal";
import { useCampaigns } from "../hooks/useCampaigns";
import HomeBannerSlot from "../components/slots/HomeBannerSlot";
import PopupSlot from "../components/slots/PopupSlot";
import FeedCardSlot from "../components/slots/FeedCardSlot";
import UpsellInlineSlot from "../components/slots/UpsellInlineSlot";

function greetingKey() {
  const h = new Date().getHours();
  if (h < 12) return "greet.morning";
  if (h < 17) return "greet.afternoon";
  return "greet.evening";
}

/* ── Tiny SVG helper ──────────────────────────────────────────────── */
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
  mic:     "M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z|M19 10v2a7 7 0 01-14 0v-2|M12 19v4|M8 23h8",
  in:      "M12 19V5|M5 12l7-7 7 7",
  out:     "M12 5v14|M19 12l-7 7-7-7",
  credit:  "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2|M9 11a4 4 0 100-8 4 4 0 000 8|M23 21v-2a4 4 0 00-3-3.87|M16 3.13a4 4 0 010 7.75",
  bank:    "M3 22h18|M6 18v-7|M10 18v-7|M14 18v-7|M18 18v-7|M12 2L2 7h20L12 2z",
  invoice: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2|M9 5a2 2 0 002 2h2a2 2 0 002-2|M9 5a2 2 0 012-2h2a2 2 0 012 2|M9 13h6|M9 17h4",
  report:  "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z|M14 2v6h6|M16 13H8|M16 17H8|M10 9H8",
  person:  "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2|M12 11a4 4 0 100-8 4 4 0 000 8",
  eye:     "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z|M12 9a3 3 0 100 6 3 3 0 000-6z",
  eyeOff:  "M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24|M1 1l22 22",
};

const BILL_SERVICES = [
  { id: "mic",         label: "Mic Sale",    g1: "#059669", g2: "#065f46", mic: true },
  { id: "airtime",     label: "Airtime",     g1: "#ef4444", g2: "#dc2626", icon: "M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.67A2 2 0 012 .82h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 8.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" },
  { id: "data",        label: "Data",        g1: "#3b82f6", g2: "#1d4ed8", icon: "M1 6l11-4 11 4|M1 12l11-4 11 4|M1 18l11-4 11 4" },
  { id: "electricity", label: "Electricity", g1: "#f59e0b", g2: "#d97706", icon: "M13 2L3 14h9l-1 8 10-12h-9l1-8z" },
  { id: "cable",       label: "Cable TV",    g1: "#8b5cf6", g2: "#6d28d9", icon: "M2 7a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7z|M12 19v3|M8 22h8" },
  { id: "betting",     label: "Betting",     g1: "#10b981", g2: "#059669", icon: "M12 2a10 10 0 100 20A10 10 0 0012 2z|M12 8v4l3 3" },
];

/* ── Transaction row icon/color by type ───────────────────────────── */
function getTxStyle(tx) {
  if (tx.payment_type === "bill_payment") return { bg: "bg-cyan-100 dark:bg-cyan-900/30",   color: "#0891b2", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2|M9 5a2 2 0 002 2h2a2 2 0 002-2|M9 5a2 2 0 012-2h2a2 2 0 012 2|M9 13h6|M9 17h4" };
  if (tx.category === "credit sale")      return { bg: "bg-amber-100 dark:bg-amber-900/30", color: "#d97706", icon: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2|M9 11a4 4 0 100-8 4 4 0 000 8" };
  if (tx.category === "debt repayment")   return { bg: "bg-blue-100 dark:bg-blue-900/30",   color: "#2563eb", icon: "M3 22h18|M6 18v-7|M10 18v-7|M14 18v-7|M18 18v-7|M12 2L2 7h20L12 2z" };
  if (tx.type === "in")                   return { bg: "bg-green-100 dark:bg-green-900/30", color: "#16a34a", icon: "M12 19V5|M5 12l7-7 7 7" };
  return                                         { bg: "bg-red-100 dark:bg-red-900/30",     color: "#ef4444", icon: "M12 5v14|M19 12l-7 7-7-7" };
}

/* ── Recent transaction row — colored circle icons ────────────────── */
function TxRow({ tx }) {
  const isIn  = tx.type === "in";
  const style = getTxStyle(tx);
  return (
    <div className="flex items-center gap-3 bg-white dark:bg-slate-800 rounded-2xl px-4 py-3.5 shadow-card border border-slate-100 dark:border-slate-700/50">
      <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${style.bg}`}>
        <Svg d={style.icon} size={15} color={style.color} sw={2.5} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{tx.item_name || "Transaction"}</p>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">{tx.category} · {tx.payment_type}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className={`text-sm font-extrabold tabular ${isIn ? "text-green-600" : "text-red-500"}`}>
          {isIn ? "+" : "−"}{fmt(tx.amount)}
        </p>
        <p className="text-[10px] text-slate-300 dark:text-slate-600 mt-0.5">{tx.transaction_date}</p>
      </div>
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
          <AmountDisplay amount={projectedWeek} size="stat" align="left" style={{ marginBottom: 2 }} />
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{t("pred.projected")}</p>
          <p className="text-[11px] text-brand-600 dark:text-brand-400 font-semibold mt-1 truncate" style={{ minWidth: 0 }}>{fmt(thisWeekActual)} {t("pred.actualSoFar")}</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-card border border-slate-100 dark:border-slate-700/50">
          <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">{t("pred.thisMonth")}</p>
          <AmountDisplay amount={projectedMonth} size="stat" align="left" style={{ marginBottom: 2 }} />
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{t("pred.projected")}</p>
          <p className="text-[11px] text-brand-600 dark:text-brand-400 font-semibold mt-1 truncate" style={{ minWidth: 0 }}>{fmt(thisMonthActual)} {t("pred.actualSoFar")}</p>
        </div>
      </div>
    </div>
  );
}

/* ── Main ────────────────────────────────────────────────────────── */
export default function Home({ store, plan, setTab, onQuickAction, onVoiceOpen, notif }) {
  const { transactions, credits, asoClients, profile, loading } = store;
  const t = useT();
  const [balanceHidden,      setBalanceHidden]      = useState(false);
  const [search,             setSearch]             = useState("");
  const [showProfilePreview, setShowProfilePreview] = useState(false);
  const { slotMap, loading: camLoading, recordEvent } = useCampaigns(["home_banner","popup","feed_card","upsell_inline"]);
  const homeBanners  = slotMap.home_banner   || [];
  const popups       = slotMap.popup         || [];
  const feedCampaign = (slotMap.feed_card    || [])[0] ?? null;
  const upsells      = slotMap.upsell_inline || [];

  const todayTx     = transactions.filter(tx => tx.transaction_date === today());
  const cashIn      = todayTx.filter(tx => tx.type === "in" ).reduce((s, tx) => s + tx.amount, 0);
  const cashOut     = todayTx.filter(tx => tx.type === "out").reduce((s, tx) => s + tx.amount, 0);
  const profit      = cashIn - cashOut;
  const totalCredit  = credits.reduce((s, c) => s + c.outstanding, 0);
  const overdueCount = credits.filter(c => c.status === "overdue").length;
  const totalAso     = asoClients.reduce((s, c) => s + c.current_balance, 0);
  const forecast     = useMemo(() => getSalesPrediction(transactions), [transactions]);

  const PRIMARY_ACTIONS = [
    { label: t("home.cashIn"),  icon: P.in,      g1: "#16a34a", g2: "#059669", action: () => onQuickAction?.("transactions", "in")  },
    { label: t("home.cashOut"), icon: P.out,     g1: "#ef4444", g2: "#dc2626", action: () => onQuickAction?.("transactions", "out") },
    { label: "Invoice",         icon: P.invoice, g1: "#ec4899", g2: "#be185d", action: () => onQuickAction?.("finance", "invoices") },
    { label: "Credit",          icon: P.credit,  g1: "#d97706", g2: "#b45309", action: () => onQuickAction?.("credit")              },
  ];

  return (
    <div className="px-4 pt-5 pb-32 screen-enter space-y-4">

      {/* ── Top bar ──────────────────────────────────────────────── */}
      <div className="flex items-center -mx-4 px-4 pb-3 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700/60 shadow-sm sticky top-0 z-10 -mt-5 mb-1" style={{ paddingTop: "max(12px, env(safe-area-inset-top, 12px))" }}>
        <AppLogo className="h-8 w-auto flex-shrink-0" />
        <div className="flex-1 flex justify-center items-baseline gap-0.5 select-none">
          <span className="text-[18px] font-black tracking-tight text-slate-800 dark:text-white leading-none">Kudi</span>
          <span className="text-[18px] font-black tracking-tight leading-none"
            style={{ background: "linear-gradient(135deg,#16a34a,#059669)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>AI</span>
          <span className="text-[12px] font-bold text-slate-400 dark:text-slate-500 tracking-widest uppercase leading-none ml-1">Track</span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <NotificationBell unreadCount={notif?.unreadCount || 0} onClick={() => notif?.setOpen(true)} />
          <button onClick={() => setShowProfilePreview(true)} aria-label="Profile"
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

      {/* ── Hero card — greeting + profit + eye toggle ────────────── */}
      <div className="rounded-3xl px-5 pt-5 pb-6 text-white relative overflow-hidden shadow-hero"
        style={{ background: "linear-gradient(145deg,#059669 0%,#047857 55%,#065f46 100%)" }}>
        <div className="absolute -top-10 -right-10 w-36 h-36 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute -bottom-12 -left-8  w-44 h-44 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute top-4   right-20   w-12 h-12 rounded-full bg-white/5 pointer-events-none" />

        <div className="relative">
          {/* Greeting + eye toggle */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold text-white/70 mb-0.5">{t(greetingKey())} 👋</p>
              <p className="text-[15px] font-black text-white truncate">{profile.business_name || profile.owner_name || "Welcome"}</p>
            </div>
            <button
              onClick={() => setBalanceHidden(h => !h)}
              className="w-8 h-8 flex items-center justify-center rounded-xl bg-white/15 active:bg-white/25 active:scale-90 transition mt-0.5 flex-shrink-0 ml-3">
              <Svg d={balanceHidden ? P.eyeOff : P.eye} size={15} color="white" sw={2} />
            </button>
          </div>

          {/* Profit label + amount */}
          <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest">{t("home.todayProfit")}</p>
          {loading ? (
            <div className="h-11 w-40 bg-white/20 rounded-xl animate-pulse mt-2 mb-5" />
          ) : balanceHidden ? (
            <p className="text-[38px] font-black tracking-tight mt-1.5 mb-5 tabular leading-none text-white">₦ ••••••</p>
          ) : (
            <AmountDisplay amount={Math.abs(profit)} size="hero" align="left" style={{ color: profit < 0 ? '#fca5a5' : '#fff', marginTop: 6, marginBottom: 20 }} />
          )}

          {/* Sub-stats row */}
          <div className="flex gap-5">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold text-white/60 uppercase tracking-widest mb-0.5">{t("home.cashIn")}</p>
              {loading || balanceHidden
                ? <p className="text-base font-bold tabular">{loading ? "—" : "••••"}</p>
                : <AmountDisplay amount={cashIn} size="row" align="left" style={{ color: '#fff', fontWeight: 700 }} />
              }
            </div>
            <div className="w-px bg-white/20 self-stretch" />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold text-white/60 uppercase tracking-widest mb-0.5">{t("home.cashOut")}</p>
              {loading || balanceHidden
                ? <p className="text-base font-bold tabular">{loading ? "—" : "••••"}</p>
                : <AmountDisplay amount={cashOut} size="row" align="left" style={{ color: '#fff', fontWeight: 700 }} />
              }
            </div>
            <div className="w-px bg-white/20 self-stretch" />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold text-white/60 uppercase tracking-widest mb-0.5">{t("home.txns")}</p>
              <p className="text-base font-bold tabular">{loading ? "—" : todayTx.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Daily summary chip ──────────────────────────────────── */}
      {!loading && todayTx.length > 0 && (
        <div className="flex justify-center">
          <div className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[11px] font-bold border ${
            profit >= 0
              ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-100 dark:border-green-800/40"
              : "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-100 dark:border-red-800/40"
          }`}>
            <span>Today</span>
            <span className="opacity-40">·</span>
            <span>{todayTx.length} transaction{todayTx.length !== 1 ? "s" : ""}</span>
            <span className="opacity-40">·</span>
            <span>{profit >= 0 ? "+" : "−"}{fmt(Math.abs(profit))} net</span>
          </div>
        </div>
      )}

      {/* ── Quick Actions + Services (single card) ────────────────── */}
      <div className="bg-white dark:bg-slate-800 rounded-3xl p-4 shadow-card border border-slate-100 dark:border-slate-700/50">

        {/* 4 Primary action circles */}
        <div className="grid grid-cols-4 gap-2 mb-5">
          {PRIMARY_ACTIONS.map(a => (
            <button key={a.label} onClick={a.action}
              className="flex flex-col items-center gap-2 active:scale-90 transition-transform duration-150">
              <div className="w-[54px] h-[54px] rounded-2xl flex items-center justify-center shadow-sm"
                style={{ background: `linear-gradient(135deg,${a.g1},${a.g2})` }}>
                <Svg d={a.icon} size={22} color="white" sw={2} />
              </div>
              <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400 text-center leading-tight max-w-[56px]">
                {a.label}
              </span>
            </button>
          ))}
        </div>

        {/* Quick Services section */}
        <div className="border-t border-slate-100 dark:border-slate-700/60 pt-4">
          <div className="flex items-center justify-between mb-3.5">
            <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Quick Services</p>
            <button onClick={() => setTab("bills")}
              className="text-[11px] font-bold text-brand-600 dark:text-brand-400">See all</button>
          </div>
          <div className="grid grid-cols-3 gap-y-4">
            {BILL_SERVICES.map(s => (
              <button key={s.id}
                onClick={() => s.mic ? onVoiceOpen?.() : onQuickAction?.("bills", s.id)}
                className="flex flex-col items-center gap-2 active:scale-90 transition-transform duration-150">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm"
                  style={{ background: `linear-gradient(135deg,${s.g1},${s.g2})` }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                    stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {(s.mic ? P.mic : s.icon).split("|").map((d, i) => <path key={i} d={d} />)}
                  </svg>
                </div>
                <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 text-center leading-tight">
                  {s.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Scrollable stat chips ─────────────────────────────────── */}
      <div className="overflow-x-auto no-scrollbar -mx-4 px-4">
        <div className="flex gap-3 pb-1" style={{ width: "max-content" }}>

          <button onClick={() => setTab("transactions")}
            className="flex items-center gap-2.5 bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-800/40 rounded-2xl px-3.5 py-2.5 active:scale-95 transition-transform flex-shrink-0">
            <div className="w-8 h-8 rounded-xl bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
              <Svg d={P.in} size={14} color="#16a34a" sw={2.5} />
            </div>
            <div>
              <p className="text-[9px] font-bold text-green-600 dark:text-green-400 uppercase tracking-wider whitespace-nowrap">{t("home.cashIn")}</p>
              <p className="text-sm font-extrabold text-green-700 dark:text-green-300 tabular leading-tight">
                {loading ? "—" : fmt(cashIn)}
              </p>
            </div>
          </button>

          <button onClick={() => setTab("transactions")}
            className="flex items-center gap-2.5 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800/40 rounded-2xl px-3.5 py-2.5 active:scale-95 transition-transform flex-shrink-0">
            <div className="w-8 h-8 rounded-xl bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
              <Svg d={P.out} size={14} color="#ef4444" sw={2.5} />
            </div>
            <div>
              <p className="text-[9px] font-bold text-red-500 dark:text-red-400 uppercase tracking-wider whitespace-nowrap">{t("home.cashOut")}</p>
              <p className="text-sm font-extrabold text-red-600 dark:text-red-300 tabular leading-tight">
                {loading ? "—" : fmt(cashOut)}
              </p>
            </div>
          </button>

          <button onClick={() => onQuickAction?.("credit")}
            className="flex items-center gap-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800/40 rounded-2xl px-3.5 py-2.5 active:scale-95 transition-transform flex-shrink-0">
            <div className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
              <Svg d={P.credit} size={14} color="#d97706" sw={2.5} />
            </div>
            <div>
              <div className="flex items-center gap-1">
                <p className="text-[9px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider whitespace-nowrap">{t("home.pendingCredit")}</p>
                {overdueCount > 0 && <span className="text-red-500 text-[9px]">⚠</span>}
              </div>
              <p className="text-sm font-extrabold text-amber-700 dark:text-amber-300 tabular leading-tight">
                {loading ? "—" : fmt(totalCredit)}
              </p>
            </div>
          </button>

          <button onClick={() => onQuickAction?.("aso")}
            className="flex items-center gap-2.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/40 rounded-2xl px-3.5 py-2.5 active:scale-95 transition-transform flex-shrink-0">
            <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
              <Svg d={P.bank} size={14} color="#2563eb" sw={2.5} />
            </div>
            <div>
              <p className="text-[9px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider whitespace-nowrap">{t("home.ajoBalance")}</p>
              <p className="text-sm font-extrabold text-blue-700 dark:text-blue-300 tabular leading-tight">
                {loading ? "—" : fmt(totalAso)}
              </p>
            </div>
          </button>

        </div>
      </div>

      {/* ── Sales Forecast ───────────────────────────────────────── */}
      {!loading && forecast && <SalesForecastCard prediction={forecast} t={t} />}

      {/* ── Upsell inline slot ───────────────────────────────────── */}
      {upsells.length > 0 && (
        <UpsellInlineSlot campaign={upsells[0]} loading={camLoading} recordEvent={recordEvent} />
      )}

      {/* ── Home Banner slot ─────────────────────────────────────── */}
      <HomeBannerSlot campaigns={homeBanners} loading={camLoading} recordEvent={recordEvent} />

      {/* ── Recent Transactions ──────────────────────────────────── */}
      <div>
        {/* Search bar */}
        <div className="relative mb-3">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            type="search"
            placeholder="Search transactions, items, customers…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-2xl text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/40 transition"
          />
          {search && (
            <button onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
              <svg className="w-3 h-3 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          )}
        </div>

        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[13px] font-bold text-slate-700 dark:text-slate-300 tracking-wide">
            {search ? `Results for "${search}"` : t("home.recentTxns")}
          </h2>
          {!search && (
            <button onClick={() => setTab("transactions")} className="text-xs text-brand-600 dark:text-brand-400 font-bold">
              {t("home.seeAll")}
            </button>
          )}
        </div>

        {loading ? (
          <div className="space-y-2">
            {[1,2,3].map(i => (
              <div key={i} className="h-16 bg-white dark:bg-slate-800 rounded-2xl animate-pulse border border-slate-100 dark:border-slate-700/50" />
            ))}
          </div>
        ) : search ? (() => {
          const q = search.toLowerCase();
          const results = transactions.filter(tx =>
            tx.item_name?.toLowerCase().includes(q) ||
            tx.customer_name?.toLowerCase().includes(q) ||
            tx.category?.toLowerCase().includes(q) ||
            tx.payment_type?.toLowerCase().includes(q)
          ).slice(0, 10);
          return results.length === 0 ? (
            <div className="text-center py-8 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/50">
              <p className="text-slate-400 text-sm font-semibold">No transactions found</p>
              <p className="text-slate-300 dark:text-slate-600 text-xs mt-1">Try a different search term</p>
            </div>
          ) : (
            <div className="space-y-2">{results.map(tx => <TxRow key={tx.id} tx={tx} />)}</div>
          );
        })() : transactions.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/50">
            <div className="w-14 h-14 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center mx-auto mb-3">
              <Svg d={P.report} size={22} color="#94a3b8" sw={1.5} />
            </div>
            <p className="text-slate-500 dark:text-slate-400 text-sm font-semibold">{t("home.noTxns")}</p>
            <p className="text-slate-400 dark:text-slate-500 text-xs mt-1">{t("home.startRecord")}</p>
            <button
              onClick={() => onQuickAction?.("transactions", "in")}
              className="mt-4 px-5 py-2.5 rounded-xl text-xs font-bold text-white active:scale-95 transition"
              style={{ background: "linear-gradient(135deg,#16a34a,#059669)" }}>
              Record First Sale
            </button>
          </div>
        ) : (() => {
          const recent = transactions.slice(0, 5);
          const rows = [];
          recent.forEach((tx, i) => {
            rows.push(<TxRow key={tx.id} tx={tx} />);
            if (i === 2 && feedCampaign) {
              rows.push(<FeedCardSlot key={`fc-${feedCampaign.id}`} campaign={feedCampaign} recordEvent={recordEvent} />);
            }
          });
          return <div className="space-y-2">{rows}</div>;
        })()}
      </div>

      {showProfilePreview && (
        <ProfilePreviewModal
          profile={profile}
          plan={plan}
          onClose={() => setShowProfilePreview(false)}
        />
      )}

      {/* ── Popup slot ───────────────────────────────────────────── */}
      <PopupSlot campaigns={popups} loading={camLoading} recordEvent={recordEvent} />

    </div>
  );
}
