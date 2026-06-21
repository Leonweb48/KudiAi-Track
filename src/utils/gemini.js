const CHAT_URL = "https://admin.kudiai.app/api/public/chat";
const SECRET   = "kuditrack-email-trigger-2026-amaya";

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

    // A timer promise that always rejects after `timeout` ms so Promise.race
    // can never hang forever regardless of fetch/body-read behaviour.
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
          const res = await fetch(CHAT_URL, {
            method:  "POST",
            headers: {
              "Content-Type":     "application/json",
              "x-trigger-secret": SECRET,
            },
            body: JSON.stringify({ message, lang, businessContext: context, history }),
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
