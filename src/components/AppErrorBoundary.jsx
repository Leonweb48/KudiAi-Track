import { Component } from "react";
import { isChunkLoadError, reloadOnceForNewVersion } from "../utils/lazyWithRetry";

// The whole app's safety net (2026-10-14). Before this there was none, so any error while starting up left a blank
// white page that only closing the app or refreshing got past. Now: a part of the app that failed to download (an old
// version after a deploy) reloads once by itself; anything else shows a screen with a Reload button instead of white.
export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, reloading: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[app] crashed:", error?.message || error, info?.componentStack?.slice(0, 600));
    if (isChunkLoadError(error) && reloadOnceForNewVersion()) this.setState({ reloading: true });
  }

  reload = async () => {
    this.setState({ reloading: true });
    // web: drop a stale offline copy of the app so the reload fetches the current version
    try {
      if (!window.Capacitor?.isNativePlatform?.() && "caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => /workbox-precache|kudiai-pages/.test(k)).map((k) => caches.delete(k)));
      }
    } catch { /* best effort */ }
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        padding: 24, textAlign: "center", fontFamily: "DM Sans, system-ui, sans-serif", background: "#f8fafc", color: "#0f172a" }}>
        <img src="/icon-192.png" alt="" width={64} height={64} style={{ borderRadius: 16, marginBottom: 16 }} />
        <p style={{ fontSize: 18, fontWeight: 800 }}>{this.state.reloading ? "Updating KudiAI Track…" : "Something went wrong"}</p>
        {!this.state.reloading && (
          <>
            <p style={{ fontSize: 14, color: "#64748b", marginTop: 6, maxWidth: 320, lineHeight: 1.5 }}>
              Your data is safe. Reload to continue — if you're offline, connect and try again.
            </p>
            <button onClick={this.reload}
              style={{ marginTop: 20, padding: "12px 28px", borderRadius: 12, border: "none", background: "#2f8a1f", color: "#fff", fontWeight: 700, fontSize: 15 }}>
              Reload
            </button>
          </>
        )}
      </div>
    );
  }
}
