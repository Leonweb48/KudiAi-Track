import { useState, useMemo } from "react";
import { filterByPeriod, fmt, isBillPayment } from "../utils/helpers";
import { AmountDisplay } from "../components/shared/AmountDisplay";
import { canDo, upgradeLabel, planRequiredLabel, getLowestPlanWithFeature } from "../utils/plans";
import { useT, useLanguage } from "../contexts/LanguageContext";
import { getSalesPrediction, getRestockData, getSlowMovers } from "../utils/predictions";
import { buildContext } from "../utils/buildContext";
import { askGemini } from "../utils/gemini";
import { speakText } from "../utils/tts";
import { useCampaigns } from "../hooks/useCampaigns";
import AnnouncementBarSlot from "../components/slots/AnnouncementBarSlot";

const AI_QUICK = [
  { label: "Today's Sales",      q: "How were today's sales?"    },
  { label: "Total Profit",       q: "What is my total profit?"   },
  { label: "Outstanding Credit", q: "Show my outstanding credit" },
  { label: "Top Customers",      q: "Who are my top customers?"  },
  { label: "Stock Status",       q: "What is my stock status?"   },
];

/* ── Sales Prediction section ────────────────────────────────────── */
function SalesPredictionSection({ pred, t }) {
  const trendColor = pred.trend === "up" ? "text-green-600 dark:text-green-400"
    : pred.trend === "down" ? "text-red-500 dark:text-red-400"
    : "text-slate-500 dark:text-slate-400";
  const trendBg = pred.trend === "up" ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700"
    : pred.trend === "down" ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700"
    : "bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-600";
  const trendIcon  = pred.trend === "up" ? "↑" : pred.trend === "down" ? "↓" : "→";
  const trendText  = pred.trend === "up" ? t("pred.growth") : pred.trend === "down" ? t("pred.decline") : t("pred.stable");
  const trendDetail = pred.trendPct !== null
    ? `${trendIcon} ${Math.abs(pred.trendPct)}% ${t("pred.vsLastWeeks")}`
    : `${trendIcon} ${trendText}`;

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
          📈 {t("pred.title")}
        </h2>
        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${trendBg} ${trendColor}`}>
          {trendDetail}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-card border border-slate-100 dark:border-slate-700/50">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{t("pred.thisWeek")}</p>
          <AmountDisplay amount={pred.projectedWeek} size="stat" align="left" style={{ marginBottom: 2 }} />
          <p className="text-[11px] text-slate-400 mt-0.5">{t("pred.projected")}</p>
          <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700/50">
            <p className="text-[11px] font-semibold text-brand-600 dark:text-brand-400 truncate" style={{ minWidth: 0 }}>{fmt(pred.thisWeekActual)}</p>
            <p className="text-[10px] text-slate-400">{t("pred.actualSoFar")}</p>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-card border border-slate-100 dark:border-slate-700/50">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{t("pred.thisMonth")}</p>
          <AmountDisplay amount={pred.projectedMonth} size="stat" align="left" style={{ marginBottom: 2 }} />
          <p className="text-[11px] text-slate-400 mt-0.5">{t("pred.projected")}</p>
          <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700/50">
            <p className="text-[11px] font-semibold text-brand-600 dark:text-brand-400 truncate" style={{ minWidth: 0 }}>{fmt(pred.thisMonthActual)}</p>
            <p className="text-[10px] text-slate-400">{t("pred.actualSoFar")}</p>
          </div>
        </div>
      </div>
      <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-2 text-center">
        {t("pred.avgDaily")}: {fmt(pred.avgDaily)}/day · based on 28-day data
      </p>
    </div>
  );
}

/* ── Smart Restock section ───────────────────────────────────────── */
function RestockSection({ data, t }) {
  const [tab, setTab] = useState("urgent");
  const { toRestock, fastMoving, lowStock } = data;

  const tabs = [
    { key: "urgent", label: t("restock.urgent"), count: toRestock.length },
    { key: "fast",   label: t("restock.fast"),   count: fastMoving.length },
    { key: "low",    label: t("restock.lowStock"), count: lowStock.length },
  ];

  const allEmpty = toRestock.length === 0 && fastMoving.length === 0 && lowStock.length === 0;

  return (
    <div className="mb-5">
      <h2 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-1.5">
        🔄 {t("restock.title")}
      </h2>

      {allEmpty ? (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-2xl p-4 text-center">
          <p className="text-sm text-green-700 dark:text-green-400 font-semibold">✅ {t("restock.empty")}</p>
        </div>
      ) : (
        <>
          {/* Tab selector */}
          <div className="flex gap-2 mb-3">
            {tabs.map(tb => (
              <button key={tb.key} onClick={() => setTab(tb.key)}
                className={`flex-1 py-3 min-h-[44px] flex items-center justify-center rounded-xl text-[11px] font-bold transition-colors ${
                  tab === tb.key
                    ? "bg-slate-800 dark:bg-white text-white dark:text-slate-900"
                    : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
                }`}>
                {tb.label}
                {tb.count > 0 && (
                  <span className={`ml-1 px-1 rounded-full text-[10px] ${tab === tb.key ? "bg-white/20" : "bg-slate-200 dark:bg-slate-600"}`}>
                    {tb.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Urgent restock */}
          {tab === "urgent" && (
            <div className="space-y-2">
              {toRestock.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-4">{t("restock.empty")}</p>
              ) : toRestock.map(p => (
                <div key={p.id} className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3 border border-orange-100 dark:border-orange-900/40 shadow-card">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{p.product_name || p.name}</p>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                        {p.quantity} left
                        {p.daysLeft !== null && ` · ~${p.daysLeft} ${t("restock.daysLeft")}`}
                        {p.monthlyQty > 0 && ` · ${p.monthlyQty} ${t("restock.soldMonth")}`}
                      </p>
                    </div>
                    <div className="flex-shrink-0 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700 rounded-xl px-2.5 py-1.5 text-right">
                      <p className="text-[10px] text-orange-600 dark:text-orange-400 font-semibold">{t("restock.order")}</p>
                      <p className="text-sm font-extrabold text-orange-700 dark:text-orange-300">{p.recommended} {t("restock.units")}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Fast moving */}
          {tab === "fast" && (
            <div className="space-y-2">
              {fastMoving.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-4">No fast-moving products yet</p>
              ) : fastMoving.map(p => (
                <div key={p.id} className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3 border border-green-100 dark:border-green-900/40 shadow-card flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{p.product_name || p.name}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">{p.quantity} in stock</p>
                  </div>
                  <div className="flex-shrink-0 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-xl px-2.5 py-1.5 text-right">
                    <p className="text-[10px] text-green-600 dark:text-green-400 font-semibold">{t("restock.fast")}</p>
                    <p className="text-sm font-extrabold text-green-700 dark:text-green-300">{p.monthlyQty} {t("restock.soldMonth")}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Low stock */}
          {tab === "low" && (
            <div className="space-y-2">
              {lowStock.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-4">{t("restock.empty")}</p>
              ) : lowStock.map(p => (
                <div key={p.id} className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3 border border-red-100 dark:border-red-900/40 shadow-card flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{p.product_name || p.name}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">Threshold: {p.low_stock_threshold || 5} units</p>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className={`text-lg font-extrabold tabular ${p.quantity === 0 ? "text-red-600" : "text-amber-500"}`}>
                      {p.quantity}
                    </p>
                    <p className="text-[10px] text-slate-400">{t("restock.units")} left</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Slow Moving Products section ────────────────────────────────── */
function SlowMoversSection({ items, t }) {
  return (
    <div className="mb-5">
      <div className="mb-3">
        <h2 className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
          ⚠️ {t("slow.title")}
        </h2>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{t("slow.subtitle")}</p>
      </div>

      {items.length === 0 ? (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-2xl p-4 text-center">
          <p className="text-sm text-green-700 dark:text-green-400 font-semibold">✅ {t("slow.empty")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(p => (
            <div key={p.id} className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3 border border-slate-100 dark:border-slate-700/50 shadow-card">
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate flex-1">{p.product_name || p.name}</p>
                <span className="flex-shrink-0 text-xs font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-full">
                  {p.quantity} {t("restock.units")}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                {p.lastSaleDate
                  ? `${t("slow.lastSold")}: ${p.daysSinceSale} ${t("slow.daysAgo")}`
                  : t("slow.neverSold")}
              </p>
              {p.discountPrice && p.discountPct && p.discountPct > 0 ? (
                <p className="text-[11px] text-purple-600 dark:text-purple-400 font-semibold mt-1">
                  💡 {t("slow.suggest")} {fmt(p.discountPrice)} ({p.discountPct}% {t("slow.off")})
                </p>
              ) : (
                <p className="text-[11px] text-purple-600 dark:text-purple-400 font-semibold mt-1">
                  💡 {t("slow.promote")}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Renders **bold** and line-breaks ─────────────────────────────── */
function FormattedText({ text }) {
  return text.split("\n").map((line, i) => (
    <span key={i}>
      {i > 0 && <br />}
      {line.split(/\*\*([^*]+)\*\*/g).map((part, j) =>
        j % 2 === 1 ? <strong key={j} className="font-bold">{part}</strong> : part
      )}
    </span>
  ));
}


/* ── Main Insights screen ────────────────────────────────────────── */
export default function Insights({ store, inventory, plan = "starter", onUpgrade, staffName, onReports, onAIOpen }) {
  const { transactions } = store;
  const products = useMemo(() => inventory?.products || [], [inventory]);
  const [period,    setPeriod]    = useState("today");
  const { slotMap, loading: camLoading, recordEvent } = useCampaigns(["announcement_bar", "upsell_inline"], "business", "business.insights");
  const annBars = slotMap.announcement_bar || [];
  const [aiLoading, setAiLoading] = useState(false);
  const [aiInsight, setAiInsight] = useState("");
  const [aiError,   setAiError]   = useState("");
  const isStaffView  = Boolean(staffName);
  const isPremium    = canDo(plan, "aiInsights");
  const hasInventory = canDo(plan, "inventory");
  const t          = useT();
  const { lang }   = useLanguage();

  const prediction  = useMemo(() => getSalesPrediction(transactions), [transactions]);
  const restockData = useMemo(() => getRestockData(products, transactions), [products, transactions]);
  const slowMovers  = useMemo(() => getSlowMovers(products, transactions),  [products, transactions]);

  const handleAnalyze = async () => {
    setAiLoading(true);
    setAiInsight("");
    setAiError("");

    try {
      const tx       = filterByPeriod(transactions, period);
      const totalIn  = tx.filter(t2 => t2.type === "in").reduce((s, t2) => s + t2.amount, 0);
      const totalOut = tx.filter(t2 => t2.type === "out" && !isBillPayment(t2)).reduce((s, t2) => s + t2.amount, 0);

      const itemCounts = {};
      tx.forEach(t2 => { if (t2.item_name) itemCounts[t2.item_name] = (itemCounts[t2.item_name] || 0) + 1; });
      const topItems = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);

      const fullContext = buildContext(store, products, []);
      const context = `${fullContext}

ANALYSIS PERIOD: ${period} | Period Sales: ₦${fmt(totalIn)} | Period Expenses: ₦${fmt(totalOut)} | Period Profit: ₦${fmt(totalIn - totalOut)} | Period Transactions: ${tx.length}
Top items this period: ${topItems.join(", ") || "None recorded"}`;

      const text = await askGemini({
        message: `You are KudiAI Business Assistant. Analyse my ${period} business data. You MUST complete ALL four sections below — do not stop or truncate mid-response.

**KEY METRICS**
2-3 most important numbers from this period with actual figures.

**⚠ ALERTS**
Any urgent risks or issues (1-2 items, or "None identified" if all is well).

**💡 OPPORTUNITIES**
1-2 specific growth actions based on my actual data.

**✅ ACTION ITEMS**
Exactly 2 things I should do this week.

Use real figures from my data. Each point: 1-2 sentences max. Complete every section.`,
        lang,
        context,
        history: [],
      });
      setAiInsight(text || "");
    } catch {
      setAiError("Could not generate insights. Please check your connection and try again.");
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="px-4 pt-5 pb-28 screen-enter">

      {/* ── Header ── */}
      <div className="flex items-start justify-between mb-4 gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-white">
            {isStaffView ? t("insights.myPerf") : t("insights.title")}
          </h1>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
            {isStaffView ? `${staffName} · personal stats` : "Smart analytics · AI insights · Reports"}
          </p>
        </div>
        {onReports && !isStaffView && (
          <button onClick={onReports}
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 min-h-[44px] bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 rounded-xl font-bold text-xs active:scale-95 transition-all mt-0.5">
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>
            </svg>
            Reports
          </button>
        )}
      </div>

      {/* ── Announcement bar slot ─────────────────────────────────── */}
      <AnnouncementBarSlot campaigns={annBars} loading={camLoading} recordEvent={recordEvent} />

      {/* ── AI Quick Shortcuts — most actionable, at top for premium users ── */}
      {onAIOpen && !isStaffView && isPremium && (
        <div className="mb-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
                <span className="text-[11px] leading-none">✨</span>
              </div>
              <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">KudiAI Business Assistant</p>
            </div>
            <button onClick={() => onAIOpen("")}
              className="text-[11px] font-bold text-brand-600 dark:text-brand-400 flex items-center gap-1 min-h-[44px] px-2 -mr-2">
              Open Chat
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 pb-1">
            {AI_QUICK.map(({ label, q }) => (
              <button key={label} onClick={() => onAIOpen(q)}
                className="flex-shrink-0 flex items-center gap-1.5 text-[11px] font-bold px-3.5 min-h-[44px] rounded-2xl whitespace-nowrap transition-all active:scale-95 shadow-sm bg-slate-800 dark:bg-slate-700 text-white">
                <span className="opacity-60">✦</span>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Sales Prediction (all plans) ── */}
      {!isStaffView && prediction && <SalesPredictionSection pred={prediction} t={t} />}
      {!isStaffView && !prediction && !store.loading && (
        <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 text-center mb-5">
          <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">📈 {t("pred.title")}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{t("pred.noData")}</p>
        </div>
      )}

      {/* ── AI Insights: period + generate (premium) or upgrade banner ── */}
      {!isStaffView && (
        <>
          {isPremium ? (
            <>
              <div className="flex gap-2 mb-5">
                {["today", "week", "month"].map(p => (
                  <button key={p} onClick={() => setPeriod(p)}
                    className={`flex-1 min-h-[44px] flex items-center justify-center rounded-xl font-bold text-xs transition-colors ${
                      period === p
                        ? "bg-slate-800 dark:bg-white text-white dark:text-slate-900"
                        : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
                    }`}>
                    {p === "today" ? t("insights.today") : p === "week" ? t("insights.week") : t("insights.month")}
                  </button>
                ))}
              </div>

              <button onClick={handleAnalyze} disabled={aiLoading}
                className={`w-full py-4 rounded-2xl font-bold text-sm mb-5 shadow-md transition-all active:scale-95 ${
                  aiLoading
                    ? "bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed"
                    : "bg-green-600 hover:bg-green-700 text-white"
                }`}>
                {aiLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full spinner inline-block" />
                    {t("insights.analyzing")}
                  </span>
                ) : t("insights.generate")}
              </button>

              {aiError && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-4 text-sm text-red-600 dark:text-red-400 text-center mb-4">
                  {aiError}
                </div>
              )}

              {aiInsight && (
                <div className="mb-5 rounded-3xl overflow-hidden border border-slate-200 dark:border-slate-700 shadow-card">
                  {/* Card header */}
                  <div className="flex items-center justify-between px-4 py-3 bg-[linear-gradient(135deg,#1e293b_0%,#0f172a_100%)]">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs leading-none">✨</span>
                      </div>
                      <p className="text-sm font-bold text-white">Gemini AI Insight</p>
                    </div>
                    <button
                      onClick={() => speakText(aiInsight, lang)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white/80 text-[11px] font-semibold transition-colors active:scale-95">
                      <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                      </svg>
                      Listen
                    </button>
                  </div>
                  {/* Insight body */}
                  <div className="bg-white dark:bg-slate-800 px-4 py-4 text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                    <FormattedText text={aiInsight} />
                  </div>
                </div>
              )}

              {!aiInsight && !aiLoading && (
                <div className="text-center py-8 mb-5">
                  <div className="w-16 h-16 bg-amber-50 dark:bg-amber-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-3xl">✨</span>
                  </div>
                  <p className="text-slate-600 dark:text-slate-300 font-semibold text-sm">{t("insights.noResult")}</p>
                  <p className="text-slate-400 dark:text-slate-500 text-xs mt-1 max-w-[220px] mx-auto">{t("insights.tapGenerate")}</p>
                </div>
              )}
            </>
          ) : (
            <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700 rounded-2xl p-4 flex items-center gap-3 mb-5">
              <span className="text-2xl flex-shrink-0">✨</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-purple-800 dark:text-purple-300">{planRequiredLabel("aiInsights")}</p>
                <p className="text-xs text-purple-600 dark:text-purple-400 mt-0.5">AI-powered business insights are available on the {getLowestPlanWithFeature("aiInsights")?.name ?? "higher"} plan.</p>
              </div>
              <button onClick={onUpgrade}
                className="flex-shrink-0 bg-purple-600 hover:bg-purple-700 text-white px-3 py-2 rounded-xl font-bold text-xs active:scale-95 transition-all">
                {upgradeLabel("aiInsights")}
              </button>
            </div>
          )}
        </>
      )}

      {/* ── Smart Restock (business + premium) ── */}
      {!isStaffView && hasInventory && products.length > 0 && (
        <RestockSection data={restockData} t={t} />
      )}

      {/* ── Slow Moving Products (business + premium) ── */}
      {!isStaffView && hasInventory && products.length > 0 && (
        <SlowMoversSection items={slowMovers} t={t} />
      )}

    </div>
  );
}
