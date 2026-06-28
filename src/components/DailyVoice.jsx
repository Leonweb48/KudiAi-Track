import { useState, useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { speakText, cancelTTS } from "../utils/tts";

const MOTIVATIONS = [
  "Every naira you save today builds the empire of tomorrow.",
  "Your consistency is your competitive advantage — keep showing up.",
  "Track every kobo. Wealthy people watch the small amounts.",
  "Success in business is just showing up better than yesterday.",
  "The records you keep today tell the story of your growth tomorrow.",
  "Small businesses are the backbone of Nigeria — you are that backbone.",
  "Discipline beats motivation every time. Keep going.",
  "Your customers come back because of trust, not just price.",
  "Every challenge in your business is a lesson in disguise.",
  "The best investment you can make is in understanding your own numbers.",
  "Progress is not always visible — but it is always happening when you work.",
  "One good transaction can change the momentum of your entire day.",
  "You started this business for a reason. Let that reason fuel today.",
  "Consistency in savings, no matter how small, always compounds.",
  "Great businesses are built by people who refuse to quit on hard days.",
  "Your ledger never lies — trust your records and act on what they show.",
  "Every customer you treat well today is a referral tomorrow.",
  "The difference between a struggling and a thriving business is daily attention.",
  "Money saved is money earned — protect every naira.",
  "You are building something that will outlast today's challenges.",
  "Profitable businesses are made of hundreds of small good decisions.",
  "Keep your eyes on your goals, not your obstacles.",
  "Your hard work today is tomorrow's success story.",
  "In business, knowing your numbers is your greatest power.",
  "Every day you open your business is a vote of confidence in yourself.",
  "The entrepreneur who tracks, wins. Keep tracking.",
  "Greatness is not a single act — it is daily excellence.",
  "Nigeria's best businesses were built by people like you, one day at a time.",
  "Your business, your legacy — protect it with good records.",
  "Stay the course. Growth is happening even when you cannot see it.",
  "A business that saves is a business that survives.",
];

const VOICE_KEY = (uid) => `kt_voice_date_${uid}`;

function formatSpoken(amount) {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)} million naira`;
  if (amount >= 1_000)     return `${Math.round(amount / 1_000)} thousand naira`;
  return `${Math.round(amount)} naira`;
}

function buildMessage({ profile, credits, asoClients, lowStock }) {
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" :
    hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = (profile?.full_name || "").split(" ")[0] || "there";

  const overdueCredits = (credits || []).filter(c => c.status === "overdue");
  const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
  const ajoDue = (asoClients || []).filter(c => {
    if (!c.next_contribution_date || c.status !== "active") return false;
    return new Date(c.next_contribution_date) <= todayMidnight;
  });
  const lowItems = lowStock || [];

  const tasks = [];
  if (overdueCredits.length) {
    const total = overdueCredits.reduce((s, c) => s + (c.outstanding || 0), 0);
    tasks.push(
      `${overdueCredits.length} overdue credit${overdueCredits.length > 1 ? "s" : ""} totalling ${formatSpoken(total)}`
    );
  }
  if (ajoDue.length) {
    tasks.push(
      `${ajoDue.length} Ajo client${ajoDue.length > 1 ? "s" : ""} with contributions due`
    );
  }
  if (lowItems.length) {
    tasks.push(
      `${lowItems.length} product${lowItems.length > 1 ? "s" : ""} running low in stock`
    );
  }

  let taskText;
  if (!tasks.length) {
    taskText = "Everything looks great — you are all caught up today.";
  } else if (tasks.length === 1) {
    taskText = `Here is what needs your attention: ${tasks[0]}.`;
  } else {
    taskText = `Here is what needs your attention: ${tasks.slice(0, -1).join(", ")}, and ${tasks[tasks.length - 1]}.`;
  }

  const dayIndex = Math.floor(Date.now() / 86_400_000) % MOTIVATIONS.length;
  return `${greeting}, ${firstName}! ${taskText} And here is today's motivation: ${MOTIVATIONS[dayIndex]}`;
}

/* ── Sound wave bars (animated while speaking) ────────────────────── */
function WaveBars() {
  const heights = [6, 12, 18, 14, 20, 10, 16, 8, 18, 12, 16, 7];
  return (
    <>
      <style>{`
        @keyframes dvBar { 0%,100%{transform:scaleY(.35)} 50%{transform:scaleY(1)} }
      `}</style>
      <div className="flex items-center gap-[3px] my-2">
        {heights.map((h, i) => (
          <span key={i} className="block bg-emerald-400 dark:bg-emerald-500 rounded-full w-[3px] origin-bottom"
            style={{ height: h, animationDelay: `${i * 65}ms`, animation: "dvBar 0.75s ease-in-out infinite" }} />
        ))}
      </div>
    </>
  );
}

export default function DailyVoice({ userId, profile, credits, asoClients, lowStock, loading }) {
  const [visible,    setVisible]    = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [needsTap,   setNeedsTap]   = useState(false);
  const [message,    setMessage]    = useState("");
  const hasFiredRef    = useRef(false);
  const isSpeakingRef  = useRef(false);

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
      setTimeout(() => setVisible(false), 2500);
      return;
    }

    if (!window.speechSynthesis) { setNeedsTap(true); return; }
    window.speechSynthesis.cancel();

    const utter = new SpeechSynthesisUtterance(msg);
    utter.lang  = "en-GB";
    utter.rate  = 0.92;
    utter.pitch = 1.05;

    utter.onstart = () => { isSpeakingRef.current = true;  setIsSpeaking(true);  setNeedsTap(false); };
    utter.onend   = () => { isSpeakingRef.current = false; setIsSpeaking(false); setTimeout(() => setVisible(false), 2500); };
    utter.onerror = () => { isSpeakingRef.current = false; setIsSpeaking(false); setNeedsTap(true); };

    window.speechSynthesis.speak(utter);
  };

  // Cancel on unmount
  useEffect(() => () => { cancelTTS(); }, []);

  // Fire once per day after data loads
  useEffect(() => {
    if (loading || !userId || hasFiredRef.current) return;

    const today = new Date().toDateString();
    if (localStorage.getItem(VOICE_KEY(userId)) === today) return;

    hasFiredRef.current = true;
    localStorage.setItem(VOICE_KEY(userId), today);

    const msg = buildMessage({ profile, credits, asoClients, lowStock });
    setMessage(msg);
    setVisible(true);

    const t = setTimeout(() => {
      doSpeak(msg);
      // Show tap fallback if speech hasn't started after 1.5s (e.g. iOS autoplay block)
      setTimeout(() => { if (!isSpeakingRef.current) setNeedsTap(true); }, 1500);
    }, 900);
    return () => clearTimeout(t);
  }, [loading, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-40 max-w-md mx-auto px-3"
      style={{ paddingTop: "max(10px, env(safe-area-inset-top, 10px))" }}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-emerald-100 dark:border-slate-700 p-4">
        {/* Header row */}
        <div className="flex items-start gap-3">
          <div className={`w-9 h-9 rounded-xl bg-emerald-500 flex items-center justify-center flex-shrink-0 transition-opacity ${isSpeaking ? "opacity-100" : "opacity-80"}`}>
            <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
              {isSpeaking && <path d="M18.5 12c0-2.77-1.5-5.18-3.75-6.5v13c2.25-1.32 3.75-3.73 3.75-6.5z"/>}
            </svg>
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide leading-none mb-0.5">
              Daily Briefing
            </p>
            <p className="text-xs text-slate-400 leading-none">
              {isSpeaking ? "Speaking…" : needsTap ? "Tap below to hear" : "Ready"}
            </p>
          </div>

          <button onClick={dismiss}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg flex-shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Animated wave while speaking */}
        {isSpeaking && <WaveBars />}

        {/* Message preview */}
        <p className="text-[12px] text-slate-600 dark:text-slate-300 mt-2 leading-relaxed line-clamp-3">
          {message}
        </p>

        {/* Tap-to-hear fallback */}
        {needsTap && (
          <button onClick={() => doSpeak(message)}
            className="mt-3 w-full flex items-center justify-center gap-2 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-sm font-semibold rounded-xl py-2.5 border border-emerald-200 dark:border-emerald-700 active:bg-emerald-100">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
            </svg>
            Tap to hear
          </button>
        )}
      </div>
    </div>
  );
}
