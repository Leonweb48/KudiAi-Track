import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { supabase } from "./supabase";

const TTS_URL = "https://admin.kudiai.app/api/public/tts";

// ── AudioContext (shared, persisted across calls) ────────────────────────────
// Using AudioContext + BufferSourceNode instead of new Audio() bypasses the
// Android WebView autoplay restriction: once unlockAudio() is called from a
// synchronous tap handler, the context stays in "running" state for the session,
// so subsequent async play calls (after network requests) work without a new gesture.
let _audioCtx  = null;
let _currentSrc = null;

function getAudioCtx() {
  if (!_audioCtx || _audioCtx.state === "closed") {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return _audioCtx;
}

// Call this once from a synchronous user-gesture handler (e.g. first tap/touchstart)
// to unlock audio for the entire session.
export function unlockAudio() {
  try {
    if (typeof window === "undefined") return;
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") ctx.resume();
    // Play a zero-length silent buffer — sufficient to mark the context as user-activated
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch (e) { /* ignore — never block the user action */ }
}

export function cancelTTS() {
  if (_currentSrc) {
    try { _currentSrc.stop(); } catch (e) {}
    _currentSrc = null;
  }
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

function playBase64(base64) {
  return new Promise((resolve, reject) => {
    try {
      const ctx = getAudioCtx();
      // Decode the base64 string to a typed array
      const binary = atob(base64);
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      ctx.decodeAudioData(
        bytes.buffer,
        (audioBuffer) => {
          // Stop any currently playing audio
          if (_currentSrc) {
            try { _currentSrc.stop(); } catch (e) {}
            _currentSrc = null;
          }
          const src = ctx.createBufferSource();
          src.buffer = audioBuffer;
          src.connect(ctx.destination);
          _currentSrc = src;
          src.onended = () => { _currentSrc = null; resolve(); };
          // Resume in case context was suspended after background/foreground switch
          if (ctx.state === "suspended") {
            ctx.resume().then(() => src.start(0)).catch(reject);
          } else {
            src.start(0);
          }
        },
        (err) => reject(new Error(`decode error: ${err?.message || err}`))
      );
    } catch (e) {
      reject(e);
    }
  });
}

function deviceSpeak(text) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) { resolve(); return; }
    window.speechSynthesis.cancel();

    const doUtter = () => {
      const utter = new SpeechSynthesisUtterance(text.replace(/\*\*/g, "").replace(/#+\s*/g, ""));
      utter.rate   = 0.88;
      utter.pitch  = 1.05;
      utter.volume = 1.0;
      const voices = window.speechSynthesis.getVoices();
      const pick   = voices.find(v => v.lang.startsWith("en-")) || voices[0];
      if (pick) utter.voice = pick;
      utter.onend  = () => resolve();
      utter.onerror = () => resolve();
      window.speechSynthesis.speak(utter);
    };

    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      doUtter();
    } else {
      let done = false;
      const fire = () => {
        if (done) return;
        done = true;
        window.speechSynthesis.onvoiceschanged = null;
        doUtter();
      };
      window.speechSynthesis.onvoiceschanged = fire;
      setTimeout(fire, 500);
    }

    setTimeout(resolve, 30000);
  });
}

async function serverTTS(text) {
  let userJwt = "";
  try {
    const { data } = await supabase?.auth.getSession() ?? { data: null };
    userJwt = data?.session?.access_token ?? "";
  } catch { /* proceed without auth */ }

  const headers = {
    "Content-Type": "application/json",
    ...(userJwt ? { "Authorization": `Bearer ${userJwt}` } : {}),
  };
  const body = JSON.stringify({ text });

  if (Capacitor.isNativePlatform()) {
    const r = await CapacitorHttp.post({
      url:         TTS_URL,
      headers,
      data:        body,
      readTimeout: 60000,
    });
    if (r.status !== 200) throw new Error(`TTS HTTP ${r.status}`);
    const parsed = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
    if (!parsed?.audio_base64) throw new Error("No audio from server");
    return parsed.audio_base64;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(TTS_URL, { method: "POST", signal: controller.signal, headers, body });
    if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
    const data = await res.json();
    if (!data.audio_base64) throw new Error("No audio returned");
    return data.audio_base64;
  } finally {
    clearTimeout(timer);
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export function isTtsEnabled() {
  try { return localStorage.getItem("kt_tts_enabled") === "1"; }
  catch { return false; }
}

export async function speakText(text, lang = "en") {
  if (!isTtsEnabled()) return;
  if (!text || !text.trim()) return;
  cancelTTS();

  const clean = text.replace(/\*\*/g, "").replace(/#+\s*/g, "").trim().slice(0, 700);
  try {
    const base64 = await serverTTS(clean);
    await playBase64(base64);
  } catch (e) {
    console.error("[TTS] OpenAI failed, using device TTS:", e?.message || e);
    await deviceSpeak(clean);
  }
}

// Event key → confirmation text for native TTS (Android-safe, no speechSynthesis)
const EVENT_TEXT = {
  cashIn:      "Transaction recorded",
  cashOut:     "Expense recorded",
  ajoDeposit:  "Deposit confirmed",
  ajoWithdraw: "Withdrawal processed",
  creditSaved: "Payment recorded",
  stockIn:     "Stock updated",
};

export async function speakEvent(eventKey = "cashIn", lang = "en") {
  if (!isTtsEnabled()) return;
  const text = EVENT_TEXT[eventKey] || "Action recorded";
  await speakText(text, lang).catch(() => {});
}
