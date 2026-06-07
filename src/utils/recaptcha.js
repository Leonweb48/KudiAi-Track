import { Capacitor } from "@capacitor/core";

const SITE_KEY = process.env.REACT_APP_RECAPTCHA_SITE_KEY;

export async function verifyRecaptcha(action = "submit") {
  // Skip on native mobile — reCAPTCHA is web-only
  if (Capacitor.isNativePlatform() || !SITE_KEY) return true;

  try {
    const token = await new Promise((resolve, reject) => {
      window.grecaptcha.ready(async () => {
        try {
          const t = await window.grecaptcha.execute(SITE_KEY, { action });
          resolve(t);
        } catch (e) {
          reject(e);
        }
      });
    });

    const res = await fetch("/api/verify-captcha", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data = await res.json();
    return data.success;
  } catch {
    return true; // fail open — don't block users if service is down
  }
}
