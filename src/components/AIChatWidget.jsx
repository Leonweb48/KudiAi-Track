import { useState, useRef, useEffect } from "react";
import { fmt, today } from "../utils/helpers";
import { detectLanguage, getLang, respond } from "../utils/i18n";
import { APP_PAT, BIZ_PAT, APP_FAQ, BIZ_KB } from "../utils/aiKnowledge";
import { getSalesPrediction } from "../utils/predictions";

/* ── Re-use same engine as AIAssistant screen ──────────────────────── */
function analyzeQuery(query, { transactions = [], credits = [], asoClients = [], products = [] }) {
  const q = query.toLowerCase().trim();
  const lang = detectLanguage(q) || getLang();
  const todayStr = today();
  const now = new Date();

  for (const { key, hits } of APP_PAT) {
    if (hits.some(h => q.includes(h))) {
      return (APP_FAQ[lang] || APP_FAQ.en)[key] || APP_FAQ.en[key];
    }
  }
  for (const { key, hits } of BIZ_PAT) {
    if (hits.some(h => q.includes(h))) {
      return (BIZ_KB[lang] || BIZ_KB.en)[key] || BIZ_KB.en[key];
    }
  }

  const monthOf = (t) => { const d = new Date(t.transaction_date); return { m: d.getMonth(), y: d.getFullYear() }; };
  const thisMonthTx = transactions.filter(t => { const { m, y } = monthOf(t); return m === now.getMonth() && y === now.getFullYear(); });
  const lastMonth   = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthTx = transactions.filter(t => { const { m, y } = monthOf(t); return m === lastMonth.getMonth() && y === lastMonth.getFullYear(); });

  if (q.includes("today") || q.includes("today sales") || q.includes("sales today") || (q.includes("how were") && q.includes("sale"))) {
    const sales   = transactions.filter(t => t.transaction_date === todayStr && t.type === "in");
    const outs    = transactions.filter(t => t.transaction_date === todayStr && t.type === "out");
    const revenue = sales.reduce((s, t) => s + t.amount, 0);
    const expense = outs.reduce((s, t) => s + t.amount, 0);
    const top     = [...sales].sort((a, b) => b.amount - a.amount).slice(0, 3);
    return respond("todaySales", lang, { revenue, expense, profit: revenue - expense, sales, outs, top, lastDate: todayStr });
  }

  if (q.includes("predict") || q.includes("forecast") || q.includes("next week") || q.includes("next month")) {
    const pred = getSalesPrediction(transactions);
    if (!pred) return respond("help", lang, {});
    const fN = (n) => fmt(Math.round(n));
    const arrow = pred.trend === "up" ? "↑" : pred.trend === "down" ? "↓" : "→";
    const pctStr = pred.trendPct !== null ? ` ${arrow} ${Math.abs(pred.trendPct)}%` : "";
    return `**Sales Forecast** (28-day avg: ${fN(pred.avgDaily)}/day)\n\n📅 **This Week:** ${fN(pred.thisWeekActual)} → **${fN(pred.projectedWeek)}**\n📆 **This Month:** ${fN(pred.thisMonthActual)} → **${fN(pred.projectedMonth)}**\n\nTrend: ${pred.trend === "up" ? "📈 Growing" : pred.trend === "down" ? "📉 Declining" : "📊 Stable"}${pctStr}`;
  }

  if (q.includes("profit") || q.includes("total earn") || q.includes("overall")) {
    const allIn  = transactions.filter(t => t.type === "in").reduce((s, t) => s + t.amount, 0);
    const allOut = transactions.filter(t => t.type === "out").reduce((s, t) => s + t.amount, 0);
    const mIn    = thisMonthTx.filter(t => t.type === "in").reduce((s, t) => s + t.amount, 0);
    const mOut   = thisMonthTx.filter(t => t.type === "out").reduce((s, t) => s + t.amount, 0);
    return respond("totalProfit", lang, { allIn, allOut, mIn, mOut, lmIn: lastMonthTx.filter(t => t.type === "in").reduce((s, t) => s + t.amount, 0), pct: null });
  }

  if (q.includes("credit") || q.includes("outstanding") || q.includes("owe") || q.includes("debt")) {
    const unpaid    = credits.filter(c => c.status !== "paid");
    const overdue   = credits.filter(c => c.status === "overdue");
    const totalOwed = unpaid.reduce((s, c) => s + (c.outstanding || 0), 0);
    const top3      = [...unpaid].sort((a, b) => (b.outstanding || 0) - (a.outstanding || 0)).slice(0, 3);
    return respond("credit", lang, { unpaid, overdue, totalOwed, top3 });
  }

  if (q.includes("stock") || q.includes("inventory") || q.includes("product")) {
    const out       = products.filter(p => p.quantity === 0);
    const low       = products.filter(p => p.quantity > 0 && p.quantity <= (p.low_stock_threshold || 5));
    const good      = products.filter(p => p.quantity > (p.low_stock_threshold || 5));
    const costVal   = products.reduce((s, p) => s + (p.cost_price || 0) * p.quantity, 0);
    const retailVal = products.reduce((s, p) => s + (p.selling_price || 0) * p.quantity, 0);
    return respond("stock", lang, { products, out, low, good, costVal, retailVal });
  }

  if (q.includes("month") || q.includes("monthly")) {
    const mRev  = thisMonthTx.filter(t => t.type === "in").reduce((s, t) => s + t.amount, 0);
    const mExp  = thisMonthTx.filter(t => t.type === "out").reduce((s, t) => s + t.amount, 0);
    const lmRev = lastMonthTx.filter(t => t.type === "in").reduce((s, t) => s + t.amount, 0);
    const pct   = lmRev > 0 ? Math.round(((mRev - lmRev) / lmRev) * 100) : null;
    return respond("monthly", lang, { mSales: thisMonthTx.filter(t => t.type === "in"), mRev, mExp, lmRev, pct });
  }

  if (q.includes("ajo") || q.includes("aso") || q.includes("savings") || q.includes("contribution")) {
    const active      = asoClients.filter(c => c.status === "active");
    const totalBal    = asoClients.reduce((s, c) => s + (c.current_balance || 0), 0);
    const totalTarget = asoClients.reduce((s, c) => s + (c.target_amount || 0), 0);
    const overdue     = asoClients.filter(c => c.next_contribution_date && new Date() > new Date(c.next_contribution_date));
    return respond("ajo", lang, { clients: asoClients, active, totalBal, totalTarget, overdue });
  }

  return respond("help", lang, {});
}

function FormattedText({ text }) {
  return text.split("\n").map((line, i) => (
    <span key={i}>
      {i > 0 && <br />}
      {line.split(/\*\*([^*]+)\*\*/g).map((part, j) =>
        j % 2 === 1 ? <strong key={j} className="font-semibold">{part}</strong> : part
      )}
    </span>
  ));
}

const QUICK = [
  { label: "Today's Sales",    q: "How were today's sales?"         },
  { label: "Total Profit",     q: "What is my total profit?"        },
  { label: "Outstanding",      q: "Show my outstanding credit"      },
  { label: "Stock Status",     q: "What is my stock status?"        },
  { label: "Monthly Summary",  q: "Show my monthly sales summary"   },
  { label: "Forecast",         q: "Show my sales forecast"          },
];

const GREETING = "Hi! I'm your KudiAI assistant. Ask me about your sales, credit, stock, or anything about the app.";

export default function AIChatWidget({ store, inventory }) {
  const [open,     setOpen]     = useState(false);
  const [messages, setMessages] = useState([{ role: "assistant", text: GREETING }]);
  const [input,    setInput]    = useState("");
  const [thinking, setThinking] = useState(false);

  const listRef  = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, thinking]);

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [open]);

  function ask(query) {
    const q = query.trim();
    if (!q || thinking) return;
    setMessages(prev => [...prev, { role: "user", text: q }]);
    setInput("");
    setThinking(true);
    setTimeout(() => {
      const products = inventory?.products || [];
      const answer = analyzeQuery(q, { ...(store || {}), products });
      setMessages(prev => [...prev, { role: "assistant", text: answer }]);
      setThinking(false);
    }, 480);
  }

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input); }
  };

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-20 right-4 z-[55] w-13 h-13 rounded-full shadow-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white transition-transform active:scale-90"
          style={{ width: 52, height: 52 }}
          aria-label="Open AI Assistant"
        >
          <span className="text-xl leading-none">🤖</span>
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div className="fixed inset-x-0 bottom-0 z-[55] flex justify-center pointer-events-none">
          <div
            className="w-full max-w-md bg-white dark:bg-slate-900 rounded-t-2xl shadow-2xl border border-slate-200 dark:border-slate-700 flex flex-col pointer-events-auto"
            style={{ height: "72vh", maxHeight: 560 }}
          >
            {/* Header */}
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center flex-shrink-0">
                <span className="text-sm leading-none">🤖</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-800 dark:text-white leading-tight">KudiAI Assistant</p>
                <p className="text-[10px] text-green-500 font-medium">Online · Always available</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="w-3.5 h-3.5">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Messages */}
            <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
              {messages.map((m, i) => (
                <div key={i} className={`flex items-end gap-2 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                  {m.role === "assistant" && (
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center flex-shrink-0 self-end">
                      <span className="text-[10px] leading-none">🤖</span>
                    </div>
                  )}
                  <div
                    className={`max-w-[82%] px-3 py-2 rounded-2xl text-xs leading-relaxed ${
                      m.role === "user"
                        ? "bg-brand-500 text-white rounded-br-sm"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-bl-sm border border-slate-200 dark:border-slate-700"
                    }`}
                  >
                    <FormattedText text={m.text} />
                  </div>
                </div>
              ))}
              {thinking && (
                <div className="flex items-end gap-2">
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center flex-shrink-0">
                    <span className="text-[10px] leading-none">🤖</span>
                  </div>
                  <div className="bg-slate-100 dark:bg-slate-800 px-3 py-2 rounded-2xl rounded-bl-sm border border-slate-200 dark:border-slate-700">
                    <div className="flex gap-1 items-center h-3">
                      {[0, 150, 300].map(d => (
                        <div key={d} className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Quick chips */}
            {messages.length <= 2 && (
              <div className="px-3 py-2 border-t border-slate-100 dark:border-slate-700/60 flex-shrink-0">
                <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                  {QUICK.map(({ label, q }) => (
                    <button
                      key={label}
                      onClick={() => ask(q)}
                      className="flex-shrink-0 px-2.5 py-1 rounded-full bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 text-[10px] font-medium border border-brand-100 dark:border-brand-800 whitespace-nowrap"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Input */}
            <div className="px-3 py-3 border-t border-slate-100 dark:border-slate-700 flex items-center gap-2 flex-shrink-0"
              style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}>
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Ask anything about your business…"
                className="flex-1 px-3 py-2 rounded-xl text-xs bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 border border-transparent focus:border-brand-300 dark:focus:border-brand-600 outline-none"
              />
              <button
                onClick={() => ask(input)}
                disabled={!input.trim() || thinking}
                className="w-8 h-8 rounded-xl bg-brand-500 disabled:bg-slate-200 dark:disabled:bg-slate-700 flex items-center justify-center transition-colors"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
                  className="w-3.5 h-3.5 text-white disabled:text-slate-400">
                  <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
