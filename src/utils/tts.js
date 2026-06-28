const TTS_URL = "https://admin.kudiai.app/api/public/tts";
const SECRET  = process.env.REACT_APP_EMAIL_SECRET;

import { Capacitor } from "@capacitor/core";

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
    audio.onerror  = () => { _current = null; reject(new Error("audio decode error")); };
    audio.play().catch((e) => { _current = null; reject(e); });
  });
}

async function serverTTS(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(TTS_URL, {
      method:  "POST",
      signal:  controller.signal,
      headers: {
        "Content-Type":     "application/json",
        "x-trigger-secret": SECRET || "",
      },
      body: JSON.stringify(payload),
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
    } catch {
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
  } catch {
    // non-critical
  }
}
