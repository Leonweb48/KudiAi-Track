import { useState, useCallback } from "react";
import { supabase } from "../utils/supabase";

const shakeCSS = `
@keyframes shake {
  0%,100% { transform: translateX(0); }
  20%,60%  { transform: translateX(-6px); }
  40%,80%  { transform: translateX(6px); }
}
.txn-pin-shake { animation: shake 0.5s ease; }
`;

const BackspaceIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor"
    strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z" />
    <line x1="18" y1="9" x2="13" y2="14" />
    <line x1="13" y1="9" x2="18" y2="14" />
  </svg>
);

function computeLockedMsg(data) {
  if (!data?.lockedUntil) return "Too many attempts. Try again later.";
  const ms = new Date(data.lockedUntil) - Date.now();
  if (ms <= 0) return "Too many attempts. Try again shortly.";
  const mins = Math.ceil(ms / 60000);
  return `Too many attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`;
}

const PAD = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export default function TransactionPinModal({
  title = "Confirm Payment",
  amount,
  recipient,
  description,
  onApprove,
  onCancel,
}) {
  const [pin,   setPin]   = useState("");
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);

  const triggerShake = useCallback(() => {
    setShake(true);
    setTimeout(() => setShake(false), 600);
  }, []);

  const handleVerify = useCallback(async (enteredPin) => {
    try {
      const { data, error: fnError } = await (supabase?.functions.invoke("pin-manager", {
        body: { action: "verify_txn_pin", pin: enteredPin },
      }) ?? Promise.resolve({ data: null, error: new Error("Supabase not configured") }));

      if (fnError) throw fnError;

      if (data?.success) {
        onApprove?.(enteredPin);
        return;
      }

      triggerShake();
      setPin("");

      if (data?.locked) {
        setError(computeLockedMsg(data));
        return;
      }
      const left = data?.attemptsLeft ?? "";
      setError(`Incorrect PIN.${left ? ` ${left} attempt${left === 1 ? "" : "s"} remaining.` : ""}`);
    } catch {
      triggerShake();
      setPin("");
      setError("Something went wrong. Try again.");
    }
  }, [onApprove, triggerShake]);

  const handleDigit = useCallback((d) => {
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    setError("");
    if (next.length === 4) {
      setTimeout(() => handleVerify(next), 150);
    }
  }, [pin, handleVerify]);

  const handleDelete = useCallback(() => {
    setPin(p => p.slice(0, -1));
    setError("");
  }, []);

  return (
    <>
      <style>{shakeCSS}</style>

      {/* Scrim */}
      <div
        onClick={onCancel}
        style={{
          position: "fixed", inset: 0, zIndex: 300,
          background: "rgba(0,0,0,0.55)",
        }}
      />

      {/* Bottom sheet */}
      <div style={{
        position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 301,
        background: "white",
        borderRadius: "24px 24px 0 0",
        paddingBottom: "env(safe-area-inset-bottom, 16px)",
        boxShadow: "0 -8px 40px rgba(0,0,0,0.18)",
        animation: "slideUp 0.28s cubic-bezier(0.34,1.56,0.64,1)",
      }}>
        <style>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>

        {/* Handle bar */}
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 12, paddingBottom: 8 }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: "#e2e8f0" }} />
        </div>

        {/* Title */}
        <p style={{ textAlign: "center", fontWeight: 700, fontSize: 17, color: "#0f172a", padding: "0 24px", marginBottom: 16 }}>
          {title}
        </p>

        {/* Transaction summary */}
        {(amount != null || recipient || description) && (
          <div style={{
            margin: "0 16px 20px",
            background: "#f8fafc",
            borderRadius: 16,
            padding: "16px",
          }}>
            {amount != null && (
              <p style={{ textAlign: "center", fontSize: 28, fontWeight: 800, color: "#3DA829", marginBottom: 8 }}>
                ₦{(amount / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}
              </p>
            )}
            {recipient && (
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: "#94a3b8" }}>To</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#1e293b" }}>{recipient}</span>
              </div>
            )}
            {description && (
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, color: "#94a3b8" }}>Note</span>
                <span style={{ fontSize: 13, color: "#475569", maxWidth: 200, textAlign: "right" }}>{description}</span>
              </div>
            )}
          </div>
        )}

        {/* PIN entry area */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "0 24px" }}>
          <p style={{ fontSize: 13, color: "#64748b", textAlign: "center" }}>
            Enter your transaction PIN to confirm
          </p>

          {/* Dots */}
          <div
            className={shake ? "txn-pin-shake" : ""}
            style={{ display: "flex", gap: 16, justifyContent: "center" }}
          >
            {[0, 1, 2, 3].map(i => (
              <div key={i} style={{
                width: 16, height: 16, borderRadius: "50%",
                border: "2px solid",
                borderColor: pin.length > i ? "#3DA829" : "#cbd5e1",
                background: pin.length > i ? "#3DA829" : "transparent",
                transition: "all 0.15s",
                transform: pin.length > i ? "scale(1.1)" : "scale(1)",
              }} />
            ))}
          </div>

          {/* Error */}
          <div style={{ height: 16, marginTop: -8 }}>
            {error && (
              <p style={{ color: "#ef4444", fontSize: 12, fontWeight: 600, textAlign: "center" }}>
                {error}
              </p>
            )}
          </div>

          {/* Keypad */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, width: "100%", maxWidth: 280 }}>
            {PAD.map(n => (
              <button key={n} onClick={() => handleDigit(String(n))}
                style={{
                  height: 56, borderRadius: 14,
                  background: "#f1f5f9", border: "none",
                  color: "#0f172a", fontSize: 19, fontWeight: 700,
                  cursor: "pointer", transition: "transform 0.1s, background 0.1s",
                }}
                onMouseDown={e => e.currentTarget.style.transform = "scale(0.95)"}
                onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}
                onTouchStart={e => e.currentTarget.style.background = "#e2e8f0"}
                onTouchEnd={e => e.currentTarget.style.background = "#f1f5f9"}
              >
                {n}
              </button>
            ))}

            {/* Empty slot */}
            <div />

            <button onClick={() => handleDigit("0")}
              style={{
                height: 56, borderRadius: 14,
                background: "#f1f5f9", border: "none",
                color: "#0f172a", fontSize: 19, fontWeight: 700,
                cursor: "pointer", transition: "transform 0.1s",
              }}
              onMouseDown={e => e.currentTarget.style.transform = "scale(0.95)"}
              onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}
            >
              0
            </button>

            <button onClick={handleDelete}
              style={{
                height: 56, borderRadius: 14,
                background: "#f1f5f9", border: "none",
                color: "#475569", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "transform 0.1s",
              }}
              onMouseDown={e => e.currentTarget.style.transform = "scale(0.95)"}
              onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}
            >
              <BackspaceIcon />
            </button>
          </div>

          {/* Cancel */}
          <button onClick={onCancel}
            style={{
              background: "none", border: "none",
              color: "#94a3b8", fontSize: 14, cursor: "pointer",
              padding: "8px 24px", marginBottom: 4,
            }}>
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
