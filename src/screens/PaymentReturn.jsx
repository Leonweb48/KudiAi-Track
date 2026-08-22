import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";

const APP_SCHEME = "com.amayatechnologies.kuditrack";

/**
 * Landing page at https://kudiai.app/payment-return
 *
 * Paystack redirects here after every payment (success OR failure).
 *
 * Android (APK WebView or Chrome): shows a tappable intent:// button that
 *   opens the APK directly. isNativePlatform() is false inside Chrome Custom
 *   Tabs and external browsers — we detect Android via UA instead so the
 *   button also renders when OPay / bank apps open this URL in Chrome.
 *
 * Web (non-Android): immediately redirects to /bills preserving query params.
 */
export default function PaymentReturn() {
  const navigate = useNavigate();
  const search   = window.location.search;
  const params   = new URLSearchParams(search);
  const ref      = params.get("reference") || params.get("trxref") || params.get("bill_ref") || "";

  // isNativePlatform() = true only inside the APK's own WebView.
  // isAndroidBrowser = Chrome / OPay / bank app opened this URL on Android.
  // Both cases need the intent button — the web redirect is for desktop / iOS.
  const isNative        = Capacitor.isNativePlatform();
  const isAndroidBrowser = !isNative && /android/i.test(navigator.userAgent);
  const needsIntentButton = isNative || isAndroidBrowser;

  useEffect(() => {
    if (needsIntentButton) return;
    // Non-Android web: client-side navigate to /bills so the React tree is not
    // fully remounted (window.location.replace re-ran useState initializers and
    // stale ck_bill_pending_* keys sent users to the wrong screen).
    navigate(`/bills${search}`, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Non-Android web: transitional spinner while redirect fires ───────────
  if (!needsIntentButton) {
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
          <div style={{
            width: 28, height: 28, border: "3px solid rgba(255,255,255,0.9)",
            borderTopColor: "transparent", borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }} />
        </div>
        <p style={{ fontSize: 17, fontWeight: 700, color: "#1B2A5E", margin: "0 0 6px" }}>
          Verifying payment…
        </p>
        <p style={{ fontSize: 13, color: "#64748b", maxWidth: 280, lineHeight: 1.6, margin: 0 }}>
          Returning you to the app. This will only take a moment.
        </p>
        {ref && (
          <p style={{
            fontSize: 11, color: "#94a3b8", fontFamily: "monospace",
            marginTop: 16, background: "#f1f5f9",
            padding: "4px 10px", borderRadius: 6, display: "inline-block",
          }}>
            Ref: {ref.slice(0, 28)}
          </p>
        )}
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ── Android: intent button opens APK regardless of App Links status ──────
  // Uses the custom-scheme intent handler registered in AndroidManifest.xml.
  // The browser_fallback_url ensures a graceful degradation if the APK is not
  // installed. The appUrlOpen listener in App.jsx processes the incoming URL.
  const fallback   = encodeURIComponent(`https://kudiai.app/payment-return${search}`);
  const intentUrl  =
    `intent://payment-callback${search}` +
    `#Intent;scheme=${APP_SCHEME};package=com.amayatechnologies.kuditrack` +
    `;S.browser_fallback_url=${fallback};end`;

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
        width: 88, height: 88, borderRadius: 26,
        background: "linear-gradient(135deg,#1B2A5E,#2d4a8a)",
        display: "flex", alignItems: "center", justifyContent: "center",
        marginBottom: 28, boxShadow: "0 10px 40px rgba(27,42,94,0.30)",
      }}>
        <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
          <circle cx="22" cy="22" r="18" stroke="white" strokeWidth="2" strokeOpacity="0.35"/>
          <path d="M13 22l6 6 12-12" stroke="white" strokeWidth="3.2"
            strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>

      <h1 style={{
        fontSize: 24, fontWeight: 800, color: "#1B2A5E",
        margin: "0 0 10px", letterSpacing: "-0.4px",
      }}>
        Payment Processed
      </h1>

      <p style={{
        fontSize: 15, color: "#475569", maxWidth: 290, lineHeight: 1.65, margin: "0 0 8px",
      }}>
        Tap the button below to return to{" "}
        <strong style={{ color: "#1B2A5E" }}>KudiAI Track</strong>.
        Your payment will be verified and your service delivered instantly.
      </p>

      {ref && (
        <p style={{
          fontSize: 11, color: "#94a3b8", fontFamily: "monospace",
          margin: "0 0 30px", background: "#f1f5f9",
          padding: "5px 12px", borderRadius: 7, display: "inline-block",
        }}>
          Ref: {ref.slice(0, 28)}
        </p>
      )}

      {!ref && <div style={{ marginBottom: 30 }} />}

      <a
        href={intentUrl}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
          background: "linear-gradient(135deg,#1B2A5E,#2d4a8a)",
          color: "#fff", fontWeight: 800, fontSize: 17,
          padding: "18px 40px", borderRadius: 18, textDecoration: "none",
          boxShadow: "0 8px 28px rgba(27,42,94,0.38)",
          width: "100%", maxWidth: 340, boxSizing: "border-box",
          letterSpacing: "0.1px", WebkitTapHighlightColor: "transparent",
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 8 16 12 12 16"/>
          <line x1="8" y1="12" x2="16" y2="12"/>
        </svg>
        Return to KudiAI Track
      </a>

      <p style={{
        fontSize: 12, color: "#94a3b8", marginTop: 22, maxWidth: 290, lineHeight: 1.55,
      }}>
        If the app does not open, tap the button above or open KudiAI Track
        manually — your payment is saved and will be verified when you return
        to the Bills page.
      </p>

      <div style={{
        marginTop: 32, padding: "14px 18px", background: "#eff6ff",
        borderRadius: 14, border: "1px solid #bfdbfe",
        maxWidth: 340, width: "100%", boxSizing: "border-box",
      }}>
        <p style={{ fontSize: 12, color: "#1d4ed8", margin: 0, lineHeight: 1.55, fontWeight: 600 }}>
          If the payment was not successful, any deduction will be reversed
          automatically within 5–7 business days.
        </p>
      </div>

    </div>
  );
}
