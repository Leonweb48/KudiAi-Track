import { Capacitor, CapacitorHttp } from "@capacitor/core";

const EMAIL_URL = "https://admin.kudiai.app/api/public/email-trigger";
// .env is gitignored so REACT_APP_EMAIL_SECRET is undefined on Vercel builds.
// Fall back to the known value so production deployments can fire email triggers.
const SECRET    = process.env.REACT_APP_EMAIL_SECRET || "kuditrack-email-trigger-2026-amaya";

/**
 * Fire-and-forget email trigger.
 * On native: uses CapacitorHttp (bypasses WebView CORS from https://localhost).
 * On web: uses regular fetch.
 */
export function sendEmailTrigger(event, data) {
  const headers = {
    "Content-Type":     "application/json",
    "x-trigger-secret": SECRET || "",
  };
  const body = JSON.stringify({ event, data });

  if (Capacitor.isNativePlatform()) {
    CapacitorHttp.post({ url: EMAIL_URL, headers, data: body })
      .then(r => { if (r.status >= 400) console.warn("[Email]", event, r.status); })
      .catch(e => console.warn("[Email] native fetch failed:", e));
  } else {
    fetch(EMAIL_URL, { method: "POST", headers, body })
      .then(r => r.json())
      .then(res => console.log("[Email]", event, res))
      .catch(e => console.warn("[Email] fetch failed:", e));
  }
}
