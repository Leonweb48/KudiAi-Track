import { useEffect, useState } from "react";

const APP_SCHEME = "com.amayatechnologies.kuditrack";

/**
 * Landing page at /payment-return.
 * Paystack redirects here after every payment — success OR failure.
 * We don't know the outcome yet; verification happens inside the app.
 * Auto-redirect via intent:// is often blocked by Chrome CCT without a
 * user gesture, so the button is the primary path.
 */
export default function PaymentReturn() {
  const search   = window.location.search;
  const params   = new URLSearchParams(search);
  const ref      = params.get("reference") || params.get("trxref") || params.get("bill_ref") || "";

  const intentUrl =
    `intent://payment-callback${search}` +
    `#Intent;scheme=${APP_SCHEME};package=com.amayatechnologies.kuditrack;end;`;

  const [autoTried, setAutoTried] = useState(false);

  useEffect(() => {
    // Attempt auto-redirect — succeeds on some Chrome versions even without gesture
    const t = setTimeout(() => {
      window.location.href = intentUrl;
      setAutoTried(true);
    }, 400);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "32px 24px",
      background: "linear-gradient(160deg, #f0f4ff 0%, #fafafa 100%)",
      fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
      textAlign: "center",
      boxSizing: "border-box",
    }}>

      {/* App icon */}
      <div style={{
        width: 80, height: 80, borderRadius: 24,
        background: "linear-gradient(135deg, #1B2A5E, #2d4a8a)",
        display: "flex", alignItems: "center", justifyContent: "center",
        marginBottom: 24,
        boxShadow: "0 8px 32px rgba(27,42,94,0.25)",
      }}>
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
          <circle cx="20" cy="20" r="16" stroke="white" strokeWidth="2.5" strokeOpacity="0.4"/>
          <path d="M12 20l5 5 11-11" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>

      {/* Heading */}
      <h1 style={{
        fontSize: 22, fontWeight: 800,
        color: "#1B2A5E", margin: "0 0 10px",
        letterSpacing: "-0.3px",
      }}>
        Payment Submitted
      </h1>

      {/* Subtext */}
      <p style={{
        fontSize: 14, color: "#64748b",
        maxWidth: 300, lineHeight: 1.6,
        margin: "0 0 10px",
      }}>
        Tap the button below to return to <strong style={{ color: "#1B2A5E" }}>KudiAI Track</strong>.
        Your payment will be verified and your service delivered automatically.
      </p>

      {ref && (
        <p style={{
          fontSize: 11, color: "#94a3b8",
          fontFamily: "monospace",
          margin: "0 0 28px",
          background: "#f1f5f9",
          padding: "4px 10px",
          borderRadius: 6,
        }}>
          Ref: {ref.slice(0, 24)}
        </p>
      )}

      {/* Primary return button */}
      <a
        href={intentUrl}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          background: "linear-gradient(135deg, #1B2A5E, #2d4a8a)",
          color: "#fff",
          fontWeight: 800,
          fontSize: 16,
          padding: "16px 36px",
          borderRadius: 16,
          textDecoration: "none",
          boxShadow: "0 6px 24px rgba(27,42,94,0.35)",
          width: "100%",
          maxWidth: 320,
          boxSizing: "border-box",
          letterSpacing: "0.1px",
        }}
      >
        {/* Arrow-in-circle icon */}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 8 16 12 12 16"/>
          <line x1="8" y1="12" x2="16" y2="12"/>
        </svg>
        Return to KudiAI Track
      </a>

      {/* Tip for users who see this page */}
      {autoTried && (
        <p style={{
          fontSize: 12, color: "#94a3b8",
          marginTop: 20, maxWidth: 280, lineHeight: 1.5,
        }}>
          If the app does not open, tap the button above or open KudiAI Track manually — your payment is saved.
        </p>
      )}

      {/* Divider + refund note */}
      <div style={{
        marginTop: 36,
        padding: "16px 20px",
        background: "#eff6ff",
        borderRadius: 12,
        border: "1px solid #bfdbfe",
        maxWidth: 320,
        width: "100%",
        boxSizing: "border-box",
      }}>
        <p style={{ fontSize: 12, color: "#1d4ed8", margin: 0, lineHeight: 1.5, fontWeight: 600 }}>
          If payment was not successful, any deduction will be reversed automatically within 5–7 business days.
        </p>
      </div>

    </div>
  );
}
