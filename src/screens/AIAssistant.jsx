import { useState, useRef, useEffect } from "react";
import { useLanguage, useT } from "../contexts/LanguageContext";
import { buildContext } from "../utils/buildContext";
import { askGemini } from "../utils/gemini";
import { speakText } from "../utils/tts";
import { AssistantAvatar, AssistantHero } from "../components/AssistantVisuals";
import { openSupportWhatsApp, WhatsAppIcon } from "../components/shared/WhatsAppSupport";

const SPEECH_LANG = { en: "en-NG", pidgin: "en-NG", ha: "ha-NG", ig: "ig-NG", yo: "yo-NG" };

// Chip labels are shown in the chosen language; the `q` text is the prompt sent to the AI and stays English.
const QUICK = [
  { labelKey: "account.ai.chipSoldToday",       q: "How much did I sell today? Break it down by payment method and top items."       },
  { labelKey: "account.ai.chipWhoOwes",         q: "Who owes me money and how much? List all credit debtors with outstanding amounts." },
  { labelKey: "account.ai.chipWeekVsWeek",      q: "Compare this week's sales to last week — revenue, transaction count, and best items." },
  { labelKey: "account.ai.chipPidginTop",       q: "Wetin I sell pass today? Give me the top items by revenue in Pidgin."             },
  { labelKey: "account.ai.chipSalesForecast",   q: "Show my sales forecast and predictions"                                           },
  { labelKey: "aiChip.totalProfit",             q: "What is my total profit?"                                                        },
  { labelKey: "account.ai.chipOverdueCredits",  q: "Show me all overdue credit customers"                                             },
  { labelKey: "aiChip.stockStatus",             q: "What is my current stock status and what is running low?"                        },
  { labelKey: "account.ai.chipBestSellers",     q: "What are my best selling items?"                                                  },
  { labelKey: "aiChip.ajoSummary",              q: "Give me a full Ajo savings summary with all client balances"                     },
  { labelKey: "account.ai.chipAjoOverdue",      q: "Which Ajo clients are overdue for contribution?"                                  },
  { labelKey: "account.ai.chipStaffOverview",   q: "Tell me about my staff"                                                          },
  { labelKey: "account.ai.chipBranchSummary",   q: "Give me a summary of my branches"                                                },
  { labelKey: "aiChip.monthlyReport",           q: "Give me a full monthly business report"                                          },
  { labelKey: "account.ai.chipInvoiceSummary",  q: "Show me a summary of all my invoices and outstanding amounts"                    },
  { labelKey: "account.ai.chipOverdueInvoices", q: "Which invoices are overdue and how much is owed?"                                },
  { labelKey: "account.ai.chipGrowBusiness",    q: "How can I grow my business?"                                                     },
  { labelKey: "account.ai.chipAppFeatures",     q: "What can this app do for my business?"                                           },
  { labelKey: "account.ai.chipPricingTips",     q: "What is a good pricing strategy for my business?"                                },
];

/* Opening message — rendered from the current language each time (never sent to the AI). */
const greetingText = (t) => [
  t("account.ai.greetHello"),
  t("account.ai.greetData"),
  t("account.ai.greetTap"),
].join("\n\n");

/* ── Renders **bold** and line-breaks ────────────────────────────────── */
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

function TypingDots() {
  return (
    <div className="flex items-end gap-2">
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center flex-shrink-0">
        <span className="text-[11px] leading-none">✨</span>
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


/* ── Main screen ─────────────────────────────────────────────────────── */
export default function AIAssistant({ store, inventory, branches = [], invoices = [], onClose, initialQuery = "" }) {
  const { lang } = useLanguage();
  const t = useT();

  // The greeting row is marked so it re-renders in the current language; history skips it (slice(1)).
  const [messages,  setMessages]  = useState(() => [{ role: "assistant", text: greetingText(t), greeting: true }]);
  const [input,     setInput]     = useState("");
  const [thinking,  setThinking]  = useState(false);
  const [listening, setListening] = useState(false);
  const [ttsOn,     setTtsOn]     = useState(() => {
    try { return localStorage.getItem("kt_tts_enabled") !== "0"; } catch { return true; }
  });

  const listRef  = useRef(null);
  const inputRef = useRef(null);
  const askedRef = useRef(false);
  const recogRef = useRef(null);
  const ttsOnRef = useRef(false);
  const msgRef   = useRef(messages);

  ttsOnRef.current = ttsOn;
  msgRef.current   = messages;

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, thinking]);

  async function ask(query) {
    const q = query.trim();
    if (!q || thinking) return;

    setMessages(prev => [...prev, { role: "user", text: q }]);
    setInput("");
    setThinking(true);

    const products = inventory?.products || [];
    const context  = buildContext(store, products, branches, invoices);
    const history  = msgRef.current.slice(1).filter(m => !m.isError).map(m => ({ role: m.role, text: m.text }));

    let fullReply  = "";
    let firstChunk = true;

    try {
      await askGemini({
        message: q,
        context,
        history,
        lang,
        maxAttempts: 3,
        timeout: 30000,
        onChunk: (chunk) => {
          if (firstChunk) {
            firstChunk = false;
            setThinking(false);
            setMessages(prev => [...prev, { role: "assistant", text: chunk }]);
          } else {
            setMessages(prev => {
              const updated = [...prev];
              updated[updated.length - 1] = { role: "assistant", text: updated[updated.length - 1].text + chunk };
              return updated;
            });
          }
          fullReply += chunk;
        },
      });

      if (firstChunk) {
        setThinking(false);
        setMessages(prev => [...prev, { role: "assistant", text: t("account.ai.noResponse"), isError: true }]);
      } else if (ttsOnRef.current && fullReply) {
        speakText(fullReply, lang);
      }
    } catch (err) {
      setThinking(false);
      if (firstChunk) {
        setMessages(prev => [...prev, { role: "assistant", text: err.message, isError: true }]);
      } else {
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", text: err.message, isError: true };
          return updated;
        });
      }
    }
  }

  const askRef = useRef(ask);
  askRef.current = ask;

  useEffect(() => {
    if (initialQuery && !askedRef.current) {
      askedRef.current = true;
      askRef.current(initialQuery);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const hasSpeech = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

  function startListening() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    r.lang           = SPEECH_LANG[lang] || "en-NG";
    r.continuous     = false;
    r.interimResults = false;
    r.onresult = e => { setListening(false); askRef.current(e.results[0][0].transcript); };
    r.onerror  = () => setListening(false);
    r.onend    = () => setListening(false);
    r.start();
    setListening(true);
    recogRef.current = r;
  }

  function stopListening() { recogRef.current?.stop(); setListening(false); }

  return (
    <div className="fixed inset-0 z-[60] bg-slate-50 dark:bg-slate-900 flex flex-col">

      {/* ── Header ── */}
      <div
        className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 shadow-sm flex-shrink-0"
        style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top, 0px))" }}>
        <AssistantAvatar size={38} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-800 dark:text-white leading-tight">{t("account.ai.businessAssistant")}</p>
          <p className="text-[10px] text-slate-400 dark:text-slate-500">{t("account.ai.poweredBy")}</p>
        </div>

        {/* A person on WhatsApp — carries the last question over (2026-10-25) */}
        <button
          onClick={() => {
            const lastQ = [...messages].reverse().find((m) => m.role === "user")?.text;
            openSupportWhatsApp(t("common.whatsAppHello") + (lastQ ? lastQ.slice(0, 500) : ""));
          }}
          title={t("common.chatWhatsApp")}
          aria-label={t("common.chatWhatsApp")}
          className="h-8 px-3 rounded-full bg-[#25D366] hover:bg-[#1ebe5b] text-white flex items-center gap-1.5 text-xs font-bold transition-colors flex-shrink-0">
          <WhatsAppIcon className="w-4 h-4" /> WhatsApp
        </button>

        {/* TTS toggle */}
        <button
          onClick={() => setTtsOn(v => {
            const next = !v;
            try {
              if (next) localStorage.removeItem("kt_tts_enabled");
              else      localStorage.setItem("kt_tts_enabled", "0");
            } catch {}
            return next;
          })}
          title={ttsOn ? t("account.ai.muteVoice") : t("account.ai.enableVoice")}
          className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors flex-shrink-0 ${
            ttsOn
              ? "bg-brand-100 dark:bg-brand-900/40 text-brand-600 dark:text-brand-400"
              : "bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-500"
          }`}>
          {ttsOn ? (
            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
              <line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          )}
        </button>

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
        {QUICK.map(({ labelKey, q }) => (
          <button key={labelKey} onClick={() => ask(q)} disabled={thinking}
            className="flex-shrink-0 text-[11px] font-semibold bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-400 border border-brand-100 dark:border-brand-800 px-3 py-1.5 rounded-full whitespace-nowrap hover:bg-brand-100 dark:hover:bg-brand-900/40 disabled:opacity-50 transition-colors active:scale-95">
            {t(labelKey)}
          </button>
        ))}
      </div>

      {/* ── Chat messages ── */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length <= 1 && <AssistantHero portal="owner" />}
        {messages.map((m, idx) => (
          <div key={idx} className={`flex items-end gap-2 ${m.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
            {m.role === "assistant" && (
              <AssistantAvatar size={28} badge={false} className="mb-0.5" />
            )}
            <div className={`max-w-[82%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
              m.role === "user"
                ? "bg-brand-600 text-white rounded-br-md"
                : "bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 shadow-card border border-slate-100 dark:border-slate-700/60 rounded-bl-md"
            }`}>
              <FormattedText text={m.greeting ? greetingText(t) : m.text} />
              {m.role === "assistant" && idx > 0 && (
                <button
                  onClick={() => speakText(m.text, lang)}
                  className="mt-2 flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500 hover:text-brand-500 dark:hover:text-brand-400 transition-colors">
                  <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  </svg>
                  {t("account.ai.listen")}
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
                  <line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              )}
            </button>
          )}

          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && ask(input)}
            placeholder={listening ? t("account.ai.listeningSpeak") : t("account.ai.askBusiness")}
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
            🎤 {t("account.ai.listeningStop")}
          </p>
        )}
      </div>
    </div>
  );
}
