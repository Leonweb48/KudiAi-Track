import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { LocalNotifications }       from "@capacitor/local-notifications";
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

// ── WhatsApp-style heads-up notifications for transaction events ────────────

export const TXN_CHANNEL = "kt_txn_alerts";
let _channelReady = false;

export async function ensureTxnChannel() {
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

// Format amount as ₦84,999.78
function fmtAmt(amount) {
  if (!amount && amount !== 0) return "";
  return ` ₦${Number(amount).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Build rich notification body from event + extra data
function buildBody(event, extra) {
  const amt = fmtAmt(extra.amount);
  switch (event) {
    case "cashIn":
      return extra.payer
        ? `${extra.payer} paid${amt}`
        : `Money received${amt}`;
    case "cashOut":
      return extra.recipient
        ? `Paid${amt} to ${extra.recipient}`
        : `Payment made${amt}`;
    case "stockIn":
      if (extra.item) {
        const qty = extra.qty ? ` (${extra.qty} units)` : "";
        return `${extra.item} added to inventory${qty}`;
      }
      return `New stock recorded${amt}`;
    case "creditSaved":
      return extra.customer
        ? `${extra.customer} owes${amt}`
        : `Credit recorded${amt}`;
    case "ajoDeposit":
      return extra.customer
        ? `${extra.customer} contributed${amt}`
        : `Contribution saved${amt}`;
    case "ajoWithdraw":
      return `Withdrawal completed${amt}`;
    default:
      return `Transaction recorded${amt}`;
  }
}

const EVENT_META = {
  cashIn:      { title: "💰 Cash In",      actionTypeId: "PAYMENT_ACTION", route: "/transactions" },
  cashOut:     { title: "💸 Cash Out",      actionTypeId: "PAYMENT_ACTION", route: "/transactions" },
  stockIn:     { title: "📦 Stock Added",   actionTypeId: "STOCK_ACTION",   route: "/inventory"    },
  creditSaved: { title: "📋 Credit Saved",  actionTypeId: "CREDIT_ACTION",  route: "/finance"      },
  ajoDeposit:  { title: "🏦 Ajo Deposit",   actionTypeId: "ASO_ACTION",     route: "/aso"          },
  ajoWithdraw: { title: "🏧 Ajo Withdraw",  actionTypeId: "ASO_ACTION",     route: "/aso"          },
};

export async function speakEvent(event, lang = "en", extra = {}) {
  if (!Capacitor.isNativePlatform()) return;
  const meta  = EVENT_META[event] || { title: "KudiAI Track", actionTypeId: null, route: "/" };
  const body  = buildBody(event, extra);

  try {
    await ensureTxnChannel();
    await LocalNotifications.schedule({
      notifications: [{
        id:           Math.floor(Math.random() * 2_000_000),
        title:        meta.title,
        body,
        largeBody:    body,          // BigTextStyle — expands in drawer
        largeIcon:    "ic_notification_large",
        smallIcon:    "ic_notification",
        iconColor:    "#3DA829",
        channelId:    TXN_CHANNEL,
        sound:        "default",
        actionTypeId: meta.actionTypeId,
        extra:        { route: meta.route, ...extra },
      }],
    });
  } catch (e) {
    console.error("[Notif] speakEvent failed:", e?.message || e);
  }
}
