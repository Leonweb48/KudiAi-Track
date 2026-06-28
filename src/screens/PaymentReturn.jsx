import { useEffect } from "react";

const APP_SCHEME = "com.amayatechnologies.kuditrack";

/**
 * Landing page deployed on Vercel at /payment-return.
 * Paystack redirects here after a payment (native flow).
 * This page immediately forwards all URL params to the app's deep-link scheme,
 * which Android intercepts and hands back to our Capacitor WebView via appUrlOpen.
 */
export default function PaymentReturn() {
  const search = window.location.search;

  useEffect(() => {
    const deepLink = `${APP_SCHEME}://payment-callback${search}`;
    window.location.replace(deepLink);
  }, [search]);

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
      <p style={{ fontSize: 14, color: "#64748b", maxWidth: 280, lineHeight: 1.5, margin: 0 }}>
        Returning to KudiAI Track to confirm your payment…
      </p>
      <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 16 }}>
        You can close this tab if it doesn't close automatically.
      </p>
    </div>
  );
}
