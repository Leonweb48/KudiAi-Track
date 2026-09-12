import { useEffect } from "react";

/**
 * Landing page at /bvn-return — the redirect_url for Flutterwave's BVN
 * consent flow on web. Reached inside the small popup window opened by
 * useBvnVerification's openConsent(); the PARENT window is polling for the
 * popup to navigate back to our own origin (it can't read the popup's URL
 * while it's still on Flutterwave's domain — that's the actual signal), so
 * this page's only job is to exist at our origin and close itself.
 *
 * Native apps never reach this — they redirect straight to the app's own
 * custom URL scheme instead (see useBvnVerification.js).
 */
export default function BvnVerificationReturn() {
  useEffect(() => {
    const t = setTimeout(() => { try { window.close(); } catch { /* ignore */ } }, 800);
    return () => clearTimeout(t);
  }, []);

  return (
    <div style={{
      minHeight: "100dvh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      padding: "32px 24px",
      background: "linear-gradient(160deg,#f0f4ff 0%,#fafafa 100%)",
      fontFamily: "system-ui,-apple-system,'Segoe UI',sans-serif",
      textAlign: "center", boxSizing: "border-box",
    }}>
      <div style={{
        width: 64, height: 64, borderRadius: 20,
        background: "linear-gradient(135deg,#1B2A5E,#2d4a8a)",
        display: "flex", alignItems: "center", justifyContent: "center",
        marginBottom: 20,
      }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="2" strokeOpacity="0.35" />
          <path d="M8 12l3 3 5-6" stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <p style={{ fontSize: 17, fontWeight: 700, color: "#1B2A5E", margin: "0 0 6px" }}>
        BVN verification complete
      </p>
      <p style={{ fontSize: 13, color: "#64748b", maxWidth: 280, lineHeight: 1.6, margin: 0 }}>
        You can close this window and return to KudiAI Track.
      </p>
    </div>
  );
}
