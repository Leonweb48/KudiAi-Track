import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App";
import { LanguageProvider } from "./contexts/LanguageContext";
import { ToastProvider } from "./components/Toast";
import { CapacitorUpdater } from "@capgo/capacitor-updater";
import { Capacitor } from "@capacitor/core";


if (Capacitor.isNativePlatform()) {
  // Tell Capgo this bundle loaded successfully — prevents auto-rollback
  CapacitorUpdater.notifyAppReady().catch(() => {});

  // Queue new bundle for next cold start — do NOT call set() which reloads
  // the WebView immediately (CapacitorUpdater.set = apply + reload RIGHT NOW).
  // The old code used set() inside appStateChange which restarted the app on
  // every resume: CCT close, image-picker return, minimize→reopen, all of them.
  // next() marks the bundle without touching the running session; it activates
  // the next time the user fully kills and relaunches the app.
  CapacitorUpdater.addListener("updateAvailable", (info) => {
    CapacitorUpdater.next(info.bundle).catch(() => {});
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
