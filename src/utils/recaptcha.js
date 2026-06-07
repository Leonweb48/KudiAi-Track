import { Capacitor } from "@capacitor/core";

export const RECAPTCHA_V2_KEY = process.env.REACT_APP_RECAPTCHA_V2_SITE_KEY || "";

export const isNative = () => Capacitor.isNativePlatform();

export async function verifyRecaptchaV2Token(token) {
  if (!token) return false;
  try {
    const res = await fetch("/api/verify-captcha", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data = await res.json();
    return data.success;
  } catch {
    return true; // fail open if service is down
  }
}
