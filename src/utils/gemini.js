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
  timeout     = 30000,
  maxAttempts = 3,
}) {
  let lastErr    = null;
  let lastStatus = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, attempt === 1 ? 1000 : 2000));

    let rejectTimer;
    const timerPromise = new Promise((_, reject) => {
      rejectTimer = setTimeout(
        () => reject(Object.assign(new Error("timeout"), { name: "AbortError" })),
        timeout,
      );
    });

    try {
      const text = await Promise.race([
        (async () => {
          const payload = { message, lang, businessContext: context, history };
          const headers = {
            "Content-Type":     "application/json",
            "x-trigger-secret": SECRET || "",
          };

          if (Capacitor.isNativePlatform()) {
            // Native HTTP bypasses WebView CORS restrictions
            const res = await CapacitorHttp.post({
              url: CHAT_URL,
              headers,
              data: JSON.stringify(payload),
            });
            if (res.status < 200 || res.status >= 300) {
              throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
            }
            return typeof res.data === "string" ? res.data : JSON.stringify(res.data);
          }

          const res = await fetch(CHAT_URL, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
          });
          if (!res.ok) {
            throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
          }
          return await res.text();
        })(),
        timerPromise,
      ]);

      clearTimeout(rejectTimer);
      if (text && onChunk) onChunk(text);
      return text || "";

    } catch (e) {
      clearTimeout(rejectTimer);
      lastErr = e;
      if (e?.status) lastStatus = e.status;
      // Don't retry on timeout, offline, or auth/rate-limit errors
      if (e?.name === "AbortError") break;
      if (typeof navigator !== "undefined" && !navigator.onLine) break;
      if (e?.status === 401 || e?.status === 403 || e?.status === 429) break;
    }
  }

  throw new Error(errorMessage(lastErr, lastStatus));
}
