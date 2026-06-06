import { useState } from "react";
import { useAI } from "../hooks/useAI";
import { filterByPeriod } from "../utils/helpers";
import { canDo } from "../utils/plans";

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

export default function Insights({ store, plan = "starter", onUpgrade }) {
  const { transactions, credits, asoClients } = store;
  const { loading, result, error, analyze }   = useAI();
  const [period, setPeriod] = useState("today");

  if (!canDo(plan, "aiInsights")) {
    return (
      <div className="px-4 pt-20 pb-28 flex flex-col items-center text-center screen-enter">
        <div className="w-24 h-24 bg-amber-50 dark:bg-amber-900/20 rounded-full flex items-center justify-center mb-5">
          <span className="text-5xl">✨</span>
        </div>
        <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-2">Premium Plan Required</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-2 max-w-xs leading-relaxed">
          AI-powered business insights are exclusive to the Premium plan.
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-6">Get smart recommendations, warnings & growth opportunities.</p>
        <button onClick={onUpgrade}
          className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-3 rounded-2xl font-bold text-sm active:scale-95 transition-all shadow-md">
          Upgrade to Premium — ₦5,000/mo
        </button>
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
      <div className="mb-1">
        <h1 className="text-xl font-bold text-slate-800 dark:text-white">AI Insights</h1>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Smart business analysis · No API key needed</p>
      </div>

      {/* Period selector */}
      <div className="flex gap-2 my-5">
        {["today", "week", "month"].map((p) => (
          <button key={p} onClick={() => setPeriod(p)}
            className={`flex-1 py-2 rounded-xl font-bold text-xs transition-colors ${
              period === p
                ? "bg-slate-800 dark:bg-white text-white dark:text-slate-900"
                : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
            }`}>
            {p === "today" ? "Today" : p === "week" ? "This Week" : "This Month"}
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
            Analyzing your business…
          </span>
        ) : (
          "✨ Generate Insights"
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
          <p className="text-slate-600 dark:text-slate-300 font-semibold text-sm">No analysis yet</p>
          <p className="text-slate-400 dark:text-slate-500 text-xs mt-1 max-w-[220px] mx-auto">
            Tap "Generate Insights" to get personalized business advice based on your transactions
          </p>
        </div>
      )}
    </div>
  );
}
