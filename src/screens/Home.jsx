import { useState, useMemo, useEffect, useCallback } from "react";
import { fmt, today } from "../utils/helpers";
import { compute } from "../lib/profitEngine";
import { supabase } from "../utils/supabase";
import { AmountDisplay } from "../components/shared/AmountDisplay";
import { TxRow } from "../components/shared/TxRow";
import { useT } from "../contexts/LanguageContext";
import AppLogo from "../components/AppLogo";
import { getSalesPrediction } from "../utils/predictions";
import ProfilePreviewModal from "../components/shared/ProfilePreviewModal";
import { useCampaigns } from "../hooks/useCampaigns";
import { usePartnerOffers } from "../hooks/usePartnerOffers";
import HomeBannerSlot from "../components/slots/HomeBannerSlot";
import PopupSlot from "../components/slots/PopupSlot";
import FeedCardSlot from "../components/slots/FeedCardSlot";
import NotificationCenter from "../components/NotificationCenter";
import { useToast } from "../components/Toast";
import UpsellInlineSlot from "../components/slots/UpsellInlineSlot";
import TabCardQuadSlot from "../components/slots/TabCardQuadSlot";
import TabCardDuoSlot from "../components/slots/TabCardDuoSlot";
import OffersSection from "../components/slots/OffersSection";
import AnnouncementBarSlot from "../components/slots/AnnouncementBarSlot";
import ReferralCard from "../components/ReferralCard";
import TransactionDetailModal from "../components/shared/TransactionDetailModal";
import { buildTransactionReceipt } from "../utils/receiptConfig";

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

/* Mic tile gets brand treatment; service tiles keep category-identifier colors via Tailwind */
const BILL_SERVICES = [
  { id: "mic",         label: "Mic Sale",    brand: true,  mic: true },
  { id: "airtime",     label: "Airtime",     bg: "from-red-500 to-red-600",        icon: "M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.67A2 2 0 012 .82h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 8.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" },
  { id: "data",        label: "Data",        bg: "from-blue-500 to-blue-700",       icon: "M1 6l11-4 11 4|M1 12l11-4 11 4|M1 18l11-4 11 4" },
  { id: "electricity", label: "Electricity", bg: "from-amber-400 to-amber-600",     icon: "M13 2L3 14h9l-1 8 10-12h-9l1-8z" },
  { id: "cable",       label: "Cable TV",    bg: "from-violet-500 to-violet-700",   icon: "M2 7a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7z|M12 19v3|M8 22h8" },
  { id: "betting",     label: "Betting",     bg: "from-emerald-500 to-emerald-600", icon: "M12 2a10 10 0 100 20A10 10 0 0012 2z|M12 8v4l3 3" },
];

/* getTxStyle and TxRow are imported from components/shared/TxRow */

/* ── Sales forecast card ─────────────────────────────────────────── */
function SalesForecastCard({ prediction, t, balanceHidden }) {
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
          {balanceHidden
            ? <p className="text-lg font-extrabold text-slate-800 dark:text-slate-100" style={{ fontVariantNumeric: "tabular-nums", marginBottom: 2 }}>••••••</p>
            : <AmountDisplay amount={projectedWeek} size="stat" align="left" style={{ marginBottom: 2 }} />}
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{t("pred.projected")}</p>
          <p className="text-[11px] text-brand-600 dark:text-brand-400 font-semibold mt-1 truncate" style={{ minWidth: 0 }}>{balanceHidden ? "••••" : fmt(thisWeekActual)} {t("pred.actualSoFar")}</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-card border border-slate-100 dark:border-slate-700/50">
          <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">{t("pred.thisMonth")}</p>
          {balanceHidden
            ? <p className="text-lg font-extrabold text-slate-800 dark:text-slate-100" style={{ fontVariantNumeric: "tabular-nums", marginBottom: 2 }}>••••••</p>
            : <AmountDisplay amount={projectedMonth} size="stat" align="left" style={{ marginBottom: 2 }} />}
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{t("pred.projected")}</p>
          <p className="text-[11px] text-brand-600 dark:text-brand-400 font-semibold mt-1 truncate" style={{ minWidth: 0 }}>{balanceHidden ? "••••" : fmt(thisMonthActual)} {t("pred.actualSoFar")}</p>
        </div>
      </div>
    </div>
  );
}

/* ── Main ────────────────────────────────────────────────────────── */
export default function Home({ store, inventory, invoiceHook, plan, setTab, onQuickAction, onVoiceOpen, onAIOpen }) {
  const { transactions, credits, asoClients, debtPayments, profile, loading } = store;
  const t      = useT();
  const toast  = useToast();
  const userId = profile?.id ?? null;

  const handleNotifNavigate = useCallback((dl) => {
    if (!dl?.tab) return;
    const target = (dl.tab === "credit" || dl.tab === "aso") ? "finance" : dl.tab;
    setTab(target);
  }, [setTab]);

  const [balanceHidden,      setBalanceHidden]      = useState(() => sessionStorage.getItem("kt_balance_hidden") === "1");
  const [search,             setSearch]             = useState("");
  const [receipt,            setReceipt]            = useState(null);
  const [showProfilePreview, setShowProfilePreview] = useState(false);
  const [todayAjo,           setTodayAjo]           = useState(0);
  const [showAITip,          setShowAITip]          = useState(() => !localStorage.getItem("kt_ai_intro_seen"));

  const toggleBalanceHidden = () => {
    const next = !balanceHidden;
    sessionStorage.setItem("kt_balance_hidden", next ? "1" : "0");
    setBalanceHidden(next);
  };

  useEffect(() => {
    if (!asoClients.length) return;
    const todayStart = new Date().toISOString().slice(0, 10) + "T00:00:00";
    supabase
      .from("ajo_contributions")
      .select("amount")
      .in("aso_client_id", asoClients.map(c => c.id))
      .eq("type", "contribution")
      .gte("created_at", todayStart)
      .then(({ data }) => setTodayAjo((data || []).reduce((s, c) => s + (parseFloat(c.amount) || 0), 0)))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asoClients.length]);

  const { slotMap, loading: camLoading, recordEvent } = useCampaigns(
    ["home_banner","popup","feed_card","upsell_inline","announcement_bar","tab_card_quad","tab_card_duo"],
    "business",
    "business.home",
  );
  const { offers: partnerOffers, loading: offersLoading, recordEvent: recordOfferEvent, ctaUrl } = usePartnerOffers("business");
  const homeBanners  = slotMap.home_banner      || [];
  const popups       = slotMap.popup            || [];
  const feedCampaign = (slotMap.feed_card       || [])[0] ?? null;
  const upsells      = slotMap.upsell_inline    || [];
  const annBars      = slotMap.announcement_bar || [];
  const tabCard = (slotMap.tab_card_quad || [])[0] ?? (slotMap.tab_card_duo || [])[0] ?? null;

  const todayTx = transactions.filter(tx => tx.transaction_date === today());
  const cashIn  = todayTx.filter(tx => tx.type === "in" ).reduce((s, tx) => s + tx.amount, 0);
  const cashOut = todayTx.filter(tx => tx.type === "out").reduce((s, tx) => s + tx.amount, 0);

  // Same ledger + engine as Finance page so "Today's Profit" matches Finance Net P&L
  const todayEngine = useMemo(() => {
    const s = new Date(); s.setHours(0, 0, 0, 0);
    const e = new Date(); e.setHours(23, 59, 59, 999);
    return compute({
      transactions,
      invoices:     invoiceHook?.invoices  || [],
      products:     inventory?.products    || [],
      asoClients,
      debtPayments: debtPayments           || [],
      credits,
    }, { from: s, to: e });
  }, [transactions, invoiceHook?.invoices, inventory?.products, asoClients, debtPayments, credits]);

  const profit        = todayEngine.profit.netProfit.amount;
  const todayExpenses = todayEngine.profit.expenses.amount;
  const todayRevenue  = todayEngine.profit.revenue.amount;
  const totalCredit  = credits.reduce((s, c) => s + c.outstanding, 0);
  const overdueCount = credits.filter(c => c.status === "overdue").length;
  const totalAso     = asoClients.reduce((s, c) => s + c.current_balance, 0);
  const forecast     = useMemo(() => getSalesPrediction(transactions), [transactions]);

  /* Quick actions — tap destinations frozen per Gate 0 ruling 6 */
  const PRIMARY_ACTIONS = [
    { label: "Record Sale",     icon: P.in,      action: () => onQuickAction?.("transactions", "in")                   },
    { label: "New Invoice",     icon: P.invoice, action: () => onQuickAction?.("finance", "invoices")                  },
    { label: "Pay Bills",       icon: P.report,  action: () => onQuickAction?.("bills")                                },
    { label: "Receive Payment", icon: P.bank,    action: () => onQuickAction?.("transactions", "in", "debt repayment") },
  ];

  return (
    <div className="px-4 pt-5 pb-32 screen-enter space-y-4">

      {/* ── Top bar ──────────────────────────────────────────────── */}
      <div className="flex items-center -mx-4 px-4 pb-3 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700/60 shadow-sm sticky top-0 z-10 -mt-5 mb-1" style={{ paddingTop: "max(12px, env(safe-area-inset-top, 12px))" }}>
        <AppLogo className="h-8 w-auto flex-shrink-0" />
        <div className="flex-1 flex justify-center items-baseline gap-0.5 select-none">
          <span className="text-[18px] font-black tracking-tight text-slate-800 dark:text-white leading-none">Kudi</span>
          <span className="text-[18px] font-black tracking-tight leading-none"
            style={{ background: "linear-gradient(135deg,var(--brand-green),var(--brand-green-dark))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>AI</span>
          <span className="text-[12px] font-bold text-slate-400 dark:text-slate-500 tracking-widest uppercase leading-none ml-1">Track</span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <NotificationCenter userId={userId} onNavigate={handleNotifNavigate} toast={toast} />
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

      {/* ── Announcement bar slot ────────────────────────────────── */}
      <AnnouncementBarSlot campaigns={annBars} loading={camLoading} recordEvent={recordEvent} />

      {/* ── Hero card — brand navy ─────────────────────────────────── */}
      <div className="rounded-3xl px-5 pt-5 pb-6 text-white relative overflow-hidden shadow-hero"
        style={{ background: "linear-gradient(145deg,var(--navy) 0%,var(--navy-mid) 55%,var(--navy-dark) 100%)" }}>
        <div className="absolute -top-10 -right-10 w-36 h-36 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute -bottom-12 -left-8  w-44 h-44 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute top-4   right-20   w-12 h-12 rounded-full bg-white/5 pointer-events-none" />

        <div className="relative">
          {/* Greeting + eye toggle (≥44px tile) */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold text-white/70 mb-0.5">{t(greetingKey())} 👋</p>
              <p className="text-[15px] font-black text-white truncate">{profile.business_name || profile.owner_name || "Welcome"}</p>
            </div>
            <button
              onClick={toggleBalanceHidden}
              aria-label={balanceHidden ? "Show balances" : "Hide balances"}
              className="w-11 h-11 flex items-center justify-center rounded-xl bg-white/15 active:bg-white/25 active:scale-90 transition mt-0.5 flex-shrink-0 ml-3">
              <Svg d={balanceHidden ? P.eyeOff : P.eye} size={15} color="white" sw={2} />
            </button>
          </div>

          {/* TODAY'S SALES — total inflows for the day */}
          <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest">TODAY'S SALES</p>
          {loading ? (
            <div className="h-11 w-40 bg-white/20 rounded-xl animate-pulse mt-2 mb-4" />
          ) : (
            <AmountDisplay
              amount={cashIn}
              size="hero"
              align="left"
              hidden={balanceHidden}
              className="mt-1.5 mb-4 text-white"
            />
          )}

          {/* Compact in/out line — brand-green in, white/70 out, txn count chip */}
          {loading ? (
            <div className="h-4 w-40 bg-white/20 rounded animate-pulse" />
          ) : (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-bold" style={{ color: "var(--brand-green)" }}>↑</span>
              <AmountDisplay
                amount={cashIn}
                size="small"
                align="left"
                hidden={balanceHidden}
                style={{ color: "var(--brand-green)", maxWidth: 84 }}
              />
              <span className="text-white/50 text-[10px]">in</span>
              <span className="text-white/30 text-[10px] mx-0.5">·</span>
              <span className="text-white/70 text-[11px] font-bold">↓</span>
              <AmountDisplay
                amount={cashOut}
                size="small"
                align="left"
                hidden={balanceHidden}
                style={{ color: "rgba(255,255,255,0.7)", maxWidth: 84 }}
              />
              <span className="text-white/50 text-[10px]">out</span>
              {todayTx.length > 0 && (
                <span className="text-[10px] text-white/40 ml-1">· {todayTx.length} txn{todayTx.length !== 1 ? "s" : ""}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Today's Profit / Deficit card ───────────────────────── */}
      {!loading && (
        <div className={`rounded-2xl px-4 py-3.5 flex items-center justify-between shadow-card border ${
          profit > 0
            ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-800/40"
            : profit < 0
              ? "bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-800/40"
              : "bg-slate-50 dark:bg-slate-800 border-slate-100 dark:border-slate-700/50"
        }`}>
          <div className="min-w-0">
            <p className={`text-[10px] font-bold uppercase tracking-widest mb-0.5 ${
              profit > 0 ? "text-emerald-500 dark:text-emerald-400"
                : profit < 0 ? "text-red-500 dark:text-red-400"
                  : "text-slate-400 dark:text-slate-500"
            }`}>
              {profit > 0 ? "Today's Profit" : profit < 0 ? "Today's Deficit" : "Break Even"}
            </p>
            <AmountDisplay
              amount={Math.abs(profit)}
              size="stat"
              align="left"
              hidden={balanceHidden}
              className={profit > 0 ? "text-emerald-700 dark:text-emerald-300" : profit < 0 ? "text-red-600 dark:text-red-400" : "text-slate-600 dark:text-slate-300"}
            />
          </div>
          <div className="flex flex-col items-end gap-0.5 flex-shrink-0 ml-3">
            <span className={`text-[10px] font-semibold ${
              profit > 0 ? "text-emerald-500 dark:text-emerald-400" : profit < 0 ? "text-red-400" : "text-slate-400"
            }`}>
              {profit > 0 ? "▲" : profit < 0 ? "▼" : "—"}
              {todayRevenue > 0 ? ` ${Math.round(Math.abs(profit) / todayRevenue * 100)}%` : ""}
            </span>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap">
              {balanceHidden ? "••••" : `Expenses: ${fmt(todayExpenses)}`}
            </p>
          </div>
        </div>
      )}
      {loading && (
        <div className="h-[62px] rounded-2xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
      )}

      {/* ── Ajo chip — today's collections (separate from profit) ─── */}
      {todayAjo > 0 && (
        <div className="flex justify-center">
          <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[11px] font-bold border bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-400 border-violet-100 dark:border-violet-800/40">
            <span>Ajo</span>
            <span className="opacity-40">·</span>
            <span>{balanceHidden ? "•••• collected today" : `${fmt(todayAjo)} collected today`}</span>
          </div>
        </div>
      )}

      {/* ── Stat strip — 3 fixed cards (hostile-data certified at 320px) ── */}
      {loading ? (
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-[68px] bg-white dark:bg-slate-800 rounded-2xl animate-pulse border border-slate-100 dark:border-slate-700/50" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">

          {/* This week — source: forecast.thisWeekActual from getSalesPrediction */}
          <button onClick={() => setTab("transactions")}
            className="flex flex-col gap-0.5 bg-white dark:bg-slate-800 rounded-2xl px-3 py-3 shadow-card border border-slate-100 dark:border-slate-700/50 active:scale-95 transition-transform text-left">
            <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider whitespace-nowrap">This Week</p>
            <AmountDisplay
              amount={forecast?.thisWeekActual ?? 0}
              size="stat"
              align="left"
              hidden={balanceHidden}
              className="text-slate-800 dark:text-slate-100"
            />
            <p className="text-[9px] text-slate-400 dark:text-slate-500 leading-none">Sales</p>
          </button>

          {/* Credit outstanding */}
          <button onClick={() => onQuickAction?.("credit")}
            className="flex flex-col gap-0.5 bg-white dark:bg-slate-800 rounded-2xl px-3 py-3 shadow-card border border-slate-100 dark:border-slate-700/50 active:scale-95 transition-transform text-left">
            <div className="flex items-center gap-1">
              <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider whitespace-nowrap">Credit</p>
              {overdueCount > 0 && <span className="text-[8px] text-red-500">⚠</span>}
            </div>
            <AmountDisplay
              amount={totalCredit}
              size="stat"
              align="left"
              hidden={balanceHidden}
              className="text-slate-800 dark:text-slate-100"
            />
            <p className="text-[9px] text-slate-400 dark:text-slate-500 leading-none">Outstanding</p>
          </button>

          {/* Ajo held */}
          <button onClick={() => onQuickAction?.("aso")}
            className="flex flex-col gap-0.5 bg-white dark:bg-slate-800 rounded-2xl px-3 py-3 shadow-card border border-slate-100 dark:border-slate-700/50 active:scale-95 transition-transform text-left">
            <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider whitespace-nowrap">Ajo</p>
            <AmountDisplay
              amount={totalAso}
              size="stat"
              align="left"
              hidden={balanceHidden}
              className="text-slate-800 dark:text-slate-100"
            />
            <p className="text-[9px] text-slate-400 dark:text-slate-500 leading-none">Held</p>
          </button>

        </div>
      )}

      {/* ── Quick Actions + Services (single card) ────────────────── */}
      <div className="bg-white dark:bg-slate-800 rounded-3xl p-4 shadow-card border border-slate-100 dark:border-slate-700/50">

        {/* 4 primary tiles — navy icon on light-green rounded-full; min 44px target */}
        <div className="grid grid-cols-4 gap-2 mb-5">
          {PRIMARY_ACTIONS.map(a => (
            <button key={a.label} onClick={a.action}
              className="flex flex-col items-center gap-2 active:scale-90 transition-transform duration-150 min-h-[44px] min-w-[44px] text-navy dark:text-white">
              <div className="w-14 h-14 rounded-full flex items-center justify-center shadow-sm bg-brand-50 dark:bg-navy/40">
                <Svg d={a.icon} size={22} color="currentColor" sw={2} />
              </div>
              <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400 text-center leading-tight max-w-[60px]">
                {a.label}
              </span>
            </button>
          ))}
        </div>

        {/* Quick Services — mic in slot 1 per ruling 6; bill tiles keep category colors */}
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
                <div
                  className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm ${s.bg ? `bg-gradient-to-br ${s.bg}` : ""}`}
                  style={s.brand ? { background: "linear-gradient(135deg,var(--brand-green),var(--brand-green-dark))" } : undefined}
                >
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

      {/* ── KudiAI Assistant entry ───────────────────────────────── */}
      <div className="relative">
        {showAITip && (
          <div className="bg-brand-50 dark:bg-brand-900/30 border border-brand-200 dark:border-brand-700/60 rounded-2xl px-4 py-3 mb-2 flex items-start gap-3 relative">
            <span className="text-xl leading-none mt-0.5">✨</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-brand-800 dark:text-brand-200">Ask me anything about your business</p>
              <p className="text-xs text-brand-600 dark:text-brand-400 mt-0.5">I speak English, Pidgin, Hausa, Igbo &amp; Yoruba</p>
            </div>
            <button
              onClick={() => { localStorage.setItem("kt_ai_intro_seen", "1"); setShowAITip(false); }}
              aria-label="Dismiss"
              className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-brand-400 dark:text-brand-500 hover:bg-brand-100 dark:hover:bg-brand-800/40 active:scale-90 transition-transform mt-0.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        <button
          onClick={() => { localStorage.setItem("kt_ai_intro_seen", "1"); setShowAITip(false); onAIOpen?.(); }}
          className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-3xl shadow-card border border-slate-100 dark:border-slate-700/50 active:scale-[0.98] transition-transform duration-150"
          style={{ background: "linear-gradient(135deg,var(--brand-green),var(--brand-green-dark))" }}>
          <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center flex-shrink-0">
            <span className="text-xl leading-none">✨</span>
          </div>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-[15px] font-black text-white leading-tight">KudiAI Assistant</p>
            <p className="text-[11px] text-green-100 mt-0.5">Ask anything · sales, credit, stock, ajo</p>
          </div>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" className="opacity-70 flex-shrink-0">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>

      {/* ── Tab card slot ────────────────────────────────────────── */}
      {tabCard && tabCard.slot === "tab_card_quad" && (
        <TabCardQuadSlot campaign={tabCard} pageKey="business.home" recordEvent={recordEvent} />
      )}
      {tabCard && tabCard.slot === "tab_card_duo" && (
        <TabCardDuoSlot campaign={tabCard} pageKey="business.home" recordEvent={recordEvent} />
      )}

      {/* ── Sales Forecast ───────────────────────────────────────── */}
      {!loading && forecast?.projectedWeek != null && <SalesForecastCard prediction={forecast} t={t} hidden={balanceHidden} />}

      {/* ── Upsell inline slot ───────────────────────────────────── */}
      <UpsellInlineSlot campaigns={upsells} loading={camLoading} recordEvent={recordEvent} />

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
              {t("home.seeAll")} →
            </button>
          )}
        </div>

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
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
            <div className="space-y-2">{results.map(tx => <TxRow key={tx.id} tx={tx} onClick={() => setReceipt(buildTransactionReceipt(tx, profile))} hidden={balanceHidden} />)}</div>
          );
        })() : transactions.length === 0 ? (
          /* ── Warm new-business empty state ── */
          <div className="text-center py-12 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/50">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
              style={{ background: "linear-gradient(135deg,var(--brand-green),var(--brand-green-dark))" }}>
              <Svg d={P.in} size={28} color="white" sw={2} />
            </div>
            <p className="text-slate-700 dark:text-slate-300 text-base font-bold mb-1">{t("home.noTxns")}</p>
            <p className="text-slate-400 dark:text-slate-500 text-sm px-8 mb-5">
              Record your first sale and watch this space come alive
            </p>
            <button
              onClick={() => onQuickAction?.("transactions", "in")}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-white active:scale-95 transition shadow-sm"
              style={{ background: "linear-gradient(135deg,var(--brand-green),var(--brand-green-dark))" }}>
              <Svg d={P.in} size={16} color="white" sw={2.5} />
              Record First Sale
            </button>
          </div>
        ) : (() => {
          const recent = transactions.slice(0, 5);
          const rows = [];
          recent.forEach((tx, i) => {
            rows.push(<TxRow key={tx.id} tx={tx} onClick={() => setReceipt(buildTransactionReceipt(tx, profile))} hidden={balanceHidden} />);
            if (i === 2 && feedCampaign) {
              rows.push(<FeedCardSlot key={`fc-${feedCampaign.id}`} campaign={feedCampaign} recordEvent={recordEvent} />);
            }
          });
          return <div className="space-y-2">{rows}</div>;
        })()}
      </div>

      {/* ── Refer & Earn ────────────────────────────────────────── */}
      <ReferralCard />

      {/* ── Partner Offers ───────────────────────────────────────── */}
      <OffersSection
        offers={partnerOffers}
        loading={offersLoading}
        recordEvent={recordOfferEvent}
        ctaUrl={ctaUrl}
        title="Offers for You"
      />

      {showProfilePreview && (
        <ProfilePreviewModal
          profile={profile}
          plan={plan}
          onClose={() => setShowProfilePreview(false)}
        />
      )}

      {/* ── Popup slot ───────────────────────────────────────────── */}
      <PopupSlot campaigns={popups} loading={camLoading} recordEvent={recordEvent} />

      {receipt && <TransactionDetailModal data={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}
