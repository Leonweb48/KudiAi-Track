import { useState, useRef, useEffect } from "react";
import { today } from "../utils/helpers";
import { detectLanguage, getLang, respond } from "../utils/i18n";

/* ── Quick-access questions ──────────────────────────────────────── */
const QUICK = [
  { label: "Today's Sales",      q: "How were today's sales?"         },
  { label: "Total Profit",       q: "What is my total profit?"        },
  { label: "Outstanding Credit", q: "Show my outstanding credit"      },
  { label: "Top Customers",      q: "Who are my top customers?"       },
  { label: "Stock Status",       q: "What is my stock status?"        },
  { label: "This Month",         q: "How are my monthly sales?"       },
  { label: "Best Sellers",       q: "What are my best selling items?" },
  { label: "Expenses",           q: "Show my expenses breakdown"      },
  { label: "Overdue Payments",   q: "Any overdue payments?"           },
];

function recentDate(transactions) {
  const sorted = [...transactions].sort((a, b) =>
    new Date(b.transaction_date) - new Date(a.transaction_date)
  );
  return sorted[0]?.transaction_date || "—";
}

/* ── Core analysis engine — detects intent, delegates translation ── */
function analyzeQuery(query, { transactions = [], credits = [], asoClients = [], products = [] }) {
  const q = query.toLowerCase().trim();
  const todayStr = today();
  const now = new Date();

  // Detect language from user's text; fall back to stored preference
  const lang = detectLanguage(q) || getLang();

  const monthOf = (t) => {
    const d = new Date(t.transaction_date);
    return { m: d.getMonth(), y: d.getFullYear() };
  };
  const thisMonthTx = transactions.filter(t => {
    const { m, y } = monthOf(t);
    return m === now.getMonth() && y === now.getFullYear();
  });
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthTx = transactions.filter(t => {
    const { m, y } = monthOf(t);
    return m === lastMonth.getMonth() && y === lastMonth.getFullYear();
  });

  /* ── TODAY'S SALES ── */
  if (
    q.includes("today") || q.includes("yau") || q.includes("oni") ||
    q.includes("taa ") || q.includes("oge") ||
    (q.includes("how were") && (q.includes("sale") || q.includes("day"))) ||
    q.includes("today sales") || q.includes("sales today")
  ) {
    const sales   = transactions.filter(t => t.transaction_date === todayStr && t.type === "in");
    const outs    = transactions.filter(t => t.transaction_date === todayStr && t.type === "out");
    const revenue = sales.reduce((s, t) => s + t.amount, 0);
    const expense = outs.reduce((s, t) => s + t.amount, 0);
    const top     = [...sales].sort((a, b) => b.amount - a.amount).slice(0, 3);
    return respond("todaySales", lang, {
      revenue, expense, profit: revenue - expense, sales, outs, top,
      lastDate: recentDate(transactions),
    });
  }

  /* ── TOTAL PROFIT ── */
  if (
    q.includes("profit") || q.includes("riba") || q.includes("uru") ||
    q.includes("ere ") || q.includes("overall") ||
    q.includes("total earn") || q.includes("total profit")
  ) {
    const allIn  = transactions.filter(t => t.type === "in").reduce((s, t) => s + t.amount, 0);
    const allOut = transactions.filter(t => t.type === "out").reduce((s, t) => s + t.amount, 0);
    const mIn    = thisMonthTx.filter(t => t.type === "in").reduce((s, t) => s + t.amount, 0);
    const mOut   = thisMonthTx.filter(t => t.type === "out").reduce((s, t) => s + t.amount, 0);
    const lmIn   = lastMonthTx.filter(t => t.type === "in").reduce((s, t) => s + t.amount, 0);
    const pct    = lmIn > 0 ? Math.round(((mIn - lmIn) / lmIn) * 100) : null;
    return respond("totalProfit", lang, { allIn, allOut, mIn, mOut, lmIn, pct });
  }

  /* ── OUTSTANDING CREDIT ── */
  if (
    q.includes("credit") || q.includes("outstanding") || q.includes("owe") ||
    q.includes("debt") || q.includes("bashi") || q.includes("gbese") ||
    q.includes("ugwo") || q.includes("bin ku")
  ) {
    const unpaid    = credits.filter(c => c.status !== "paid");
    const overdue   = credits.filter(c => c.status === "overdue");
    const totalOwed = unpaid.reduce((s, c) => s + (c.outstanding || 0), 0);
    const top3      = [...unpaid].sort((a, b) => (b.outstanding || 0) - (a.outstanding || 0)).slice(0, 3);
    return respond("credit", lang, { unpaid, overdue, totalOwed, top3 });
  }

  /* ── TOP CUSTOMERS ── */
  if (
    q.includes("customer") || q.includes("abokin") || q.includes("ndị ahịa") ||
    q.includes("onibara") || q.includes("loyal") || q.includes("best customer") ||
    q.includes("top customer")
  ) {
    const map = {};
    transactions
      .filter(t => t.type === "in" && t.customer_name)
      .forEach(t => {
        if (!map[t.customer_name]) map[t.customer_name] = { total: 0, count: 0 };
        map[t.customer_name].total += t.amount;
        map[t.customer_name].count += 1;
      });
    const sorted = Object.entries(map)
      .sort(([, a], [, b]) => b.total - a.total)
      .slice(0, 5);
    return respond("topCustomers", lang, { sorted });
  }

  /* ── STOCK STATUS ── */
  if (
    q.includes("stock") || q.includes("inventory") || q.includes("product") ||
    q.includes("kaya") || q.includes("ngwaahia") || q.includes("ile-oja") ||
    q.includes("kayan ajiya")
  ) {
    const out      = products.filter(p => p.quantity === 0);
    const low      = products.filter(p => p.quantity > 0 && p.quantity <= (p.low_stock_threshold || 5));
    const good     = products.filter(p => p.quantity > (p.low_stock_threshold || 5));
    const costVal   = products.reduce((s, p) => s + (p.cost_price || 0) * p.quantity, 0);
    const retailVal = products.reduce((s, p) => s + (p.selling_price || 0) * p.quantity, 0);
    return respond("stock", lang, { products, out, low, good, costVal, retailVal });
  }

  /* ── MONTHLY SALES ── */
  if (
    q.includes("month") || q.includes("monthly") || q.includes("this month") ||
    q.includes("wata") || q.includes("ọnwa") || q.includes("osu yi")
  ) {
    const mSales = thisMonthTx.filter(t => t.type === "in");
    const mExp   = thisMonthTx.filter(t => t.type === "out").reduce((s, t) => s + t.amount, 0);
    const mRev   = mSales.reduce((s, t) => s + t.amount, 0);
    const lmRev  = lastMonthTx.filter(t => t.type === "in").reduce((s, t) => s + t.amount, 0);
    const pct    = lmRev > 0 ? Math.round(((mRev - lmRev) / lmRev) * 100) : null;
    return respond("monthly", lang, { mSales, mRev, mExp, lmRev, pct });
  }

  /* ── EXPENSES ── */
  if (
    q.includes("expense") || q.includes("spending") || q.includes("cash out") ||
    q.includes("kashe") || q.includes("inawo") || q.includes("ejiri ego") ||
    q.includes("money comot")
  ) {
    const all    = transactions.filter(t => t.type === "out");
    const total  = all.reduce((s, t) => s + t.amount, 0);
    const mTotal = thisMonthTx.filter(t => t.type === "out").reduce((s, t) => s + t.amount, 0);
    const catMap = {};
    all.forEach(t => { catMap[t.category] = (catMap[t.category] || 0) + t.amount; });
    const topCats = Object.entries(catMap).sort(([, a], [, b]) => b - a).slice(0, 4);
    return respond("expenses", lang, { total, mTotal, topCats });
  }

  /* ── BEST SELLERS ── */
  if (
    q.includes("best sell") || q.includes("top item") || q.includes("top sell") ||
    q.includes("popular") || q.includes("most sold") || q.includes("dey sell pass") ||
    q.includes("ire kachasị") || q.includes("tita julo")
  ) {
    const itemMap = {};
    transactions
      .filter(t => t.type === "in" && t.item_name)
      .forEach(t => {
        if (!itemMap[t.item_name]) itemMap[t.item_name] = { total: 0, count: 0 };
        itemMap[t.item_name].total += t.amount;
        itemMap[t.item_name].count += 1;
      });
    const sorted = Object.entries(itemMap)
      .sort(([, a], [, b]) => b.total - a.total)
      .slice(0, 5);
    return respond("bestSellers", lang, { sorted });
  }

  /* ── OVERDUE ── */
  if (
    q.includes("overdue") || q.includes("late") || q.includes("missed") ||
    q.includes("wuce lokaci") || q.includes("agafeela oge") || q.includes("koja akoko")
  ) {
    const odCredits = credits.filter(c => c.status === "overdue");
    const odAso     = asoClients.filter(
      c => c.next_contribution_date && new Date() > new Date(c.next_contribution_date)
    );
    return respond("overdue", lang, { odCredits, odAso });
  }

  /* ── AJO / ASO ── */
  if (
    q.includes("ajo") || q.includes("aso") || q.includes("savings") ||
    q.includes("contribution") || q.includes("ajiya") || q.includes("ifowopamo")
  ) {
    const active      = asoClients.filter(c => c.status === "active");
    const totalBal    = asoClients.reduce((s, c) => s + (c.current_balance || 0), 0);
    const totalTarget = asoClients.reduce((s, c) => s + (c.target_amount || 0), 0);
    const overdue     = asoClients.filter(
      c => c.next_contribution_date && new Date() > new Date(c.next_contribution_date)
    );
    return respond("ajo", lang, { clients: asoClients, active, totalBal, totalTarget, overdue });
  }

  /* ── DEFAULT / HELP ── */
  return respond("help", lang, {});
}

/* ── Renders **bold** and line-breaks ────────────────────────────── */
function FormattedText({ text }) {
  return text.split("\n").map((line, i) => (
    <span key={i}>
      {i > 0 && <br />}
      {line.split(/\*\*([^*]+)\*\*/g).map((part, j) =>
        j % 2 === 1
          ? <strong key={j} className="font-bold">{part}</strong>
          : part
      )}
    </span>
  ));
}

/* ── Typing indicator ────────────────────────────────────────────── */
function TypingDots() {
  return (
    <div className="flex items-end gap-2">
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center flex-shrink-0">
        <span className="text-[11px] leading-none">🤖</span>
      </div>
      <div className="bg-white dark:bg-slate-800 px-4 py-3 rounded-2xl rounded-bl-md shadow-card border border-slate-100 dark:border-slate-700/60">
        <div className="flex gap-1.5 items-center h-3">
          {[0, 150, 300].map(d => (
            <div key={d} className="w-2 h-2 bg-brand-400 rounded-full animate-bounce"
              style={{ animationDelay: `${d}ms` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Greeting based on stored language ──────────────────────────── */
const GREETINGS = {
  en:     "Hello! I'm your AI Business Assistant. I analyse your real business data — sales, credit, stock, and customers — and give you clear answers in plain language.\n\nTap a quick question or type your own below.",
  pidgin: "Hello! I be your AI Business Assistant. I dey use your real business data — sales, credit, stock, and customers — give you clear answer for your language.\n\nTap any question or type wetin you want ask.",
  ha:     "Sannu! Ni ne mataimakiyar kasuwancin AI. Ina amfani da bayanan kasuwancin ku na ainihi — tallace-tallace, bashi, kaya, da abokan ciniki — don ba ku amsa a cikin harshan ku.\n\nDanna tambaya ko rubuta naku.",
  ig:     "Nnọọ! Abụ m onye inyeaka azụmaahịa AI gị. A na-eji data azụmaahịa gị n'ezie — ahịa, ugwọ, ngwaahịa, na ndị ahịa — na-aza gị n'asụsụ gị.\n\nPị ajụjụ ma ọ bụ dee nke gị.",
  yo:     "Ẹ káàbọ̀! Èmi ni olùrànlọ́wọ́ isọwọ AI rẹ. Mo n lo data isowo gidi rẹ — tita, gbese, ile-oja, ati onibara — lati fun ọ ni awọn idahun to kedere ninu ede rẹ.\n\nTẹ ibeere tabi tẹ tirẹ silẹ.",
};

/* ── Main screen ─────────────────────────────────────────────────── */
export default function AIAssistant({ store, inventory, onClose, initialQuery = "" }) {
  const greeting = GREETINGS[getLang()] || GREETINGS.en;

  const [messages, setMessages] = useState([{ role: "assistant", text: greeting }]);
  const [input,    setInput]    = useState("");
  const [thinking, setThinking] = useState(false);
  const listRef  = useRef(null);
  const inputRef = useRef(null);
  const askedRef = useRef(false);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, thinking]);

  useEffect(() => {
    if (initialQuery && !askedRef.current) {
      askedRef.current = true;
      ask(initialQuery); // eslint-disable-line react-hooks/exhaustive-deps
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ask = (query) => {
    const q = query.trim();
    if (!q || thinking) return;
    setMessages(prev => [...prev, { role: "user", text: q }]);
    setInput("");
    setThinking(true);
    setTimeout(() => {
      const products = inventory?.products || [];
      const answer = analyzeQuery(q, { ...store, products });
      setMessages(prev => [...prev, { role: "assistant", text: answer }]);
      setThinking(false);
    }, 500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-50 dark:bg-slate-900 flex flex-col">

      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 shadow-sm flex-shrink-0"
        style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top, 0px))" }}>
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center flex-shrink-0">
          <span className="text-base leading-none">🤖</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-800 dark:text-white leading-tight">AI Business Assistant</p>
          <p className="text-[10px] text-slate-400 dark:text-slate-500">Powered by your business data · replies in your language</p>
        </div>
        <button onClick={onClose}
          className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400 active:scale-95 transition-transform flex-shrink-0">
          <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* ── Quick question chips ── */}
      <div className="flex gap-2 px-4 py-2.5 overflow-x-auto no-scrollbar bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
        {QUICK.map(({ label, q }) => (
          <button key={label} onClick={() => ask(q)} disabled={thinking}
            className="flex-shrink-0 text-[11px] font-semibold bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-400 border border-brand-100 dark:border-brand-800 px-3 py-1.5 rounded-full whitespace-nowrap hover:bg-brand-100 dark:hover:bg-brand-900/40 disabled:opacity-50 transition-colors active:scale-95">
            {label}
          </button>
        ))}
      </div>

      {/* ── Chat messages ── */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.map((m, i) => (
          <div key={i} className={`flex items-end gap-2 ${m.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
            {m.role === "assistant" && (
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center flex-shrink-0 mb-0.5">
                <span className="text-[11px] leading-none">🤖</span>
              </div>
            )}
            <div className={`max-w-[82%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
              m.role === "user"
                ? "bg-brand-600 text-white rounded-br-md"
                : "bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 shadow-card border border-slate-100 dark:border-slate-700/60 rounded-bl-md"
            }`}>
              <FormattedText text={m.text} />
            </div>
          </div>
        ))}
        {thinking && <TypingDots />}
        <div className="h-2" />
      </div>

      {/* ── Input bar ── */}
      <div className="px-4 py-3 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700 flex-shrink-0"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}>
        <div className="flex gap-2 items-center">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && ask(input)}
            placeholder="Ask in English, Pidgin, Hausa, Igbo or Yoruba…"
            className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/60 text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:bg-white dark:focus:bg-slate-700"
          />
          <button
            onClick={() => ask(input)}
            disabled={!input.trim() || thinking}
            className="w-10 h-10 bg-brand-600 hover:bg-brand-700 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-400 rounded-xl flex items-center justify-center text-white transition-colors flex-shrink-0 active:scale-95">
            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" fill="currentColor" stroke="none" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
