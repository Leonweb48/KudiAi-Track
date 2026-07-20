import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App";
import { LanguageProvider } from "./contexts/LanguageContext";
import { ToastProvider } from "./components/Toast";
import { CapacitorUpdater } from "@capgo/capacitor-updater";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";


if (Capacitor.isNativePlatform()) {
  // Tell Capgo this bundle loaded successfully — prevents auto-rollback
  CapacitorUpdater.notifyAppReady().catch(() => {});

  // Apply downloaded updates on next app foreground rather than next cold launch.
  // Without this, clearing app data requires two full restarts to get current code.
  let pendingBundle = null;
  CapacitorUpdater.addListener("updateAvailable", (info) => {
    pendingBundle = info.bundle;
  });
  CapacitorApp.addListener("appStateChange", ({ isActive }) => {
    if (isActive && pendingBundle) {
      const b = pendingBundle;
      pendingBundle = null;
      CapacitorUpdater.set(b).catch(() => {});
    }
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
