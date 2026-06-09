import { useState } from "react";
import { useAI } from "../hooks/useAI";
import { filterByPeriod } from "../utils/helpers";
import { canDo } from "../utils/plans";
import { useT } from "../contexts/LanguageContext";

const SECTIONS = [
  { key: "insights",      label: "Key Insights",   color: "blue"   },
  { key: "warnings",      label: "Warnings",        color: "amber"  },
  { key: "opportunities", label: "Opportunities",   color: "green"  },
  { key: "actions",       label: "Action Items",    color: "purple" },
];

const COLOR_MAP = {
  blue:   "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300",
  amber:  "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300",
  green:  "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-300",
  purple: "bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800 text-purple-800 dark:text-purple-300",
};

const EMOJI = { insights: "📊", warnings: "⚠️", opportunities: "🚀", actions: "✅" };

const AI_QUICK = [
  { label: "Today's Sales",      q: "How were today's sales?"    },
  { label: "Total Profit",       q: "What is my total profit?"   },
  { label: "Outstanding Credit", q: "Show my outstanding credit" },
  { label: "Top Customers",      q: "Who are my top customers?"  },
  { label: "Stock Status",       q: "What is my stock status?"   },
];

export default function Insights({ store, plan = "starter", onUpgrade, staffName, onReports, onAIOpen }) {
  const { transactions, credits, asoClients } = store;
  const { loading, result, error, analyze }   = useAI();
  const [period, setPeriod] = useState("today");
  const isStaffView = Boolean(staffName);
  const t = useT();

  if (!canDo(plan, "aiInsights")) {
    return (
      <div className="px-4 pt-20 pb-28 flex flex-col items-center text-center screen-enter">
        <div className="w-24 h-24 bg-amber-50 dark:bg-amber-900/20 rounded-full flex items-center justify-center mb-5">
          <span className="text-5xl">✨</span>
        </div>
        <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-2">{t("insights.premiumReq")}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-2 max-w-xs leading-relaxed">
          {t("premium.aiDesc")}
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-6">{t("premium.subLine")}</p>
        <button onClick={onUpgrade}
          className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-3 rounded-2xl font-bold text-sm active:scale-95 transition-all shadow-md">
          {t("insights.upgradeBtn")}
        </button>
        {onReports && (
          <button onClick={onReports}
            className="mt-3 flex items-center gap-2 px-5 py-2.5 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 rounded-2xl font-bold text-sm active:scale-95 transition-all">
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>
            </svg>
            Generate Reports
          </button>
        )}
      </div>
    );
  }

  const handleAnalyze = () => {
    const tx      = filterByPeriod(transactions, period);
    const totalIn  = tx.filter((t) => t.type === "in").reduce((s, t) => s + t.amount, 0);
    const totalOut = tx.filter((t) => t.type === "out").reduce((s, t) => s + t.amount, 0);

    const itemCounts = {};
    tx.forEach((t) => { if (t.item_name) itemCounts[t.item_name] = (itemCounts[t.item_name] || 0) + 1; });
    const topItems = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]).map(([k]) => k);

    analyze({
      period,
      txCount:  tx.length,
      totalIn,
      totalOut,
      profit:   totalIn - totalOut,
      topItems,
      totalCreditOutstanding: credits.reduce((s, c) => s + c.outstanding, 0),
      overdueCredits:         credits.filter((c) => c.status === "overdue").length,
      asoClients:             asoClients.length,
      asoBalance:             asoClients.reduce((s, c) => s + c.current_balance, 0),
    });
  };

  return (
    <div className="px-4 pt-5 pb-28 screen-enter">

      {/* Header */}
      <div className="flex items-start justify-between mb-1 gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-white">
            {isStaffView ? t("insights.myPerf") : t("insights.title")}
          </h1>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
            {isStaffView ? `${staffName} · personal stats` : "Smart business analysis · No API key needed"}
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

      {/* ── AI Assistant card ── */}
      {onAIOpen && !isStaffView && (
        <div className="rounded-3xl overflow-hidden shadow-md mb-5"
          style={{ background: "linear-gradient(135deg,#1e293b 0%,#0f172a 100%)" }}>

          {/* Card header */}
          <div className="flex items-center justify-between px-4 pt-4 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center flex-shrink-0">
                <span className="text-base leading-none">🤖</span>
              </div>
              <div>
                <p className="text-sm font-bold text-white leading-tight">AI Business Assistant</p>
                <p className="text-[10px] text-white/50 leading-tight">Powered by your real business data</p>
              </div>
            </div>
            <button
              onClick={() => onAIOpen("")}
              className="bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold px-3.5 py-1.5 rounded-xl active:scale-95 transition-all flex-shrink-0">
              Open Chat
            </button>
          </div>

          {/* Quick-tap questions */}
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

      {/* Period selector */}
      <div className="flex gap-2 my-5">
        {["today", "week", "month"].map((p) => (
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

      {/* Analyze button */}
      <button onClick={handleAnalyze} disabled={loading}
        className={`w-full py-4 rounded-2xl font-bold text-sm mb-6 shadow-md transition-all active:scale-95 ${
          loading
            ? "bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed"
            : "bg-green-600 hover:bg-green-700 text-white"
        }`}>
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full spinner inline-block" />
            {t("insights.analyzing")}
          </span>
        ) : (
          t("insights.generate")
        )}
      </button>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-4 text-sm text-red-600 dark:text-red-400 text-center mb-4">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          {SECTIONS.map(({ key, label, color }) =>
            result[key]?.length > 0 ? (
              <div key={key} className={`rounded-2xl border p-4 ${COLOR_MAP[color]}`}>
                <p className="font-bold text-sm mb-2">{EMOJI[key]} {label}</p>
                <ul className="space-y-1.5">
                  {result[key].map((item, i) => (
                    <li key={i} className="text-xs flex gap-2">
                      <span className="mt-0.5 flex-shrink-0">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null
          )}
        </div>
      )}

      {!result && !loading && (
        <div className="text-center py-12">
          <div className="w-20 h-20 bg-amber-50 dark:bg-amber-900/20 rounded-full flex items-center justify-center mx-auto mb-5">
            <span className="text-4xl">✨</span>
          </div>
          <p className="text-slate-600 dark:text-slate-300 font-semibold text-sm">{t("insights.noResult")}</p>
          <p className="text-slate-400 dark:text-slate-500 text-xs mt-1 max-w-[220px] mx-auto">
            {t("insights.tapGenerate")}
          </p>
        </div>
      )}
    </div>
  );
}
