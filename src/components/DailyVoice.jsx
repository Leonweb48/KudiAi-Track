import { useState, useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { speakText, cancelTTS } from "../utils/tts";
import { askGemini } from "../utils/gemini";
import { isBillPayment } from "../utils/helpers";

const VOICE_KEY   = (uid) => `kt_voice_date_${uid}`;
const SUMMARY_KEY = (uid, date) => `kt_voice_summary_${uid}_${date}`;

function stripMarkdown(text) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^\*+\s*/gm, "")
    .trim();
}

function fmtSpoken(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} million naira`;
  if (n >= 1_000)     return `${Math.round(n / 1_000)} thousand naira`;
  return `${Math.round(n)} naira`;
}

/* ── Parse AI summary into structured sections ────────────────────── */
function parseSections(text) {
  const sections = [];
  const parts = text.split(/(?=\*\*[^*]+\*\*)/);
  for (const part of parts) {
    const m = part.match(/^\*\*([^*]+)\*\*\s*([\s\S]*)/);
    if (m) {
      sections.push({ header: m[1].trim(), body: m[2].trim() });
    } else if (part.trim()) {
      sections.push({ header: null, body: part.trim() });
    }
  }
  return sections;
}

const SECTION_STYLE = {
  "What Stood Out":       { icon: "⭐", color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-900/20" },
  "What Needs Attention": { icon: "⚠️", color: "text-amber-600 dark:text-amber-400",   bg: "bg-amber-50 dark:bg-amber-900/20" },
  "Today's Opportunity":  { icon: "💡", color: "text-blue-600 dark:text-blue-400",     bg: "bg-blue-50 dark:bg-blue-900/20" },
};

function SummaryCard({ text }) {
  const sections = parseSections(text);
  if (!sections.length) {
    return <p className="text-[12px] text-slate-600 dark:text-slate-300 leading-relaxed">{text}</p>;
  }
  return (
    <div className="space-y-2 mt-1">
      {sections.map((s, i) => {
        const style = SECTION_STYLE[s.header] || { icon: "•", color: "text-slate-600 dark:text-slate-300", bg: "bg-slate-50 dark:bg-slate-700/40" };
        return (
          <div key={i} className={`rounded-xl px-3 py-2.5 ${style.bg}`}>
            {s.header && (
              <p className={`text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1 ${style.color}`}>
                <span>{style.icon}</span> {s.header}
              </p>
            )}
            <p className="text-[12px] text-slate-700 dark:text-slate-200 leading-relaxed">{s.body}</p>
          </div>
        );
      })}
    </div>
  );
}

/* ── Build greeting + alerts ─────────────────────────────────────── */
function buildGreeting({ profile, credits, asoClients, lowStock }) {
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" :
    hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = (profile?.full_name || "").split(" ")[0] || "there";

  const overdueCredits = (credits || []).filter(c => c.status === "overdue");
  const todayMidnight  = new Date(); todayMidnight.setHours(0, 0, 0, 0);
  const ajoDue = (asoClients || []).filter(c =>
    c.next_contribution_date && c.status === "active" &&
    new Date(c.next_contribution_date) <= todayMidnight
  );
  const lowItems = lowStock || [];

  const tasks = [];
  if (overdueCredits.length) {
    const total = overdueCredits.reduce((s, c) => s + (c.outstanding || 0), 0);
    tasks.push(`${overdueCredits.length} overdue credit${overdueCredits.length > 1 ? "s" : ""} totalling ${fmtSpoken(total)}`);
  }
  if (ajoDue.length)   tasks.push(`${ajoDue.length} Ajo client${ajoDue.length > 1 ? "s" : ""} with contributions due`);
  if (lowItems.length) tasks.push(`${lowItems.length} product${lowItems.length > 1 ? "s" : ""} running low`);

  const alert = tasks.length === 0 ? ""
    : " " + (tasks.length === 1
        ? `Heads up: ${tasks[0]}.`
        : `Heads up: ${tasks.slice(0, -1).join(", ")}, and ${tasks[tasks.length - 1]}.`);

  return { firstName, greetingLine: `${greeting}, ${firstName}!${alert}` };
}

/* ── Build AI prompt from yesterday's transactions ───────────────── */
function buildPrompt({ firstName, transactions, credits, lowStock }) {
  const now    = new Date();
  const yStart = new Date(now); yStart.setDate(yStart.getDate() - 1); yStart.setHours(0, 0, 0, 0);
  const yEnd   = new Date(now); yEnd.setDate(yEnd.getDate() - 1);     yEnd.setHours(23, 59, 59, 999);

  const yTx     = (transactions || []).filter(t => { const d = new Date(t.transaction_date); return d >= yStart && d <= yEnd; });
  const totalIn  = yTx.filter(t => t.type === "in" ).reduce((s, t) => s + t.amount, 0);
  const totalOut = yTx.filter(t => t.type === "out" && !isBillPayment(t)).reduce((s, t) => s + t.amount, 0);
  const profit   = totalIn - totalOut;

  const itemCounts = {};
  yTx.forEach(t => { if (t.item_name) itemCounts[t.item_name] = (itemCounts[t.item_name] || 0) + 1; });
  const topItems = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);

  const custMap = {};
  yTx.filter(t => t.type === "in").forEach(t => { if (t.customer_name) custMap[t.customer_name] = (custMap[t.customer_name] || 0) + t.amount; });
  const topCust = Object.entries(custMap).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);

  const overdue  = (credits  || []).filter(c => c.status === "overdue").length;
  const lowCount = (lowStock || []).length;

  return `You are KudiAI Business Assistant giving ${firstName}'s daily morning briefing.

Yesterday (${yStart.toDateString()}):
Sales: ₦${totalIn.toLocaleString()} | Expenses: ₦${totalOut.toLocaleString()} | Net Profit: ₦${profit.toLocaleString()} | Transactions: ${yTx.length}${topItems.length ? `\nTop products sold: ${topItems.join(", ")}` : ""}${topCust.length ? `\nTop customers: ${topCust.join(", ")}` : ""}${overdue ? `\nOverdue credits outstanding: ${overdue}` : ""}${lowCount ? `\nLow stock products: ${lowCount}` : ""}${yTx.length === 0 ? "\nNo transactions were recorded yesterday." : ""}

Write a morning business briefing in exactly 3 sections. Be specific, warm, and use real numbers. Each section: 1-2 sentences only. Complete ALL 3 sections without stopping.

**What Stood Out**
[The biggest win or most notable achievement from yesterday's data — or encourage them if it was a slow day]

**What Needs Attention**
[The most important issue to act on today based on yesterday, or "All looks great" if no concerns]

**Today's Opportunity**
[A forward-looking tip or prediction based on the trends you see in their data]`;
}

/* ── Sound wave bars ─────────────────────────────────────────────── */
function WaveBars() {
  const heights = [6, 12, 18, 14, 20, 10, 16, 8, 18, 12, 16, 7];
  return (
    <>
      <style>{`@keyframes dvBar { 0%,100%{transform:scaleY(.35)} 50%{transform:scaleY(1)} }`}</style>
      <div className="flex items-center gap-[3px] my-2">
        {heights.map((h, i) => (
          <span key={i} className="block bg-emerald-400 dark:bg-emerald-500 rounded-full w-[3px] origin-bottom"
            style={{ height: h, animationDelay: `${i * 65}ms`, animation: "dvBar 0.75s ease-in-out infinite" }} />
        ))}
      </div>
    </>
  );
}

/* ── Main component ─────────────────────────────────────────────── */
export default function DailyVoice({ userId, profile, credits, asoClients, lowStock, loading, transactions }) {
  const [visible,    setVisible]    = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [needsTap,   setNeedsTap]   = useState(false);
  const [greeting,   setGreeting]   = useState("");
  const [aiSummary,  setAiSummary]  = useState(null);  // null = loading
  const hasFiredRef   = useRef(false);
  const isSpeakingRef = useRef(false);
  const spokenRef     = useRef("");

  const dismiss = () => {
    cancelTTS();
    setVisible(false);
    setIsSpeaking(false);
    isSpeakingRef.current = false;
  };

  const doSpeak = async (msg) => {
    setNeedsTap(false);
    if (Capacitor.isNativePlatform()) {
      isSpeakingRef.current = true;
      setIsSpeaking(true);
      await speakText(msg, "en").catch(() => {});
      isSpeakingRef.current = false;
      setIsSpeaking(false);
      return;
    }
    if (!window.speechSynthesis) { setNeedsTap(true); return; }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(msg);
    utter.lang  = "en-GB";
    utter.rate  = 0.92;
    utter.pitch = 1.05;
    utter.onstart = () => { isSpeakingRef.current = true;  setIsSpeaking(true);  setNeedsTap(false); };
    utter.onend   = () => { isSpeakingRef.current = false; setIsSpeaking(false); };
    utter.onerror = () => { isSpeakingRef.current = false; setIsSpeaking(false); setNeedsTap(true); };
    window.speechSynthesis.speak(utter);
  };

  useEffect(() => () => { cancelTTS(); }, []);

  // Fire once per day after data loads
  useEffect(() => {
    if (loading || !userId || hasFiredRef.current) return;

    const today    = new Date().toDateString();
    const cacheKey = SUMMARY_KEY(userId, today);

    if (localStorage.getItem(VOICE_KEY(userId)) === today) return;

    hasFiredRef.current = true;
    localStorage.setItem(VOICE_KEY(userId), today);

    const { firstName, greetingLine } = buildGreeting({ profile, credits, asoClients, lowStock });
    setGreeting(greetingLine);
    setVisible(true);

    // Check for cached summary (avoids AI call on same-day re-opens)
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      setAiSummary(cached);
      const spoken = `${greetingLine} Here is your business summary. ${stripMarkdown(cached)}`;
      spokenRef.current = spoken;
      setTimeout(() => {
        doSpeak(spoken);
        setTimeout(() => { if (!isSpeakingRef.current) setNeedsTap(true); }, 1500);
      }, 900);
      return;
    }

    // Generate fresh AI summary
    const prompt = buildPrompt({ firstName, transactions, credits, lowStock });
    setTimeout(async () => {
      try {
        const raw  = await askGemini({ message: prompt, lang: "en", context: "", history: [] });
        const text = raw?.trim() || "Your business is ready for a great day. Check your transactions for details.";
        setAiSummary(text);
        try { localStorage.setItem(cacheKey, text); } catch {}
        const spoken = `${greetingLine} Here is your business summary. ${stripMarkdown(text)}`;
        spokenRef.current = spoken;
        doSpeak(spoken);
        setTimeout(() => { if (!isSpeakingRef.current) setNeedsTap(true); }, 1500);
      } catch {
        const fallback = "**What Stood Out**\nYour business is active and progressing.\n\n**What Needs Attention**\nCheck your records for any outstanding items.\n\n**Today's Opportunity**\nFocus on your top-selling products today.";
        setAiSummary(fallback);
        setNeedsTap(true);
      }
    }, 600);
  }, [loading, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-40 max-w-md mx-auto px-3"
      style={{ paddingTop: "max(10px, env(safe-area-inset-top, 10px))" }}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-emerald-100 dark:border-slate-700 overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-4 pt-4 pb-3">
          <div className={`w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center flex-shrink-0 ${isSpeaking ? "opacity-100" : "opacity-85"}`}>
            <span className="text-base leading-none">✨</span>
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide leading-none mb-0.5">
              KudiAI Morning Brief
            </p>
            <p className="text-[11px] text-slate-400 leading-none">
              {isSpeaking ? "Speaking…" : aiSummary === null ? "Generating summary…" : "Yesterday's recap"}
            </p>
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            {aiSummary !== null && spokenRef.current && (
              <button onClick={() => doSpeak(spokenRef.current)}
                className="text-emerald-500 dark:text-emerald-400 p-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition-colors"
                title="Listen">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
                </svg>
              </button>
            )}
            <button onClick={dismiss}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>

        {isSpeaking && <div className="px-4"><WaveBars /></div>}

        {/* Body */}
        <div className="px-4 pb-4">
          {/* Greeting line */}
          <p className="text-[12px] font-semibold text-slate-700 dark:text-slate-200 leading-relaxed mb-2">
            {greeting}
          </p>

          {/* Divider */}
          <div className="border-t border-slate-100 dark:border-slate-700 mb-2" />

          {/* AI summary */}
          {aiSummary === null ? (
            <div className="flex items-center gap-2 py-2">
              <span className="w-3.5 h-3.5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
              <p className="text-[11px] text-slate-400 dark:text-slate-500">Analysing yesterday's activity…</p>
            </div>
          ) : (
            <SummaryCard text={aiSummary} />
          )}

          {/* Tap-to-hear fallback */}
          {needsTap && aiSummary !== null && (
            <button onClick={() => doSpeak(spokenRef.current)}
              className="mt-3 w-full flex items-center justify-center gap-2 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-sm font-semibold rounded-xl py-2.5 border border-emerald-200 dark:border-emerald-700 active:bg-emerald-100 transition-colors">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
              </svg>
              Tap to hear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
