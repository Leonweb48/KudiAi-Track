import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";

const APP_SCHEME    = "com.amayatechnologies.kuditrack";
const VERCEL_ORIGIN = "https://kuditrack-kappa.vercel.app";

export const isNative = () => Capacitor.isNativePlatform();

/**
 * Build a Paystack callback URL.
 *
 * On native Android we use an HTTPS Vercel URL so Paystack accepts it.
 * Our /payment-return page immediately redirects to the deep link
 * com.amayatechnologies.kuditrack://payment-callback?... which brings
 * the user back into the app via the appUrlOpen event.
 *
 * On web we use the normal https URL.
 */
export function buildCallbackUrl(webBaseUrl, params = {}) {
  if (isNative()) {
    const qs = new URLSearchParams(params).toString();
    return `${VERCEL_ORIGIN}/payment-return${qs ? `?${qs}` : ""}`;
  }
  try {
    const url = new URL(webBaseUrl);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    return url.toString();
  } catch {
    return webBaseUrl;
  }
}

/**
 * Open the Paystack checkout URL.
 * Native: opens Chrome Custom Tabs (in-app overlay) via @capacitor/browser.
 * Web: redirects the current page.
 */
export async function openPaystackCheckout(authorizationUrl) {
  if (isNative()) {
    await Browser.open({ url: authorizationUrl });
  } else {
    window.location.href = authorizationUrl;
  }
}

/**
 * Open Paystack in a popup/in-app browser for flows that don't redirect the page
 * (Ajo contributions, where verification is done in-place after the browser closes).
 *
 * Returns a cleanup function — call it on component unmount.
 *
 * onClose(urlRef?) is called when payment is done or the browser is closed.
 * urlRef may be the Paystack reference captured from the redirect URL on web.
 */
export function openPaystackPopup(authorizationUrl, { onClose } = {}) {
  if (isNative()) {
    Browser.open({ url: authorizationUrl });
    let listener;
    Browser.addListener("browserFinished", () => {
      listener?.remove();
      onClose?.();
    }).then((l) => { listener = l; });
    return () => listener?.remove();
  }

  const popup = window.open(
    authorizationUrl,
    "paystack-checkout",
    "width=520,height=700,left=200,top=80,scrollbars=yes",
  );
  if (!popup) { onClose?.(); return () => {}; }

  const poll = setInterval(() => {
    try {
      if (popup.closed) {
        clearInterval(poll);
        setTimeout(() => onClose?.(), 600);
        return;
      }
      try {
        const urlRef = new URL(popup.location.href).searchParams.get("reference");
        if (urlRef) {
          clearInterval(poll);
          popup.close();
          setTimeout(() => onClose?.(urlRef), 300);
        }
      } catch { /* still on Paystack domain — cross-origin, keep polling */ }
    } catch { clearInterval(poll); }
  }, 500);

  return () => clearInterval(poll);
}

/**
 * Deep-link scheme used by the PaymentReturn page to redirect back into the app.
 */
export { APP_SCHEME };
