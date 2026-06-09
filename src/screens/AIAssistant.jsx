import { useState, useRef, useEffect } from "react";
import { today } from "../utils/helpers";
import { detectLanguage, getLang, respond } from "../utils/i18n";
import { APP_PAT, BIZ_PAT, APP_FAQ, BIZ_KB } from "../utils/aiKnowledge";

/* ── Speech language codes ──────────────────────────────────────── */
const SPEECH_LANG = { en: "en-NG", pidgin: "en-NG", ha: "ha", ig: "ig", yo: "yo" };

/* ── Quick-access questions ──────────────────────────────────────── */
const QUICK = [
  { label: "Today's Sales",    q: "How were today's sales?"                           },
  { label: "Total Profit",     q: "What is my total profit?"                          },
  { label: "Outstanding Credit", q: "Show my outstanding credit"                     },
  { label: "App Features",     q: "What can this app do for my business?"             },
  { label: "Stock Status",     q: "What is my stock status?"                          },
  { label: "Pricing Tips",     q: "What is a good pricing strategy for my business?"  },
  { label: "Best Sellers",     q: "What are my best selling items?"                   },
  { label: "Grow Business",    q: "How can I grow my business?"                       },
  { label: "Overdue Payments", q: "Any overdue payments?"                             },
];

function recentDate(transactions) {
  const sorted = [...transactions].sort(
    (a, b) => new Date(b.transaction_date) - new Date(a.transaction_date)
  );
  return sorted[0]?.transaction_date || "—";
}

/* ── Core analysis engine ────────────────────────────────────────── */
function analyzeQuery(query, { transactions = [], credits = [], asoClients = [], products = [] }) {
  const q = query.toLowerCase().trim();
  const lang = detectLanguage(q) || getLang();
  const todayStr = today();
  const now = new Date();

  /* ── APP FAQ ── */
  for (const { key, hits } of APP_PAT) {
    if (hits.some(h => q.includes(h))) {
      return (APP_FAQ[lang] || APP_FAQ.en)[key] || APP_FAQ.en[key];
    }
  }

  /* ── GENERAL BUSINESS KNOWLEDGE ── */
  for (const { key, hits } of BIZ_PAT) {
    if (hits.some(h => q.includes(h))) {
      return (BIZ_KB[lang] || BIZ_KB.en)[key] || BIZ_KB.en[key];
    }
  }

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
    const out       = products.filter(p => p.quantity === 0);
    const low       = products.filter(p => p.quantity > 0 && p.quantity <= (p.low_stock_threshold || 5));
    const good      = products.filter(p => p.quantity > (p.low_stock_threshold || 5));
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
  en:     "Hello! I'm your AI Business Assistant. I can answer questions about your real business data (sales, credit, stock, customers), give general business advice, and guide you through the app.\n\nTap a quick question below or type your own — you can also tap 🎤 to ask by voice!",
  pidgin: "Hello! I be your AI Business Assistant. I fit answer question about your real business data (sales, credit, stock, customers), give general business advice, and guide you for the app.\n\nTap any question or type wetin you want ask — you fit also tap 🎤 ask by voice!",
  ha:     "Sannu! Ni ne mataimakiyar kasuwancin AI. Zan iya amsa tambayoyi game da bayanan kasuwancin ku na ainihi, ba da shawarwarin kasuwanci na gaba ɗaya, da kuma jagorantar ku cikin app.\n\nDanna tambaya ko rubuta naku — kuna iya danna 🎤 don tambaya da murya!",
  ig:     "Nnọọ! Abụ m onye inyeaka azụmaahịa AI gị. Nwere ike aza ajụjụ banyere data azụmaahịa gị n'ezie, nye ndụmọdụ azụmaahịa n'ozuzu, na duzie gị n'ngwa.\n\nPị ajụjụ ma ọ bụ dee nke gị — ị nwere ike pịa 🎤 iji jụọ n'olu!",
  yo:     "Ẹ káàbọ̀! Èmi ni olùrànlọ́wọ́ isọwọ AI rẹ. Mo le dahun awọn ibeere nipa data isowo gidi rẹ, fun imọran isowo gbogbogbo, ati ṣe amọna rẹ nipasẹ app.\n\nTẹ ibeere tabi tẹ tirẹ silẹ — o tún le tẹ 🎤 láti béèrè nípa ohùn!",
};

/* ── Strip markdown for TTS ─────────────────────────────────────── */
function stripMd(text) {
  return text
    .replace(/\*\*/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .trim();
}

/* ── Main screen ─────────────────────────────────────────────────── */
export default function AIAssistant({ store, inventory, onClose, initialQuery = "" }) {
  const greeting = GREETINGS[getLang()] || GREETINGS.en;

  const [messages,  setMessages]  = useState([{ role: "assistant", text: greeting }]);
  const [input,     setInput]     = useState("");
  const [thinking,  setThinking]  = useState(false);
  const [listening, setListening] = useState(false);
  const [ttsOn,     setTtsOn]     = useState(false);

  const listRef   = useRef(null);
  const inputRef  = useRef(null);
  const askedRef  = useRef(false);
  const recogRef  = useRef(null);
  const ttsOnRef  = useRef(false);
  const askFnRef  = useRef(null);

  ttsOnRef.current = ttsOn;

  const hasSpeech = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  const hasTts    = "speechSynthesis" in window;

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, thinking]);

  function speakText(text) {
    if (!hasTts) return;
    window.speechSynthesis.cancel();
    const ut = new SpeechSynthesisUtterance(stripMd(text));
    ut.lang = SPEECH_LANG[getLang()] || "en-NG";
    ut.rate = 0.92;
    window.speechSynthesis.speak(ut);
  }

  function ask(query) {
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
      if (ttsOnRef.current) speakText(answer);
    }, 500);
  }

  askFnRef.current = ask;

  useEffect(() => {
    if (initialQuery && !askedRef.current) {
      askedRef.current = true;
      ask(initialQuery); // eslint-disable-line react-hooks/exhaustive-deps
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function startListening() {
    if (!hasSpeech) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r  = new SR();
    r.lang           = SPEECH_LANG[getLang()] || "en-NG";
    r.continuous     = false;
    r.interimResults = false;
    r.onresult = (e) => {
      setListening(false);
      askFnRef.current(e.results[0][0].transcript);
    };
    r.onerror = () => setListening(false);
    r.onend   = () => setListening(false);
    r.start();
    setListening(true);
    recogRef.current = r;
  }

  function stopListening() {
    recogRef.current?.stop();
    setListening(false);
  }

  function toggleTts() {
    if (ttsOn && hasTts) window.speechSynthesis.cancel();
    setTtsOn(v => !v);
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-50 dark:bg-slate-900 flex flex-col">

      {/* ── Header ── */}
      <div
        className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 shadow-sm flex-shrink-0"
        style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top, 0px))" }}>
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center flex-shrink-0">
          <span className="text-base leading-none">🤖</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-800 dark:text-white leading-tight">AI Business Assistant</p>
          <p className="text-[10px] text-slate-400 dark:text-slate-500">Business data · App guide · General advice</p>
        </div>

        {/* TTS toggle */}
        {hasTts && (
          <button
            onClick={toggleTts}
            title={ttsOn ? "Mute voice" : "Enable voice replies"}
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors flex-shrink-0 ${
              ttsOn
                ? "bg-brand-100 dark:bg-brand-900/40 text-brand-600 dark:text-brand-400"
                : "bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-500"
            }`}>
            {ttsOn ? (
              <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            )}
          </button>
        )}

        <button
          onClick={onClose}
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
        {messages.map((m, idx) => (
          <div key={idx} className={`flex items-end gap-2 ${m.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
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
              {m.role === "assistant" && hasTts && idx > 0 && (
                <button
                  onClick={() => speakText(m.text)}
                  className="mt-2 flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500 hover:text-brand-500 dark:hover:text-brand-400 transition-colors">
                  <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  </svg>
                  Listen
                </button>
              )}
            </div>
          </div>
        ))}
        {thinking && <TypingDots />}
        <div className="h-2" />
      </div>

      {/* ── Input bar ── */}
      <div
        className="px-4 py-3 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700 flex-shrink-0"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}>
        <div className="flex gap-2 items-center">

          {/* Mic button */}
          {hasSpeech && (
            <button
              onClick={listening ? stopListening : startListening}
              disabled={thinking}
              className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all active:scale-95 ${
                listening
                  ? "bg-red-500 text-white animate-pulse"
                  : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-brand-50 dark:hover:bg-brand-900/20 hover:text-brand-600 disabled:opacity-40"
              }`}>
              {listening ? (
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4">
                  <rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              )}
            </button>
          )}

          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && ask(input)}
            placeholder={listening ? "Listening… speak now" : "Ask about your business, the app, or business tips…"}
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

        {listening && (
          <p className="text-[11px] text-red-500 text-center mt-1.5 font-medium">
            🎤 Listening… tap the red button to stop
          </p>
        )}
      </div>
    </div>
  );
}
