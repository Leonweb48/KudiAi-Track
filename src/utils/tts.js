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

// Play base64 audio returned by the TTS API
function playBase64(base64, mimeType) {
  return new Promise((resolve, reject) => {
    const audio = new Audio(`data:${mimeType};base64,${base64}`);
    _current = audio;
    audio.onended  = () => { _current = null; resolve(); };
    audio.onerror  = () => { _current = null; reject(new Error("audio decode error")); };
    // Reject so caller can fall through to speechSynthesis if play is blocked
    audio.play().catch((e) => { _current = null; reject(e); });
  });
}

// Call the server TTS endpoint via CapacitorHttp (bypasses WebView CORS)
async function serverTTS(payload) {
  const res = await CapacitorHttp.post({
    url: TTS_URL,
    headers: {
      "Content-Type":     "application/json",
      "x-trigger-secret": SECRET || "",
    },
    data: JSON.stringify(payload),
  });
  if (res.status !== 200) throw new Error(`TTS HTTP ${res.status}`);
  const data = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
  if (!data.audio_base64) throw new Error("No audio returned");
  return data;
}

/**
 * Speak arbitrary text.
 * Native: uses Gemini TTS via the admin API → plays as HTML5 Audio.
 * Web: uses window.speechSynthesis.
 */
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

/**
 * Speak a short celebratory phrase for a transaction event.
 * event: "cashIn" | "cashOut" | "stockIn" | "creditSaved" | "ajoDeposit" | "ajoWithdraw"
 * Native only — no web fallback (events are silent on web).
 */
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
