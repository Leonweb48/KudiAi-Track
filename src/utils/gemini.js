const CHAT_URL = "https://admin.kudiai.app/api/public/chat";
const SECRET   = "kuditrack-email-trigger-2026-amaya";

function errorMessage(err, res) {
  if (typeof navigator !== "undefined" && !navigator.onLine)
    return "No internet connection. Please check your network and try again.";
  if (err?.name === "AbortError")
    return "Request timed out. Please try again.";
  if (res?.status === 401 || res?.status === 403)
    return "Authentication error. Please refresh the page and try again.";
  if (res?.status === 429)
    return "Too many requests. Please wait a moment and try again.";
  if (res?.status === 502 || res?.status === 503)
    return "AI service is temporarily unavailable. Please try again in a minute.";
  return "Couldn't connect to AI. Please check your connection and try again.";
}

/**
 * Sends a message to KudiAI (Gemini) with automatic retry and streaming.
 *
 * @param {Object}   opts
 * @param {string}   opts.message   - User's message
 * @param {string}  [opts.context]  - Portal context string (user data summary)
 * @param {Array}   [opts.history]  - Prior messages [{role, text}]
 * @param {string}  [opts.lang]     - Language code, default "en"
 * @param {Function}[opts.onChunk]  - Called with each streamed text chunk
 * @param {number}  [opts.timeout]  - Per-attempt timeout ms, default 20000
 * @param {number}  [opts.maxAttempts] - Total attempts, default 2
 * @returns {Promise<string>}       - Full reply text
 */
export async function askGemini({
  message,
  context    = "",
  history    = [],
  lang       = "en",
  onChunk,
  timeout    = 20000,
  maxAttempts = 2,
}) {
  let lastErr = null;
  let lastRes = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, attempt === 1 ? 1000 : 2000));
    }

    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(CHAT_URL, {
        method:  "POST",
        headers: {
          "Content-Type":     "application/json",
          "x-trigger-secret": SECRET,
        },
        body:   JSON.stringify({ message, lang, businessContext: context, history }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      lastRes = res;

      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status}`);
        // Don't retry on auth errors or rate-limit
        if (res.status === 401 || res.status === 403 || res.status === 429) break;
        continue;
      }

      if (res.body) {
        const reader  = res.body.getReader();
        const decoder = new TextDecoder();
        let full = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          full += chunk;
          if (onChunk) onChunk(chunk);
        }
        return full;
      }

      // Non-streaming fallback
      const text = await res.text();
      if (onChunk && text) onChunk(text);
      return text || "";

    } catch (e) {
      clearTimeout(timeoutId);
      lastErr = e;
      if (e?.name === "AbortError") break;
      if (typeof navigator !== "undefined" && !navigator.onLine) break;
    }
  }

  throw new Error(errorMessage(lastErr, lastRes));
}
