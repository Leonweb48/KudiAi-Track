import { useState, useMemo } from "react";
import { filterByPeriod, fmt } from "../utils/helpers";
import { canDo, upgradeLabel, planRequiredLabel } from "../utils/plans";
import { useT } from "../contexts/LanguageContext";
import { getLang } from "../utils/i18n";
import { getSalesPrediction, getRestockData, getSlowMovers } from "../utils/predictions";

const CHAT_URL = "https://admin.kudiai.app/api/public/chat";
const SECRET   = "kuditrack-email-trigger-2026-amaya";

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
          <p className="text-xl font-extrabold text-slate-800 dark:text-slate-100 tabular leading-tight">{fmt(pred.projectedWeek)}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">{t("pred.projected")}</p>
          <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700/50">
            <p className="text-[11px] font-semibold text-brand-600 dark:text-brand-400">{fmt(pred.thisWeekActual)}</p>
            <p className="text-[10px] text-slate-400">{t("pred.actualSoFar")}</p>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-card border border-slate-100 dark:border-slate-700/50">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{t("pred.thisMonth")}</p>
          <p className="text-xl font-extrabold text-slate-800 dark:text-slate-100 tabular leading-tight">{fmt(pred.projectedMonth)}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">{t("pred.projected")}</p>
          <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700/50">
            <p className="text-[11px] font-semibold text-brand-600 dark:text-brand-400">{fmt(pred.thisMonthActual)}</p>
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
                className={`flex-1 py-1.5 rounded-xl text-[11px] font-bold transition-colors ${
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
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{p.name}</p>
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
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{p.name}</p>
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
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{p.name}</p>
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
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate flex-1">{p.name}</p>
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

const SPEECH_LANG = { en: "en-NG", pidgin: "en-NG", ha: "ha-NG", ig: "ig-NG", yo: "yo-NG" };

function speakInsight(text, lang) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text.replace(/\*\*/g, ""));
  utt.lang  = SPEECH_LANG[lang] || "en-NG";
  utt.rate  = 0.92;
  utt.pitch = 1.0;
  window.speechSynthesis.speak(utt);
}

/* ── Main Insights screen ────────────────────────────────────────── */
export default function Insights({ store, inventory, plan = "starter", onUpgrade, staffName, onReports, onAIOpen }) {
  const { transactions, credits, asoClients } = store;
  const products = useMemo(() => inventory?.products || [], [inventory]);
  const [period,    setPeriod]    = useState("today");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiInsight, setAiInsight] = useState("");
  const [aiError,   setAiError]   = useState("");
  const isStaffView  = Boolean(staffName);
  const isPremium    = canDo(plan, "aiInsights");
  const hasInventory = canDo(plan, "inventory");
  const t   = useT();
  const lang = getLang();

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
      const totalOut = tx.filter(t2 => t2.type === "out").reduce((s, t2) => s + t2.amount, 0);

      const itemCounts = {};
      tx.forEach(t2 => { if (t2.item_name) itemCounts[t2.item_name] = (itemCounts[t2.item_name] || 0) + 1; });
      const topItems = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);

      const creditOwed   = credits.reduce((s, c) => s + (c.outstanding || 0), 0);
      const overdueCount = credits.filter(c => c.status === "overdue").length;
      const ajoBal       = asoClients.reduce((s, c) => s + (c.current_balance || 0), 0);
      const outOfStock   = products.filter(p => p.quantity === 0).length;
      const lowStock     = products.filter(p => p.quantity > 0 && p.quantity <= (p.low_stock_threshold || 5)).length;

      const context = `Business: ${store.profile?.business_name || "Unknown"} | Period analysed: ${period}
${period.charAt(0).toUpperCase() + period.slice(1)} transactions: ${tx.length} | Sales: ₦${fmt(totalIn)} | Expenses: ₦${fmt(totalOut)} | Profit: ₦${fmt(totalIn - totalOut)}
Top selling items: ${topItems.join(", ") || "None recorded"}
Outstanding credit: ₦${fmt(creditOwed)} | Overdue credit customers: ${overdueCount}
Inventory: ${products.length} products | ${outOfStock} out of stock | ${lowStock} low stock
Ajo/savings balance: ₦${fmt(ajoBal)} across ${asoClients.length} clients`;

      const res = await fetch(CHAT_URL, {
        method:  "POST",
        headers: { "Content-Type": "application/json", "x-trigger-secret": SECRET },
        body:    JSON.stringify({
          message:         `Analyse my business performance for the ${period} period. Give me: key insights from the numbers, any warnings I should know about, growth opportunities I can act on, and 2–3 specific action items for this week. Be direct, practical, and encouraging.`,
          lang,
          businessContext: context,
          history:         [],
        }),
      });

      if (!res.ok) throw new Error("API error");
      const text = await res.text();
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
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 rounded-xl font-bold text-xs active:scale-95 transition-all mt-0.5">
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>
            </svg>
            Reports
          </button>
        )}
      </div>

      {/* ── Sales Prediction (all plans) ── */}
      {!isStaffView && prediction && <SalesPredictionSection pred={prediction} t={t} />}
      {!isStaffView && !prediction && !store.loading && (
        <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 text-center mb-5">
          <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">📈 {t("pred.title")}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{t("pred.noData")}</p>
        </div>
      )}

      {/* ── AI Assistant card (premium) ── */}
      {onAIOpen && !isStaffView && isPremium && (
        <div className="rounded-3xl overflow-hidden shadow-md mb-5"
          style={{ background: "linear-gradient(135deg,#1e293b 0%,#0f172a 100%)" }}>
          <div className="flex items-center justify-between px-4 pt-4 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center flex-shrink-0">
                <span className="text-base leading-none">✨</span>
              </div>
              <div>
                <p className="text-sm font-bold text-white leading-tight">KudiAI Business Assistant</p>
                <p className="text-[10px] text-white/50 leading-tight">Powered by Gemini · knows your real data</p>
              </div>
            </div>
            <button onClick={() => onAIOpen("")}
              className="bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold px-3.5 py-1.5 rounded-xl active:scale-95 transition-all flex-shrink-0">
              Open Chat
            </button>
          </div>
          <div className="px-4 pb-4 flex gap-2 overflow-x-auto no-scrollbar">
            {AI_QUICK.map(({ label, q }) => (
              <button key={label} onClick={() => onAIOpen(q)}
                className="flex-shrink-0 text-[11px] font-semibold bg-white/10 hover:bg-white/20 text-white/80 px-3 py-1.5 rounded-full whitespace-nowrap transition-colors active:scale-95">
                {label}
              </button>
            ))}
          </div>
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
                    className={`flex-1 py-2 rounded-xl font-bold text-xs transition-colors ${
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
                  <div className="flex items-center justify-between px-4 py-3"
                    style={{ background: "linear-gradient(135deg,#1e293b 0%,#0f172a 100%)" }}>
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs leading-none">✨</span>
                      </div>
                      <p className="text-sm font-bold text-white">Gemini AI Insight</p>
                    </div>
                    <button
                      onClick={() => speakInsight(aiInsight, lang)}
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
                <p className="text-xs text-purple-600 dark:text-purple-400 mt-0.5">{t("premium.aiDesc")}</p>
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
