import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { supabase } from "./supabase";
import { TextToSpeech } from "@capacitor-community/text-to-speech";

const TTS_URL = "https://admin.kudiai.app/api/public/tts";

// ── AudioContext (shared, persisted across calls) ─────────────────────────────
let _audioCtx   = null;
let _currentSrc = null;

function getAudioCtx() {
  if (!_audioCtx || _audioCtx.state === "closed") {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return _audioCtx;
}

export function unlockAudio() {
  try {
    if (typeof window === "undefined") return;
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch (_e) {}
}

export function cancelTTS() {
  if (_currentSrc) {
    try { _currentSrc.stop(); } catch (_e) {}
    _currentSrc = null;
  }
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

function playBase64(base64) {
  return new Promise((resolve, reject) => {
    try {
      const ctx    = getAudioCtx();
      const binary = atob(base64);
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      ctx.decodeAudioData(
        bytes.buffer,
        (audioBuffer) => {
          if (_currentSrc) {
            try { _currentSrc.stop(); } catch (_e) {}
            _currentSrc = null;
          }
          const src = ctx.createBufferSource();
          src.buffer = audioBuffer;
          src.connect(ctx.destination);
          _currentSrc = src;
          src.onended = () => { _currentSrc = null; resolve(); };
          if (ctx.state === "suspended") {
            ctx.resume()
              .then(() => { src.start(0); })
              .catch(e  => { reject(e); });
          } else {
            src.start(0);
          }
        },
        (err) => { reject(new Error(`decode error: ${err?.message || err}`)); }
      );
    } catch (e) { reject(e); }
  });
}

async function deviceSpeak(text) {
  const clean = text.replace(/\*\*/g, "").replace(/#+\s*/g, "").trim();

  // On native Android/iOS use the OS TTS engine — speechSynthesis is unreliable
  // in Capacitor WebView and often completely absent.
  if (Capacitor.isNativePlatform()) {
    try {
      await TextToSpeech.speak({
        text:     clean,
        lang:     "en-NG",
        rate:     0.9,
        pitch:    1.0,
        volume:   1.0,
        category: "ambient",
      });
    } catch (_e) {}
    return;
  }

  // Web fallback
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) { resolve(); return; }
    window.speechSynthesis.cancel();

    const doUtter = () => {
      const utter  = new SpeechSynthesisUtterance(clean);
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
  const isNative = Capacitor.isNativePlatform();

  let userJwt = "";
  try {
    const { data } = await supabase?.auth.getSession() ?? { data: null };
    userJwt = data?.session?.access_token ?? "";
  } catch (_e) {}

  const headers = {
    "Content-Type": "application/json",
    ...(userJwt ? { "Authorization": `Bearer ${userJwt}` } : {}),
  };
  const body = JSON.stringify({ text });

  if (isNative) {
    const r = await CapacitorHttp.post({
      url:         TTS_URL,
      headers,
      data:        body,
      readTimeout: 60000,
    });
    if (r.status !== 200) throw new Error(`TTS HTTP ${r.status}`);
    const parsed = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
    const b64 = parsed?.audio_base64;
    if (!b64) throw new Error("No audio from server");
    return b64;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(TTS_URL, { method: "POST", signal: controller.signal, headers, body });
    if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
    const data = await res.json();
    const b64 = data.audio_base64;
    if (!b64) throw new Error("No audio returned");
    return b64;
  } finally {
    clearTimeout(timer);
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

// TTS is ON by default — the setting is opt-out ("0" = disabled).
// An absent key means "never explicitly disabled" → enabled.
export function isTtsEnabled() {
  try { return localStorage.getItem("kt_tts_enabled") !== "0"; }
  catch { return true; }
}

export async function speakText(text, lang = "en") {
  if (!isTtsEnabled()) return;
  if (!text || !text.trim()) return;
  cancelTTS();

  const clean = text.replace(/\*\*/g, "").replace(/#+\s*/g, "").trim().slice(0, 700);
  try {
    const base64 = await serverTTS(clean);
    await playBase64(base64);
  } catch (_e) {
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
