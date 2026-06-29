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

// Gemini TTS returns raw 16-bit LE PCM at 24 kHz.
// Browsers cannot decode bare PCM — wrap it in a WAV header first.
function pcmToWav(base64Pcm, sampleRate = 24000) {
  const pcm = Uint8Array.from(atob(base64Pcm), c => c.charCodeAt(0));
  const buf  = new ArrayBuffer(44 + pcm.length);
  const view = new DataView(buf);
  const str  = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  str(0, "RIFF"); view.setUint32(4, 36 + pcm.length, true);
  str(8, "WAVE"); str(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, "data"); view.setUint32(40, pcm.length, true);
  new Uint8Array(buf, 44).set(pcm);
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function resolveAudio(data) {
  const mt = (data.mime_type || "audio/mp3").toLowerCase();
  if (mt.includes("pcm") || mt.includes("l16")) {
    const rate = parseInt((mt.match(/rate=(\d+)/) || [])[1] || "24000");
    return { base64: pcmToWav(data.audio_base64, rate), mimeType: "audio/wav" };
  }
  return { base64: data.audio_base64, mimeType: mt || "audio/mp3" };
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

// Device TTS — last-resort fallback using the system speech engine.
// Does NOT set utter.lang to unsupported codes like "en-NG"; most Android
// devices only have en-US / en-GB, and an unsupported code causes silence.
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
      const pick = voices.find(v => v.lang.startsWith("en-")) || voices[0];
      if (pick) utter.voice = pick;
      utter.onend   = () => resolve();
      utter.onerror = () => resolve();
      window.speechSynthesis.speak(utter);
    };

    // On Android, getVoices() often returns [] until voiceschanged fires
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      doUtter();
    } else {
      let done = false;
      const fire = () => { if (done) return; done = true; window.speechSynthesis.onvoiceschanged = null; doUtter(); };
      window.speechSynthesis.onvoiceschanged = fire;
      setTimeout(fire, 500); // fallback if event never fires
    }

    setTimeout(resolve, 30000); // safety ceiling
  });
}

async function serverTTS(payload) {
  const ttsHeaders = {
    "Content-Type":     "application/json",
    "x-trigger-secret": SECRET || "",
  };

  if (Capacitor.isNativePlatform()) {
    const r = await CapacitorHttp.post({
      url:         TTS_URL,
      headers:     ttsHeaders,
      data:        JSON.stringify(payload),
      readTimeout: 60000,
    });
    if (r.status !== 200) throw new Error(`TTS HTTP ${r.status}`);
    // CapacitorHttp may return r.data as a string if Content-Type isn't exactly application/json
    const parsed = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
    if (parsed?.quota_exceeded) return { quota_exceeded: true };
    if (!parsed?.audio_base64) throw new Error(`No audio from server`);
    return parsed;
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
    if (data.quota_exceeded) { await deviceSpeak(clean); return; }
    const { base64, mimeType } = resolveAudio(data);
    await playBase64(base64, mimeType);
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
    if (data.quota_exceeded) { await deviceSpeak(event.replace(/([A-Z])/g, " $1").trim()); return; }
    const { base64, mimeType } = resolveAudio(data);
    await playBase64(base64, mimeType);
  } catch (e) {
    console.error("[TTS] speakEvent failed:", e?.message || e);
  }
}
