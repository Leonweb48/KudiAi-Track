import { useState, useCallback } from "react";
import { supabase } from "../utils/supabase";
import PinDots from "./PinDots";

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
  const [pin,       setPin]       = useState("");
  const [error,     setError]     = useState("");
  const [shake,     setShake]     = useState(false);
  const [verifying, setVerifying] = useState(false);

  const triggerShake = useCallback(() => {
    setShake(true);
    setTimeout(() => setShake(false), 600);
  }, []);

  const handleVerify = useCallback(async (enteredPin) => {
    setVerifying(true);
    try {
      const { data, error: fnError } = await (supabase?.functions.invoke("pin-manager", {
        body: { action: "verify_txn_pin", pin: enteredPin },
      }) ?? Promise.resolve({ data: null, error: new Error("Supabase not configured") }));

      if (fnError) throw fnError;

      if (data?.success) {
        onApprove?.(enteredPin);
        return; // modal closes — no need to reset verifying
      }

      triggerShake();
      setPin("");
      setVerifying(false);

      if (data?.locked) {
        setError(computeLockedMsg(data));
        return;
      }
      const left = data?.attemptsLeft ?? "";
      setError(`Incorrect PIN.${left ? ` ${left} attempt${left === 1 ? "" : "s"} remaining.` : ""}`);
    } catch {
      triggerShake();
      setPin("");
      setVerifying(false);
      setError("Something went wrong. Try again.");
    }
  }, [onApprove, triggerShake]);

  const handleDigit = useCallback((d) => {
    // Block input while a verification call is in-flight to prevent a second
    // handleVerify from being scheduled before the first one completes.
    if (verifying || pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    setError("");
    if (next.length === 4) {
      setTimeout(() => handleVerify(next), 150);
    }
  }, [verifying, pin, handleVerify]);

  const handleDelete = useCallback(() => {
    if (verifying) return; // block backspace during verification
    setPin(p => p.slice(0, -1));
    setError("");
  }, [verifying]);

  return (
    <>
      <style>{shakeCSS}</style>

      {/* Scrim — z-pin-scrim (300) from token scale */}
      <div
        onClick={onCancel}
        style={{
          position: "fixed", inset: 0, zIndex: "var(--z-pin-scrim)",
          background: "rgba(0,0,0,0.55)",
        }}
      />

      {/* Bottom sheet — z-pin-sheet (301) from token scale */}
      <div className="bg-white dark:bg-slate-900" style={{
        position: "fixed", left: 0, right: 0, bottom: 0, zIndex: "var(--z-pin-sheet)",
        borderRadius: "24px 24px 0 0",
        paddingBottom: "env(safe-area-inset-bottom, 16px)",
        boxShadow: "0 -8px 40px rgba(0,0,0,0.18)",
        animation: "slideUp 0.28s cubic-bezier(0.34,1.56,0.64,1)",
      }}>
        <style>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>

        {/* Handle bar */}
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 12, paddingBottom: 8 }}>
          <div className="bg-slate-200 dark:bg-slate-700" style={{ width: 40, height: 4, borderRadius: 2 }} />
        </div>

        {/* Title */}
        <p className="text-slate-900 dark:text-slate-100" style={{ textAlign: "center", fontWeight: 700, fontSize: 17, padding: "0 24px", marginBottom: 16 }}>
          {title}
        </p>

        {/* Transaction summary */}
        {(amount != null || recipient || description) && (
          <div className="bg-slate-50 dark:bg-slate-800" style={{
            margin: "0 16px 20px",
            borderRadius: 16,
            padding: "16px",
          }}>
            {amount != null && (
              <p className="text-brand-500" style={{ textAlign: "center", fontSize: 28, fontWeight: 800, marginBottom: 8 }}>
                ₦{(amount / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}
              </p>
            )}
            {recipient && (
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span className="text-slate-400" style={{ fontSize: 12 }}>To</span>
                <span className="text-slate-800 dark:text-slate-200" style={{ fontSize: 13, fontWeight: 600 }}>{recipient}</span>
              </div>
            )}
            {description && (
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className="text-slate-400" style={{ fontSize: 12 }}>Note</span>
                <span className="text-slate-600 dark:text-slate-400" style={{ fontSize: 13, maxWidth: 200, textAlign: "right" }}>{description}</span>
              </div>
            )}
          </div>
        )}

        {/* PIN entry area */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "0 24px" }}>
          <p className="text-slate-500" style={{ fontSize: 13, textAlign: "center" }}>
            Enter your transaction PIN to confirm
          </p>

          {/* Dots / verifying spinner */}
          {verifying ? (
            <div style={{ height: 24, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ width: 22, height: 22, border: "3px solid #e2e8f0", borderTopColor: "#3DA829", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          ) : (
            <PinDots filled={pin.length} className={shake ? "txn-pin-shake" : ""} />
          )}

          {/* Error */}
          <div style={{ height: 16, marginTop: -8 }}>
            {error && (
              <p className="text-red-500 dark:text-red-400" style={{ fontSize: 12, fontWeight: 600, textAlign: "center" }}>
                {error}
              </p>
            )}
          </div>

          {/* Keypad */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, width: "100%", maxWidth: 280 }}>
            {PAD.map(n => (
              <button key={n} onClick={() => handleDigit(String(n))}
                className="h-14 rounded-[14px] bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 text-slate-900 dark:text-slate-100 text-[19px] font-bold cursor-pointer transition-all duration-100">
                {n}
              </button>
            ))}

            {/* Empty slot */}
            <div />

            <button onClick={() => handleDigit("0")}
              className="h-14 rounded-[14px] bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 text-slate-900 dark:text-slate-100 text-[19px] font-bold cursor-pointer transition-all duration-100">
              0
            </button>

            <button onClick={handleDelete}
              className="h-14 rounded-[14px] bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 text-slate-600 dark:text-slate-400 cursor-pointer flex items-center justify-center transition-all duration-100">
              <BackspaceIcon />
            </button>
          </div>

          {/* Cancel */}
          <button onClick={onCancel}
            className="bg-transparent border-0 text-slate-400 text-sm cursor-pointer px-6 py-2 mb-1">
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
