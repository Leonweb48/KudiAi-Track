import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { supabase } from "./supabase";

const TTS_URL = "https://admin.kudiai.app/api/public/tts";

let _current = null;

export function cancelTTS() {
  if (_current) {
    _current.pause();
    _current = null;
  }
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

function playBase64(base64) {
  return new Promise((resolve, reject) => {
    const audio = new Audio(`data:audio/mp3;base64,${base64}`);
    _current = audio;
    audio.onended = () => { _current = null; resolve(); };
    audio.onerror = (e) => { _current = null; reject(new Error(`audio error: ${e?.message || e}`)); };
    audio.play().catch((e) => { _current = null; reject(e); });
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

export async function speakText(text, lang = "en") {
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

// speakEvent is kept as a no-op — callers (AddTxnModal) still import it
export async function speakEvent() {}
