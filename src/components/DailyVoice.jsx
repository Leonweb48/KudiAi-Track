import { useState, useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { speakText, cancelTTS, isTtsEnabled } from "../utils/tts";
import { askGemini } from "../utils/gemini";
import { supabase } from "../utils/supabase";

const BRIEF_ENABLED_KEY = (uid) => `kt_brief_enabled_${uid}`;
const BRIEF_DATE_KEY    = (uid) => `kt_brief_date_${uid}`;
const BRIEF_CACHE_KEY   = (uid, date) => `kt_brief_cache_${uid}_${date}`;

function todayKey() { return new Date().toISOString().slice(0, 10); }

const BRIEF_PROMPT = `Using the context provided, write exactly 3 complete sentences as a morning greeting for the user.
Address them by their first name — it is in the context.
Speak as their personal business companion who knows their situation well: warm, direct, specific to what their actual numbers show right now — not generic encouragement.
End with one genuine sentence that fits their role and what today's data actually suggests.
Absolutely no asterisks, no bold, no dashes, no bullet points, no markdown of any kind — plain sentences only.
Write all 3 sentences in full before stopping.`;

function stripMarkdown(text) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^\*+\s*/gm, "")
    .replace(/#+ /g, "")
    .trim();
}

function WaveBars() {
  const heights = [6, 12, 18, 14, 20, 10, 16, 8, 18, 12, 16, 7];
  return (
    <>
      <style>{`@keyframes dvBar{0%,100%{transform:scaleY(.35)}50%{transform:scaleY(1)}}`}</style>
      <div className="flex items-center gap-[3px] my-2">
        {heights.map((h, i) => (
          <span key={i} className="block bg-emerald-400 dark:bg-emerald-500 rounded-full w-[3px] origin-bottom"
            style={{ height: h, animationDelay: `${i * 65}ms`, animation: "dvBar 0.75s ease-in-out infinite" }} />
        ))}
      </div>
    </>
  );
}

/**
 * AI-generated morning brief — one natural paragraph from scoped context.
 *
 * Props:
 *   userId      — auth user ID (used for per-user localStorage keys)
 *   context     — pre-built scoped context string (from buildContext / staffPortalContext / etc.)
 *   fallback    — plain-text sentence shown if the AI call fails
 *   dataLoading — true while the portal's data is still being fetched; brief is delayed until false
 */
export default function DailyVoice({ userId, context, fallback, dataLoading }) {
  const [visible,    setVisible]    = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [needsTap,   setNeedsTap]   = useState(false);
  const [brief,      setBrief]      = useState(null);  // null = loading; string = ready
  const [enabled,    setEnabled]    = useState(() => {
    if (!userId) return true;
    try {
      const v = localStorage.getItem(BRIEF_ENABLED_KEY(userId));
      return v === null ? true : v !== "0";
    } catch { return true; }
  });

  const hasFiredRef   = useRef(false);
  const isSpeakingRef = useRef(false);
  const spokenRef     = useRef("");

  // Sync enabled state when Settings dispatches kt_brief_toggle
  useEffect(() => {
    if (!userId) return;
    const handler = () => {
      try {
        const v = localStorage.getItem(BRIEF_ENABLED_KEY(userId));
        const next = v === null ? true : v !== "0";
        setEnabled(next);
        if (!next) { setVisible(false); cancelTTS(); isSpeakingRef.current = false; setIsSpeaking(false); }
      } catch {}
    };
    window.addEventListener("kt_brief_toggle", handler);
    return () => window.removeEventListener("kt_brief_toggle", handler);
  }, [userId]);

  const dismiss = () => {
    cancelTTS();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    setVisible(false);
    setIsSpeaking(false);
    isSpeakingRef.current = false;
  };

  const doSpeak = async (msg) => {
    if (!isTtsEnabled()) { setNeedsTap(true); return; }
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
    const utter   = new SpeechSynthesisUtterance(msg);
    utter.lang    = "en-GB";
    utter.rate    = 0.92;
    utter.pitch   = 1.05;
    utter.onstart = () => { isSpeakingRef.current = true;  setIsSpeaking(true);  setNeedsTap(false); };
    utter.onend   = () => { isSpeakingRef.current = false; setIsSpeaking(false); };
    utter.onerror = () => { isSpeakingRef.current = false; setIsSpeaking(false); setNeedsTap(true); };
    window.speechSynthesis.speak(utter);
  };

  useEffect(() => () => { cancelTTS(); if (window.speechSynthesis) window.speechSynthesis.cancel(); }, []);

  useEffect(() => {
    if (dataLoading || !userId || !context || !enabled || hasFiredRef.current) return;

    const date   = todayKey();
    const dateK  = BRIEF_DATE_KEY(userId);
    const cacheK = BRIEF_CACHE_KEY(userId, date);

    // Already shown today — restore from cache but don't replay voice
    if (localStorage.getItem(dateK) === date) {
      const cached = localStorage.getItem(cacheK);
      if (cached) {
        const clean = stripMarkdown(cached);
        setBrief(clean);
        spokenRef.current = clean;
        setVisible(true);
      }
      return;
    }

    hasFiredRef.current = true;

    // Same-day cache exists (e.g. re-mount before dateK was written) — show immediately.
    const cached = localStorage.getItem(cacheK);
    if (cached) {
      const clean = stripMarkdown(cached);
      setBrief(clean);
      spokenRef.current = clean;
      setVisible(true);
      try { localStorage.setItem(dateK, date); } catch {}
      // Sync date to auth metadata so other devices skip today's brief.
      supabase.auth.updateUser({ data: { brief_shown: date } }).catch(() => null);
      setTimeout(() => {
        doSpeak(spokenRef.current);
        setTimeout(() => { if (!isSpeakingRef.current) setNeedsTap(isTtsEnabled()); }, 1500);
      }, 900);
      return;
    }

    // No local cache — check auth metadata for cross-device dedup before generating.
    // The getUser() call is absorbed inside the existing 600 ms delay so no visible lag is added.
    setTimeout(async () => {
      try {
        const { data: { user: freshUser } } = await supabase.auth.getUser();
        if (freshUser?.user_metadata?.brief_shown === date) return; // already played on another device today
      } catch { /* network down or auth error — proceed with generation */ }

      setVisible(true);

      try {
        const raw   = await askGemini({ message: BRIEF_PROMPT, context, timeout: 20000, maxAttempts: 1 });
        const clean = stripMarkdown(raw?.trim() || fallback);
        setBrief(clean);
        spokenRef.current = clean;
        try { localStorage.setItem(cacheK, clean); localStorage.setItem(dateK, date); } catch {}
        // Record cross-device so other devices skip today's brief.
        supabase.auth.updateUser({ data: { brief_shown: date } }).catch(() => null);
        doSpeak(spokenRef.current);
        setTimeout(() => { if (!isSpeakingRef.current) setNeedsTap(isTtsEnabled()); }, 1500);
      } catch {
        const fb = stripMarkdown(fallback || "Your numbers look good — keep the momentum going today!");
        setBrief(fb);
        spokenRef.current = fb;
        setNeedsTap(isTtsEnabled());
      }
    }, 600);
  }, [dataLoading, userId, context, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!enabled || !visible) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-40 max-w-md mx-auto px-3"
      style={{ paddingTop: "max(10px, env(safe-area-inset-top, 10px))" }}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-emerald-100 dark:border-slate-700 overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-4 pt-4 pb-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center flex-shrink-0">
            <span className="text-base leading-none">✨</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide leading-none mb-0.5">
              KudiAI Morning Brief
            </p>
            <p className="text-[11px] text-slate-400 leading-none">
              {isSpeaking ? "Speaking…" : brief === null ? "Generating…" : "Your morning summary"}
            </p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {brief !== null && spokenRef.current && isTtsEnabled() && (
              <button onClick={() => doSpeak(spokenRef.current)}
                className="text-emerald-500 dark:text-emerald-400 p-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition-colors"
                title="Listen again">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
                </svg>
              </button>
            )}
            <button onClick={dismiss}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg transition-colors"
              title="Dismiss">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>

        {isSpeaking && <div className="px-4"><WaveBars /></div>}

        {/* Body */}
        <div className="px-4 pb-4">
          {brief === null ? (
            <div className="flex items-center gap-2 py-2">
              <span className="w-3.5 h-3.5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
              <p className="text-[11px] text-slate-400 dark:text-slate-500">Generating your brief…</p>
            </div>
          ) : (
            <p className="text-[13px] text-slate-700 dark:text-slate-200 leading-relaxed">{brief}</p>
          )}

          {needsTap && brief !== null && isTtsEnabled() && (
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

/* ─── Helper exported for Settings toggles across portals ─────────────────── */
export function BRIEF_ENABLED_KEY_EXPORT(uid) { return `kt_brief_enabled_${uid}`; }
