import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { supabase } from "./supabase";

const TTS_URL = "https://admin.kudiai.app/api/public/tts";

// ── AudioContext (shared, persisted across calls) ────────────────────────────
let _audioCtx  = null;
let _currentSrc = null;

function getAudioCtx() {
  if (!_audioCtx || _audioCtx.state === "closed") {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    console.log("[TTS-DIAG] AudioContext created, initial state:", _audioCtx.state);
  }
  return _audioCtx;
}

export function unlockAudio() {
  try {
    if (typeof window === "undefined") return;
    console.log("[TTS-DIAG] unlockAudio() called");
    const ctx = getAudioCtx();
    console.log("[TTS-DIAG] ctx.state before resume:", ctx.state);
    const resumePromise = ctx.state === "suspended" ? ctx.resume() : Promise.resolve();
    resumePromise
      .then(() => console.log("[TTS-DIAG] ctx.state after resume:", ctx.state))
      .catch(e => console.log("[TTS-DIAG] resume() error:", e?.message));
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
    console.log("[TTS-DIAG] silent buffer played for unlock");
  } catch (e) {
    console.log("[TTS-DIAG] unlockAudio() threw:", e?.message);
  }
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
      console.log("[TTS-DIAG] playBase64() entry — ctx.state:", ctx.state, "| base64 length:", base64?.length ?? "null/undefined");

      const binary = atob(base64);
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      console.log("[TTS-DIAG] calling decodeAudioData, bytes:", bytes.length);
      ctx.decodeAudioData(
        bytes.buffer,
        (audioBuffer) => {
          console.log("[TTS-DIAG] decodeAudioData SUCCESS — duration:", audioBuffer.duration.toFixed(2), "s | ctx.state:", ctx.state);
          if (_currentSrc) {
            try { _currentSrc.stop(); } catch (e) {}
            _currentSrc = null;
          }
          const src = ctx.createBufferSource();
          src.buffer = audioBuffer;
          src.connect(ctx.destination);
          _currentSrc = src;
          src.onended = () => { _currentSrc = null; console.log("[TTS-DIAG] playback ended"); resolve(); };
          if (ctx.state === "suspended") {
            console.log("[TTS-DIAG] ctx suspended at src.start — calling resume() first");
            ctx.resume()
              .then(() => { console.log("[TTS-DIAG] resumed, now calling src.start(0)"); src.start(0); })
              .catch(e => { console.log("[TTS-DIAG] resume() failed before start:", e?.message); reject(e); });
          } else {
            console.log("[TTS-DIAG] calling src.start(0)");
            src.start(0);
          }
        },
        (err) => {
          console.log("[TTS-DIAG] decodeAudioData FAILED:", err?.message || String(err));
          reject(new Error(`decode error: ${err?.message || err}`));
        }
      );
    } catch (e) {
      console.log("[TTS-DIAG] playBase64() threw:", e?.message);
      reject(e);
    }
  });
}

function deviceSpeak(text) {
  console.log("[TTS-DIAG] deviceSpeak() called — falling back to speechSynthesis");
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) {
      console.log("[TTS-DIAG] speechSynthesis not available");
      resolve();
      return;
    }
    window.speechSynthesis.cancel();

    const doUtter = () => {
      const utter = new SpeechSynthesisUtterance(text.replace(/\*\*/g, "").replace(/#+\s*/g, ""));
      utter.rate   = 0.88;
      utter.pitch  = 1.05;
      utter.volume = 1.0;
      const voices = window.speechSynthesis.getVoices();
      console.log("[TTS-DIAG] speechSynthesis voices available:", voices.length);
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
  console.log("[TTS-DIAG] serverTTS() — isNativePlatform:", isNative, "| text length:", text.length);

  let userJwt = "";
  try {
    const { data } = await supabase?.auth.getSession() ?? { data: null };
    userJwt = data?.session?.access_token ?? "";
    console.log("[TTS-DIAG] JWT present:", !!userJwt);
  } catch (e) {
    console.log("[TTS-DIAG] getSession() failed:", e?.message);
  }

  const headers = {
    "Content-Type": "application/json",
    ...(userJwt ? { "Authorization": `Bearer ${userJwt}` } : {}),
  };
  const body = JSON.stringify({ text });

  if (isNative) {
    console.log("[TTS-DIAG] using CapacitorHttp.post →", TTS_URL);
    const r = await CapacitorHttp.post({
      url:         TTS_URL,
      headers,
      data:        body,
      readTimeout: 60000,
    });
    console.log("[TTS-DIAG] CapacitorHttp response status:", r.status, "| data type:", typeof r.data, "| data length:", typeof r.data === "string" ? r.data.length : JSON.stringify(r.data)?.length ?? "?");
    if (r.status !== 200) throw new Error(`TTS HTTP ${r.status}`);
    const parsed = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
    const b64 = parsed?.audio_base64;
    console.log("[TTS-DIAG] parsed.audio_base64 length:", b64?.length ?? "MISSING");
    if (!b64) throw new Error("No audio from server");
    return b64;
  }

  console.log("[TTS-DIAG] using fetch →", TTS_URL);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(TTS_URL, { method: "POST", signal: controller.signal, headers, body });
    console.log("[TTS-DIAG] fetch response status:", res.status);
    if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
    const data = await res.json();
    const b64 = data.audio_base64;
    console.log("[TTS-DIAG] fetch parsed audio_base64 length:", b64?.length ?? "MISSING");
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
  const enabled = isTtsEnabled();
  console.log("[TTS-DIAG] speakText() — isTtsEnabled:", enabled, "| text:", text?.slice(0, 60));
  if (!enabled) return;
  if (!text || !text.trim()) return;
  cancelTTS();

  const clean = text.replace(/\*\*/g, "").replace(/#+\s*/g, "").trim().slice(0, 700);
  try {
    console.log("[TTS-DIAG] calling serverTTS...");
    const base64 = await serverTTS(clean);
    console.log("[TTS-DIAG] serverTTS returned base64 length:", base64?.length);
    await playBase64(base64);
  } catch (e) {
    console.log("[TTS-DIAG] server TTS failed:", e?.message, "— falling back to deviceSpeak");
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
  console.log("[TTS-DIAG] speakEvent() — key:", eventKey, "| isTtsEnabled:", isTtsEnabled());
  if (!isTtsEnabled()) return;
  const text = EVENT_TEXT[eventKey] || "Action recorded";
  await speakText(text, lang).catch(() => {});
}
