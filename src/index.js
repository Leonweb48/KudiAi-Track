import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App";
import { LanguageProvider } from "./contexts/LanguageContext";
import { ToastProvider } from "./components/Toast";
import { CapacitorUpdater } from "@capgo/capacitor-updater";
import { Capacitor } from "@capacitor/core";
import { consumeAdminAccessLink, AdminAccessBannerHost } from "./utils/adminAccess";
import NewDeviceSelfiePrompt from "./components/NewDeviceSelfiePrompt";
import IosInstallPrompt from "./components/IosInstallPrompt";
import AppErrorBoundary from "./components/AppErrorBoundary";

// Key used to carry a downloaded bundle ID across the WebView reload boundary.
// localStorage persists across webView.loadUrl() calls (same https://localhost origin).
const PENDING_BUNDLE_KEY = "kt_capgo_pending_bundle";

async function boot() {
  // Logcat marker: visible as "Capacitor/console: [KT/boot]" in adb logcat.
  // A true JS restart emits this; a plain resume/lock-return does NOT.
  // Filter with: adb logcat | grep "KT/boot"
  console.log("[KT/boot]", new Date().toISOString());

  if (Capacitor.isNativePlatform()) {
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
          // set() reloads the WebView into the new version, so normally nothing after it runs. If it fails or never
          // reloads (2026-10-14: this used to return regardless, leaving a blank screen until the app was reopened),
          // carry on and open the current version instead — the update is tried again on the next launch.
          const switched = await Promise.race([
            CapacitorUpdater.set(bundle).then(() => true, () => false),
            new Promise((r) => setTimeout(() => r(false), 4000)),
          ]);
          if (switched) return;
          try { localStorage.setItem(PENDING_BUNDLE_KEY, pendingId); } catch {}
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

  // Admin portal "access account" link: sign in as the customer before the app reads the session (web only).
  if (!Capacitor.isNativePlatform()) await consumeAdminAccessLink();

  const root = ReactDOM.createRoot(document.getElementById("root"));
  root.render(
    <AppErrorBoundary>
      <BrowserRouter>
        <LanguageProvider>
          <ToastProvider>
            <App />
            <AdminAccessBannerHost />
            <NewDeviceSelfiePrompt />
            <IosInstallPrompt />
          </ToastProvider>
        </LanguageProvider>
      </BrowserRouter>
    </AppErrorBoundary>
  );

  // Tell Capgo this version started fine. Called after the first render (it used to be called before anything ran), so
  // a version that can't even render is rolled back automatically instead of staying broken.
  if (Capacitor.isNativePlatform()) {
    setTimeout(() => { CapacitorUpdater.notifyAppReady().catch(() => {}); }, 0);
  }

  setupServiceWorker();
}

// Service worker (2026-10-14 rework). The old setup took over every open page the moment a new version was deployed and
// reloaded it — including on someone's very first visit (a page with no worker yet was "taken over" too) and mid-use
// after each of our many daily deploys, sometimes leaving half-loaded screens until a manual refresh. Now:
//  • Android app: no service worker at all — the app's files are already on the phone (and Capgo updates them); a
//    worker only added stale copies and extra reloads there. Any old one is removed.
//  • Website: a new version installs quietly and switches over only while the page is in the BACKGROUND (tab hidden /
//    app switched away), with one reload then. The first visit never reloads. Updates are checked when the page returns.
function setupServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (Capacitor.isNativePlatform()) {
    navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
    if ("caches" in window) caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => {});
    return;
  }

  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloaded) return;      // first install: nothing old to replace
    reloaded = true;
    window.location.reload();
  });

  const switchWhenHidden = (reg) => {
    const waiting = reg.waiting;
    if (!waiting || !navigator.serviceWorker.controller) return;
    const go = () => waiting.postMessage({ type: "SKIP_WAITING" });
    if (document.visibilityState === "hidden") { go(); return; }
    const onHide = () => {
      if (document.visibilityState !== "hidden") return;
      document.removeEventListener("visibilitychange", onHide);
      go();
    };
    document.addEventListener("visibilitychange", onHide);
  };

  const register = () => navigator.serviceWorker.register("/service-worker.js").then((reg) => {
    switchWhenHidden(reg);
    reg.addEventListener("updatefound", () => {
      const sw = reg.installing;
      sw?.addEventListener("statechange", () => { if (sw.state === "installed") switchWhenHidden(reg); });
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") reg.update().catch(() => {});
    });
  }).catch(() => {});

  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}

boot();
