import { useState, useCallback } from "react";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";

const isNative = Capacitor.isNativePlatform();

// Opens Flutterwave's hosted BVN consent page and resolves once the user has
// returned — native via the same custom-scheme deep link Google Sign-In
// already uses in this app; web via a polled popup (same pattern as
// openPaystackPopup in src/utils/paystackCheckout.js). Does not itself confirm
// verification succeeded — caller still calls checkBvnVerification() after.
function openConsent(url) {
  return new Promise((resolve) => {
    if (isNative) {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        window.removeEventListener("bvnVerificationCallback", onEvt);
        resolve();
      };
      const onEvt = () => finish();
      window.addEventListener("bvnVerificationCallback", onEvt);
      // Safety valve: resolve even if no deep link fires (e.g. user backs out manually).
      Browser.addListener("browserFinished", finish);
      Browser.open({ url });
    } else {
      const popup = window.open(url, "bvn-verify", "width=480,height=760");
      const timer = setInterval(() => {
        if (!popup || popup.closed) { clearInterval(timer); resolve(); return; }
        try {
          if (popup.location.origin === window.location.origin) {
            popup.close();
            clearInterval(timer);
            resolve();
          }
        } catch { /* still on Flutterwave's origin — cross-origin read blocked, expected */ }
      }, 500);
    }
  });
}

// Shared BVN-verification flow for every wallet-activation screen. `wallet` is
// the object returned by useWallet() (needs startBvnVerification/checkBvnVerification).
export function useBvnVerification(wallet) {
  const [pending, setPending] = useState(false);
  const [checking, setChecking] = useState(false);

  const pollStatus = useCallback(async () => {
    for (let i = 0; i < 5; i++) {
      const status = await wallet.checkBvnVerification();
      if (!status.pending) return status;
      if (i < 4) await new Promise((r) => setTimeout(r, 1500));
    }
    return { ok: true, verified: false, pending: true };
  }, [wallet]);

  // Starts a brand-new consent request (costs a real Flutterwave call), opens
  // the consent page, waits for return, then checks status.
  const verify = useCallback(async (bvn) => {
    const redirect_url = isNative
      ? "com.amayatechnologies.kuditrack://bvn-callback"
      : `${window.location.origin}/bvn-return`;
    const init = await wallet.startBvnVerification(bvn, redirect_url);
    if (!init.alreadyConsented) await openConsent(init.url);
    const status = await pollStatus();
    setPending(!!status.pending);
    return status;
  }, [wallet, pollStatus]);

  // Re-checks an already-started verification — no new consent request, no
  // extra charge. Used when a prior attempt came back "still processing".
  const checkAgain = useCallback(async () => {
    setChecking(true);
    try {
      const status = await pollStatus();
      setPending(!!status.pending);
      return status;
    } finally {
      setChecking(false);
    }
  }, [pollStatus]);

  return { verify, checkAgain, pending, checking };
}
