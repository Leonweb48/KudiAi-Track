import { Capacitor, CapacitorHttp } from "@capacitor/core";

const TTS_URL = "https://admin.kudiai.app/api/public/tts";
const SECRET  = process.env.REACT_APP_EMAIL_SECRET;

const SPEECH_LANG = {
  en: "en-NG", pidgin: "en-NG", ha: "ha", ig: "ig", yo: "yo",
};

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
    console.log("[TTS] response status:", r.status, "has audio:", !!r.data?.audio_base64);
    if (r.status !== 200) throw new Error(`TTS HTTP ${r.status}: ${JSON.stringify(r.data)}`);
    if (!r.data?.audio_base64) throw new Error(`No audio returned. data keys: ${Object.keys(r.data || {}).join(",")}`);
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
    if (!data.audio_base64) throw new Error("No audio returned");
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function speakText(text, lang = "en") {
  if (!text || !text.trim()) return;
  cancelTTS();

  if (Capacitor.isNativePlatform()) {
    try {
      const clean = text.replace(/\*\*/g, "").replace(/#+\s*/g, "").trim().slice(0, 700);
      const data  = await serverTTS({ text: clean, lang });
      await playBase64(data.audio_base64, data.mime_type || "audio/mp3");
      return;
    } catch (e) {
      console.error("[TTS] speakText failed:", e?.message || e);
      // fall through to speechSynthesis
    }
  }

  if (!("speechSynthesis" in window)) return;
  const utter = new SpeechSynthesisUtterance(text.replace(/\*\*/g, ""));
  utter.lang  = SPEECH_LANG[lang] || "en-NG";
  utter.rate  = 0.92;
  utter.pitch = 1.0;
  window.speechSynthesis.speak(utter);
}

export async function speakEvent(event, lang = "en") {
  if (!Capacitor.isNativePlatform()) return;
  cancelTTS();
  try {
    const data = await serverTTS({ event, lang });
    await playBase64(data.audio_base64, data.mime_type || "audio/mp3");
  } catch (e) {
    console.error("[TTS] speakEvent failed:", e?.message || e);
  }
}
