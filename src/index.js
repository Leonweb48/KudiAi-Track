import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App";
import { LanguageProvider } from "./contexts/LanguageContext";
import { ToastProvider } from "./components/Toast";
import { CapacitorUpdater } from "@capgo/capacitor-updater";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

class AppErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: "monospace", background: "#fff", color: "#b91c1c", minHeight: "100vh" }}>
          <strong>App crashed — copy this and send to developer:</strong>
          <pre style={{ whiteSpace: "pre-wrap", marginTop: 12, fontSize: 13 }}>
            {this.state.error?.message}{"\n\n"}{this.state.error?.stack}
          </pre>
          <button onClick={() => window.location.reload()}
            style={{ marginTop: 16, padding: "8px 16px", background: "#1e40af", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

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
  <React.StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        <LanguageProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </LanguageProvider>
      </BrowserRouter>
    </AppErrorBoundary>
  </React.StrictMode>
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {});
  });
}
