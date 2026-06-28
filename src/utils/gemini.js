import { Capacitor, CapacitorHttp } from "@capacitor/core";

const CHAT_URL = "https://admin.kudiai.app/api/public/chat";
const SECRET   = process.env.REACT_APP_EMAIL_SECRET;

function errorMessage(err, status) {
  if (typeof navigator !== "undefined" && !navigator.onLine)
    return "No internet connection. Please check your network and try again.";
  if (err?.name === "AbortError")
    return "Request timed out. Please try again.";
  if (status === 401 || status === 403)
    return "Authentication error. Please refresh the page and try again.";
  if (status === 429)
    return "Too many requests. Please wait a moment and try again.";
  if (status === 502 || status === 503)
    return "AI service is temporarily unavailable. Please try again in a minute.";
  return "Couldn't connect to AI. Please check your connection and try again.";
}

export async function askGemini({
  message,
  context     = "",
  history     = [],
  lang        = "en",
  onChunk,
  timeout     = 90000,
  maxAttempts = 3,
}) {
  const reqHeaders = {
    "Content-Type":     "application/json",
    "x-trigger-secret": SECRET || "",
  };

  // Native Android: CapacitorHttp bypasses WebView CORS; request no_stream so
  // the server returns JSON { text } instead of a ReadableStream.
  if (Capacitor.isNativePlatform()) {
    const payload = { message, lang, businessContext: context, history, no_stream: true };
    let lastErr = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, attempt === 1 ? 1000 : 2000));
      try {
        const r = await CapacitorHttp.post({
          url:         CHAT_URL,
          headers:     reqHeaders,
          data:        JSON.stringify(payload),
          readTimeout: timeout,
        });
        if (r.status !== 200) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
        const text = String(r.data?.text || r.data || "");
        if (text && onChunk) onChunk(text);
        return text;
      } catch (e) {
        lastErr = e;
        if (e?.status === 401 || e?.status === 403 || e?.status === 429) break;
        if (typeof navigator !== "undefined" && !navigator.onLine) break;
      }
    }
    throw new Error(errorMessage(lastErr, lastErr?.status));
  }

  // Web: fetch with streaming reader
  let lastErr    = null;
  let lastStatus = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, attempt === 1 ? 1000 : 2000));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const payload = { message, lang, businessContext: context, history };
      const res = await fetch(CHAT_URL, {
        method:  "POST",
        signal:  controller.signal,
        headers: reqHeaders,
        body:    JSON.stringify(payload),
      });

      clearTimeout(timer);

      if (!res.ok) {
        throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
      }

      const text = await res.text();
      if (text && onChunk) onChunk(text);
      return text || "";

    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (e?.status) lastStatus = e.status;
      if (e?.name === "AbortError") break;
      if (typeof navigator !== "undefined" && !navigator.onLine) break;
      if (e?.status === 401 || e?.status === 403 || e?.status === 429) break;
    }
  }

  throw new Error(errorMessage(lastErr, lastStatus));
}
