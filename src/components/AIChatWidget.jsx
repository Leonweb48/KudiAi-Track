import { useState, useRef, useEffect } from "react";
import { getLang } from "../utils/i18n";
import { buildContext } from "../utils/buildContext";

const CHAT_URL = "https://kuditrack-admin.vercel.app/api/public/chat";
const SECRET   = "kuditrack-email-trigger-2026-amaya";

const QUICK = [
  { label: "Today's Sales",    q: "How were today's sales?"                                   },
  { label: "Total Profit",     q: "What is my total profit?"                                  },
  { label: "Outstanding",      q: "Who owes me money and how much in total?"                  },
  { label: "Stock Status",     q: "What is my current stock status and what is running low?"  },
  { label: "Ajo Summary",      q: "Give me a full Ajo savings summary with all client details" },
  { label: "Monthly Report",   q: "Give me a full monthly business report"                    },
];

const GREETING = "Hi! I'm **KudiAI**, your AI business assistant powered by Gemini.\n\nAsk me anything about your sales, credit, stock, Ajo savings, staff, or branches — I know your real data!";

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

export default function AIChatWidget({ store, inventory, branches = [] }) {
  const [open,     setOpen]     = useState(false);
  const [messages, setMessages] = useState([{ role: "assistant", text: GREETING }]);
  const [input,    setInput]    = useState("");
  const [thinking, setThinking] = useState(false);

  const listRef  = useRef(null);
  const inputRef = useRef(null);
  const msgRef   = useRef(messages);
  msgRef.current = messages;

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, thinking]);

  useEffect(() => {
    if (open && inputRef.current) setTimeout(() => inputRef.current?.focus(), 150);
  }, [open]);

  async function ask(query) {
    const q = query.trim();
    if (!q || thinking) return;
    setMessages(prev => [...prev, { role: "user", text: q }]);
    setInput("");
    setThinking(true);

    try {
      const lang     = getLang();
      const products = inventory?.products || [];
      const context  = buildContext(store, products, branches);
      const history  = msgRef.current.slice(1).map(m => ({ role: m.role, text: m.text }));

      const res = await fetch(CHAT_URL, {
        method:  "POST",
        headers: { "Content-Type": "application/json", "x-trigger-secret": SECRET },
        body:    JSON.stringify({ message: q, lang, businessContext: context, history }),
      });

      let reply = "I couldn't get a response right now. Please try again.";
      if (res.ok) {
        const data = await res.json();
        if (data.reply) reply = data.reply;
      }
      setMessages(prev => [...prev, { role: "assistant", text: reply }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", text: "Network error. Please check your connection." }]);
    } finally {
      setThinking(false);
    }
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
                <span className="text-sm leading-none">✨</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-800 dark:text-white leading-tight">KudiAI Assistant</p>
                <p className="text-[10px] text-brand-500 dark:text-brand-400 font-medium">Powered by Gemini · knows your real data</p>
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
                      <span className="text-[10px] leading-none">✨</span>
                    </div>
                  )}
                  <div className={`max-w-[82%] px-3 py-2 rounded-2xl text-xs leading-relaxed ${
                    m.role === "user"
                      ? "bg-brand-500 text-white rounded-br-sm"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-bl-sm border border-slate-200 dark:border-slate-700"
                  }`}>
                    <FormattedText text={m.text} />
                  </div>
                </div>
              ))}
              {thinking && (
                <div className="flex items-end gap-2">
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center flex-shrink-0">
                    <span className="text-[10px] leading-none">✨</span>
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
                      disabled={thinking}
                      className="flex-shrink-0 px-2.5 py-1 rounded-full bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 text-[10px] font-medium border border-brand-100 dark:border-brand-800 whitespace-nowrap disabled:opacity-50"
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
                disabled={thinking}
                placeholder={thinking ? "KudiAI is thinking…" : "Ask anything about your business…"}
                className="flex-1 px-3 py-2 rounded-xl text-xs bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 border border-transparent focus:border-brand-300 dark:focus:border-brand-600 outline-none disabled:opacity-60"
              />
              <button
                onClick={() => ask(input)}
                disabled={!input.trim() || thinking}
                className="w-8 h-8 rounded-xl bg-brand-500 disabled:bg-slate-200 dark:disabled:bg-slate-700 flex items-center justify-center transition-colors active:scale-95"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                  <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" fill="white" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
