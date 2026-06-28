import { useEffect } from "react";

const APP_SCHEME = "com.amayatechnologies.kuditrack";

/**
 * Landing page deployed on Vercel at /payment-return.
 * Paystack redirects here after a payment (native flow).
 * Attempts auto-redirect via intent:// URI; falls back to a tap button
 * because Chrome CCT blocks programmatic intent navigation without a user gesture.
 */
export default function PaymentReturn() {
  const search = window.location.search;
  const intentUrl =
    `intent://payment-callback${search}` +
    `#Intent;scheme=${APP_SCHEME};package=com.amayatechnologies.kuditrack;end;`;

  useEffect(() => {
    // Attempt auto-redirect — works on some Chrome versions even without user gesture
    window.location.href = intentUrl;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", height: "100vh",
      fontFamily: "system-ui, -apple-system, sans-serif",
      textAlign: "center", padding: "20px",
      background: "#f8fafc",
    }}>
      <div style={{
        width: 72, height: 72, borderRadius: 20, marginBottom: 20,
        background: "linear-gradient(135deg, #4f46e5, #1B2A5E)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 36,
      }}>
        ✅
      </div>
      <h2 style={{ fontSize: 22, fontWeight: 700, color: "#1B2A5E", margin: "0 0 8px" }}>
        Payment Complete
      </h2>
      <p style={{ fontSize: 14, color: "#64748b", maxWidth: 280, lineHeight: 1.5, margin: "0 0 28px" }}>
        Your payment was successful. Tap the button below to return to KudiAI Track and receive your service.
      </p>
      <a
        href={intentUrl}
        style={{
          display: "inline-block",
          background: "linear-gradient(135deg, #4f46e5, #1B2A5E)",
          color: "#fff", fontWeight: 700, fontSize: 16,
          padding: "14px 32px", borderRadius: 12,
          textDecoration: "none",
          boxShadow: "0 4px 16px rgba(79,70,229,0.3)",
        }}
      >
        Return to KudiAI Track →
      </a>
    </div>
  );
}
