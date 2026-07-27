import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App";
import { LanguageProvider } from "./contexts/LanguageContext";
import { ToastProvider } from "./components/Toast";
import { CapacitorUpdater } from "@capgo/capacitor-updater";
import { Capacitor } from "@capacitor/core";

// Key used to carry a downloaded bundle ID across the WebView reload boundary.
// localStorage persists across webView.loadUrl() calls (same https://localhost origin).
const PENDING_BUNDLE_KEY = "kt_capgo_pending_bundle";

async function boot() {
  // Logcat marker: visible as "Capacitor/console: [KT/boot]" in adb logcat.
  // A true JS restart emits this; a plain resume/lock-return does NOT.
  // Filter with: adb logcat | grep "KT/boot"
  console.log("[KT/boot]", new Date().toISOString());

  if (Capacitor.isNativePlatform()) {
    // Tell Capgo this bundle loaded successfully — prevents auto-rollback.
    CapacitorUpdater.notifyAppReady().catch(() => {});

    // --- Apply any bundle downloaded in a previous session ---
    // We do this BEFORE rendering React so the WebView reload triggered by set()
    // happens inside the splash-screen window and is invisible to the user.
    // autoUpdate is set to "onlyDownload" so the native installNext() never fires
    // on background — we own the install trigger entirely from JS.
    const pendingId = localStorage.getItem(PENDING_BUNDLE_KEY);
    if (pendingId) {
      // Remove FIRST so a failed/stale set() doesn't cause an infinite reload loop.
      localStorage.removeItem(PENDING_BUNDLE_KEY);
      try {
        const { bundles } = await CapacitorUpdater.list();
        const bundle = bundles.find(b => b.id === pendingId && b.status === "pending");
        if (bundle) {
          // set() reloads the WebView immediately.  Execution after this call will
          // not continue in the current JS context; React never renders this pass.
          CapacitorUpdater.set(bundle).catch(() => {});
          return;
        }
      } catch {}
      // If list() failed or bundle not found, fall through and render normally.
    }

    // --- Record newly downloaded bundles for the NEXT cold start ---
    // We deliberately do NOT call next() here.  Calling next() writes to Capgo's
    // "nextBundle" slot which installNext() picks up on every appMovedToBackground()
    // event and reloads the WebView mid-session — the root cause of the apparent
    // cold-restart.  Storing in localStorage and applying at the top of this function
    // on the next cold start is safe and invisible to the user.
    CapacitorUpdater.addListener("updateAvailable", (info) => {
      try { localStorage.setItem(PENDING_BUNDLE_KEY, info.bundle.id); } catch {}
    });
  }

  const root = ReactDOM.createRoot(document.getElementById("root"));
  root.render(
    <BrowserRouter>
      <LanguageProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </LanguageProvider>
    </BrowserRouter>
  );

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/service-worker.js").catch(() => {});
    });
  }
}

boot();
