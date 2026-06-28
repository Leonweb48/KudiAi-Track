import { Capacitor } from "@capacitor/core";

const PUBLIC_KEY = process.env.REACT_APP_PAYSTACK_PUBLIC_KEY;

let scriptLoaded = false;
let loadPromise  = null;

function loadScript() {
  if (scriptLoaded && window.PaystackPop) return Promise.resolve();
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    const s   = document.createElement("script");
    s.src     = "https://js.paystack.co/v1/inline.js";
    s.onload  = () => { scriptLoaded = true; resolve(); };
    s.onerror = () => reject(new Error("Failed to load Paystack checkout"));
    document.head.appendChild(s);
  });
  return loadPromise;
}

/**
 * Open Paystack inline popup on web — no page redirect.
 * Resolves with the payment reference on success.
 * Rejects with Error("cancelled") when the user closes without paying.
 *
 * Never call this on native — use Chrome Custom Tabs via openPaystackCheckout() instead.
 */
export async function openPaystackInline({ email, amount, ref, metadata = {} }) {
  if (Capacitor.isNativePlatform()) {
    throw new Error("openPaystackInline must not be called on native");
  }
  await loadScript();
  return new Promise((resolve, reject) => {
    const handler = window.PaystackPop.setup({
      key:      PUBLIC_KEY,
      email,
      amount:   Math.round(amount * 100), // Paystack takes kobo
      ref,
      metadata,
      channels: ["card", "bank", "ussd", "mobile_money", "bank_transfer"],
      callback: (response) => resolve(response.reference),
      onClose:  () => reject(new Error("cancelled")),
    });
    handler.openIframe();
  });
}
