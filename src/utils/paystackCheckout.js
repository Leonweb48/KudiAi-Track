import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { InAppBrowser, ToolBarType } from "@capgo/capacitor-inappbrowser";

function isBrowserAvailable() {
  try { return Capacitor.isPluginAvailable("Browser"); } catch { return false; }
}
function isInAppBrowserAvailable() {
  try { return Capacitor.isPluginAvailable("InAppBrowser"); } catch { return false; }
}

const APP_SCHEME    = "com.amayatechnologies.kuditrack";
const VERCEL_ORIGIN = "https://kudiai.app";

// Both the legacy path and the new dedicated bridge path are intercepted.
// This handles in-flight payments that stored the old callback URL.
const CALLBACK_PATHS = ["/payment-return", "/app/payment-callback"];

function isCallbackUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === "kudiai.app" && CALLBACK_PATHS.some(p => u.pathname.startsWith(p));
  } catch {
    return false;
  }
}

export const isNative = () => Capacitor.isNativePlatform();

/**
 * Build a Paystack callback URL.
 *
 * Native: use the dedicated /app/payment-callback bridge page at kudiai.app
 *         (App Links intent-filter is registered for this path — narrower scope than /payment-return).
 *         InAppBrowser intercepts the redirect before the page renders, so the user never
 *         sees the bridge page.  If InAppBrowser is unavailable, the page shows a branded
 *         "Return to KudiAI Track" button backed by the custom scheme.
 *
 * Web: append params to the current page URL so the SPA handles the return in-place.
 */
export function buildCallbackUrl(webBaseUrl, params = {}) {
  if (isNative()) {
    const qs = new URLSearchParams(params).toString();
    return `${VERCEL_ORIGIN}/app/payment-callback${qs ? `?${qs}` : ""}`;
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
 *
 * Native (primary):  @capgo/capacitor-inappbrowser openWebView — a controllable native WebView
 *   that fires urlChangeEvent on every navigation.  When Paystack redirects to our callback path,
 *   we extract the reference, close the WebView, and dispatch paymentCallback.
 *   The user never sees the bridge page — the redirect is intercepted at the navigation layer.
 *
 * Native (fallback): @capacitor/browser (Chrome Custom Tabs) when InAppBrowser is unavailable.
 *   Relies on the bridge page button and the existing appUrlOpen / browserFinished path.
 *
 * Web: full-page redirect (unchanged behaviour).
 */
export async function openPaystackCheckout(authorizationUrl) {
  if (!isNative()) {
    window.location.href = authorizationUrl;
    return;
  }

  if (isInAppBrowserAvailable()) {
    let intercepted = false;
    let urlListener, closeListener;

    // If App Links fire and dispatch paymentCallback before our urlChangeEvent sees the URL,
    // close the WebView immediately so the user is not left looking at a blank WebView.
    const onExternalPaymentCallback = () => {
      intercepted = true;
      InAppBrowser.close().catch(() => {});
      window.removeEventListener("paymentCallback", onExternalPaymentCallback);
    };

    try {
      await InAppBrowser.openWebView({
        url: authorizationUrl,
        toolbarType: ToolBarType.COMPACT,
        title: "Secure Payment",
      });

      // Intercept the Paystack post-payment redirect before the page renders
      urlListener = await InAppBrowser.addListener("urlChangeEvent", async ({ url }) => {
        if (!isCallbackUrl(url)) return;
        intercepted = true;

        const sp       = new URL(url).searchParams;
        const bill_ref = sp.get("bill_ref")  || "";
        const ref      = sp.get("reference") || sp.get("trxref") || "";
        const qs       = new URLSearchParams();
        if (bill_ref) qs.set("bill_ref", bill_ref);
        if (ref)      qs.set("reference", ref);

        try { await InAppBrowser.close(); } catch { /* safe to ignore */ }

        const cbUrl = `${APP_SCHEME}://payment-callback?${qs.toString()}`;
        window.removeEventListener("paymentCallback", onExternalPaymentCallback);
        window.dispatchEvent(new CustomEvent("paymentCallback", { detail: { url: cbUrl } }));
      });

      // WebView dismissed — user closed it manually (back button / swipe-down)
      closeListener = await InAppBrowser.addListener("closeEvent", () => {
        urlListener?.remove();
        closeListener?.remove();
        window.removeEventListener("paymentCallback", onExternalPaymentCallback);
        if (!intercepted) {
          // Equivalent of @capacitor/browser browserFinished — triggers orphan verification
          window.dispatchEvent(new CustomEvent("inAppBrowserFinished"));
        }
      });

      window.addEventListener("paymentCallback", onExternalPaymentCallback);
      return; // success — WebView is open
    } catch {
      urlListener?.remove();
      closeListener?.remove();
      window.removeEventListener("paymentCallback", onExternalPaymentCallback);
      // Fall through to @capacitor/browser
    }
  }

  // Fallback: Chrome Custom Tabs (existing behaviour)
  if (isBrowserAvailable()) {
    await Browser.open({ url: authorizationUrl });
  } else {
    window.open(authorizationUrl, "_system");
  }
}

/**
 * Open Paystack in a popup/in-app browser for flows that don't redirect the page
 * (Ajo contributions, CoopMemberPortal, etc.).
 *
 * Returns a cleanup function — call it on component unmount.
 * onClose(urlRef?) is called when payment is done or the browser is closed.
 */
export function openPaystackPopup(authorizationUrl, { onClose } = {}) {
  if (isNative()) {
    if (isBrowserAvailable()) {
      Browser.open({ url: authorizationUrl });
      let listener;
      Browser.addListener("browserFinished", () => {
        listener?.remove();
        onClose?.();
      }).then((l) => { listener = l; });
      return () => listener?.remove();
    }
    window.open(authorizationUrl, "_system");
    const t = setTimeout(() => onClose?.(), 5000);
    return () => clearTimeout(t);
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
      } catch { /* cross-origin Paystack domain — keep polling */ }
    } catch { clearInterval(poll); }
  }, 500);

  return () => clearInterval(poll);
}

export { APP_SCHEME };
