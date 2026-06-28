import { Capacitor, CapacitorHttp } from "@capacitor/core";

const TTS_URL = "https://admin.kudiai.app/api/public/tts";
const SECRET  = process.env.REACT_APP_EMAIL_SECRET;

let _current = null;

export function cancelTTS() {
  if (_current) {
    _current.pause();
    _current = null;
  }
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

function playBase64(base64, mimeType) {
  return new Promise((resolve, reject) => {
    const audio = new Audio(`data:${mimeType};base64,${base64}`);
    _current = audio;
    audio.onended  = () => { _current = null; resolve(); };
    audio.onerror  = (e) => { _current = null; reject(new Error(`audio decode error: ${e?.message || e}`)); };
    audio.play().catch((e) => { _current = null; reject(e); });
  });
}

// Device TTS — uses Android/iOS system voice. Works even when Gemini quota is hit.
// Does NOT set utter.lang to uncommon codes like "en-NG" — most Android devices
// only have "en-US" or "en-GB" installed; setting an unsupported code causes silence.
function deviceSpeak(text) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) { resolve(); return; }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text.replace(/\*\*/g, "").replace(/#+\s*/g, ""));
    utter.rate  = 0.88;
    utter.pitch = 1.05;
    utter.volume = 1.0;
    // Pick the best available English voice; fall through to system default
    const voices = window.speechSynthesis.getVoices();
    const pick = voices.find(v => v.lang.startsWith("en-")) || voices[0];
    if (pick) utter.voice = pick;
    utter.onend   = () => resolve();
    utter.onerror = () => resolve();
    window.speechSynthesis.speak(utter);
    // Safety: resolve after 30s regardless
    setTimeout(resolve, 30000);
  });
}

async function serverTTS(payload) {
  const ttsHeaders = {
    "Content-Type":     "application/json",
    "x-trigger-secret": SECRET || "",
  };

  if (Capacitor.isNativePlatform()) {
    console.log("[TTS] native → CapacitorHttp.post", payload);
    const r = await CapacitorHttp.post({
      url:         TTS_URL,
      headers:     ttsHeaders,
      data:        JSON.stringify(payload),
      readTimeout: 60000,
    });
    console.log("[TTS] response status:", r.status, "quota_exceeded:", !!r.data?.quota_exceeded, "has audio:", !!r.data?.audio_base64);
    if (r.status !== 200) throw new Error(`TTS HTTP ${r.status}: ${JSON.stringify(r.data)}`);
    // quota_exceeded → signal caller to use device TTS
    if (r.data?.quota_exceeded) return { quota_exceeded: true };
    if (!r.data?.audio_base64) throw new Error(`No audio. keys: ${Object.keys(r.data || {}).join(",")}`);
    return r.data;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(TTS_URL, {
      method:  "POST",
      signal:  controller.signal,
      headers: ttsHeaders,
      body:    JSON.stringify(payload),
    });
    if (res.status !== 200) throw new Error(`TTS HTTP ${res.status}`);
    const data = await res.json();
    if (data.quota_exceeded) return { quota_exceeded: true };
    if (!data.audio_base64) throw new Error("No audio returned");
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function speakText(text, lang = "en") {
  if (!text || !text.trim()) return;
  cancelTTS();

  const clean = text.replace(/\*\*/g, "").replace(/#+\s*/g, "").trim().slice(0, 700);
  try {
    const data = await serverTTS({ text: clean, lang });
    if (data.quota_exceeded) {
      await deviceSpeak(clean);
      return;
    }
    await playBase64(data.audio_base64, data.mime_type || "audio/mp3");
  } catch (e) {
    console.error("[TTS] speakText failed:", e?.message || e);
    await deviceSpeak(clean);
  }
}

export async function speakEvent(event, lang = "en") {
  if (!Capacitor.isNativePlatform()) return;
  cancelTTS();
  try {
    const data = await serverTTS({ event, lang });
    if (data.quota_exceeded) {
      await deviceSpeak(event.replace(/([A-Z])/g, " $1").trim());
      return;
    }
    await playBase64(data.audio_base64, data.mime_type || "audio/mp3");
  } catch (e) {
    console.error("[TTS] speakEvent failed:", e?.message || e);
  }
}
