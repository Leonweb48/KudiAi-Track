import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { LocalNotifications }       from "@capacitor/local-notifications";

const TTS_URL = "https://kudiai.app/api/tts";
const SECRET  = process.env.REACT_APP_EMAIL_SECRET;

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

// Last-resort fallback using the device speech engine
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
  const headers = {
    "Content-Type":     "application/json",
    "x-trigger-secret": SECRET || "",
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

// ── WhatsApp-style heads-up notification for transaction events ─────────────
const TXN_CHANNEL = "kt_txn_alerts";
let _channelReady = false;

async function ensureTxnChannel() {
  if (_channelReady) return;
  try {
    await LocalNotifications.createChannel({
      id:          TXN_CHANNEL,
      name:        "Transaction Alerts",
      description: "Real-time sales and payment alerts",
      importance:  5,
      sound:       "default",
      vibration:   true,
      visibility:  1,
    });
    _channelReady = true;
  } catch {}
}

const EVENT_NOTIF = {
  cashIn:      { title: "💰 Cash In",      body: "Money received"         },
  cashOut:     { title: "💸 Cash Out",     body: "Payment made"           },
  stockIn:     { title: "📦 Stock Added",  body: "New stock recorded"     },
  creditSaved: { title: "📋 Credit Saved", body: "Customer credit recorded"},
  ajoDeposit:  { title: "🏦 Ajo Deposit",  body: "Contribution saved"     },
  ajoWithdraw: { title: "🏧 Ajo Withdraw", body: "Withdrawal completed"   },
};

export async function speakEvent(event, lang = "en", extra = {}) {
  if (!Capacitor.isNativePlatform()) return;
  const tpl  = EVENT_NOTIF[event] || { title: "KudiAI Track", body: "Transaction recorded" };
  const amt  = extra.amount ? `  ₦${Number(extra.amount).toLocaleString("en-NG")}` : "";
  const body = `${tpl.body}${amt}`;
  try {
    await ensureTxnChannel();
    await LocalNotifications.schedule({
      notifications: [{
        id:        Math.floor(Math.random() * 2_000_000),
        title:     tpl.title,
        body,
        channelId: TXN_CHANNEL,
        sound:     "default",
        smallIcon: "ic_stat_icon_config_sample",
        iconColor: "#16a34a",
      }],
    });
  } catch (e) {
    console.error("[Notif] speakEvent failed:", e?.message || e);
  }
}
