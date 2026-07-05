import { useState, useCallback } from "react";
import ForgotPinFlow from "./ForgotPinFlow";

const shakeCSS = `
@keyframes shake {
  0%,100% { transform: translateX(0); }
  20%,60%  { transform: translateX(-6px); }
  40%,80%  { transform: translateX(6px); }
}
.pin-shake { animation: shake 0.5s ease; }
`;

const ShieldIcon = () => (
  <svg viewBox="0 0 24 24" width="40" height="40" fill="#3DA829">
    <path d="M12 3L4 7v5c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V7z"
      stroke="#0f1c45" strokeWidth="1" />
  </svg>
);

const FingerprintIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" width="22" height="22" stroke="currentColor"
    strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12a10 10 0 0120 0" />
    <path d="M5.5 12a6.5 6.5 0 0113 0" />
    <path d="M9 12a3 3 0 016 0" />
    <path d="M12 12v5" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
  </svg>
);

const BackspaceIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" width="20" height="20" stroke="currentColor"
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

export default function LockScreen({ pinLock, businessName, isDeviceVerify = false }) {
  const maxLen = isDeviceVerify ? 4 : 6;

  const [pin,            setPin]            = useState("");
  const [error,          setError]          = useState("");
  const [shake,          setShake]          = useState(false);
  const [bioLoading,     setBioLoading]     = useState(false);
  const [signingOut,     setSigningOut]     = useState(false);
  const [showForgotPin,  setShowForgotPin]  = useState(false);
  const [requiresReauth, setRequiresReauth] = useState(
    () => !!pinLock?.status?.requiresReauth
  );

  const triggerShake = useCallback(() => {
    setShake(true);
    setTimeout(() => setShake(false), 600);
  }, []);

  const handleVerify = useCallback(async (enteredPin) => {
    try {
      let result;
      if (isDeviceVerify) {
        result = await pinLock.verifyTxnPin(enteredPin);
      } else {
        result = await pinLock.verifyAppPin(enteredPin);
      }

      const d = result?.data;

      if (d?.success) {
        if (isDeviceVerify) {
          pinLock.completeDeviceVerification();
        }
        setPin("");
        setError("");
        return;
      }

      // Error path
      triggerShake();
      setPin("");

      if (d?.requiresReauth) {
        setRequiresReauth(true);
        return;
      }
      if (d?.locked) {
        setError(computeLockedMsg(d));
        return;
      }
      const left = d?.attemptsLeft ?? "";
      setError(`Incorrect PIN.${left ? ` ${left} attempt${left === 1 ? "" : "s"} remaining.` : ""}`);
    } catch {
      triggerShake();
      setPin("");
      setError("Something went wrong. Try again.");
    }
  }, [pinLock, isDeviceVerify, triggerShake]);

  const handleDigit = useCallback((d) => {
    if (pin.length >= maxLen) return;
    const next = pin + d;
    setPin(next);
    setError("");
    if (next.length === maxLen) {
      setTimeout(() => handleVerify(next), 150);
    }
  }, [pin, maxLen, handleVerify]);

  const handleDelete = useCallback(() => {
    setPin(p => p.slice(0, -1));
    setError("");
  }, []);

  const handleBiometric = async () => {
    if (bioLoading) return;
    setBioLoading(true);
    setError("");
    const ok = await pinLock.unlockWithBiometric();
    setBioLoading(false);
    if (!ok) setError("Biometric failed. Use your PIN instead.");
  };

  const handleForgotPin = () => setShowForgotPin(true);

  const handleSignOut = async () => {
    setSigningOut(true);
    const { supabase } = await import("../utils/supabase");
    await supabase?.auth.signOut();
  };

  const showBio = pinLock?.biometricEnabled && pinLock?.biometricAvailable && !isDeviceVerify;

  const PAD = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  // ── Forgot PIN flow ────────────────────────────────────────────────
  if (showForgotPin) {
    return <ForgotPinFlow pinLock={pinLock} onCancel={() => setShowForgotPin(false)} />;
  }

  // ── Reauth / account-locked state ─────────────────────────────────
  if (requiresReauth) {
    return (
      <div style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.85)",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: "24px",
      }}>
        <div style={{
          background: "#1e293b", borderRadius: 24, padding: "32px 24px",
          maxWidth: 320, width: "100%", textAlign: "center",
        }}>
          <p style={{ color: "#f87171", fontSize: 20, fontWeight: 700, marginBottom: 12 }}>
            Account Locked
          </p>
          <p style={{ color: "rgba(255,255,255,0.65)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
            Too many failed attempts. Please sign out and sign in again to continue.
          </p>
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            style={{
              background: "#ef4444", color: "white", border: "none",
              borderRadius: 12, padding: "14px 24px", fontWeight: 700,
              fontSize: 14, cursor: "pointer", width: "100%", opacity: signingOut ? 0.6 : 1,
            }}
          >
            {signingOut ? "Signing out…" : "Sign Out"}
          </button>
        </div>
      </div>
    );
  }

  // ── Normal lock screen ─────────────────────────────────────────────
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "#0f1c45",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "space-between",
      paddingTop: "env(safe-area-inset-top, 0px)",
      paddingBottom: "env(safe-area-inset-bottom, 0px)",
      userSelect: "none",
    }}>
      <style>{shakeCSS}</style>

      {/* Top: logo + title */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, paddingTop: 64 }}>
        <ShieldIcon />
        <div style={{ textAlign: "center", padding: "0 24px" }}>
          <p style={{ color: "white", fontSize: 20, fontWeight: 700, lineHeight: 1.3 }}>
            {isDeviceVerify
              ? "Verify Your Identity"
              : `Welcome back${businessName ? ", " + businessName : ""}`}
          </p>
          <p style={{ color: "rgba(255,255,255,0.6)", fontSize: 13, marginTop: 6 }}>
            {isDeviceVerify
              ? "Enter your transaction PIN to trust this device"
              : "Enter your app lock PIN to continue"}
          </p>
        </div>
      </div>

      {/* Middle: dots + keypad */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 32, width: "100%", maxWidth: 280 }}>

        {/* Dots */}
        <div
          className={shake ? "pin-shake" : ""}
          style={{ display: "flex", gap: 20, justifyContent: "center" }}
        >
          {Array.from({ length: maxLen }).map((_, i) => (
            <div key={i} style={{
              width: 16, height: 16, borderRadius: "50%",
              border: "2px solid",
              borderColor: pin.length > i ? "#3DA829" : "rgba(255,255,255,0.2)",
              background: pin.length > i ? "#3DA829" : "transparent",
              transition: "all 0.15s",
              transform: pin.length > i ? "scale(1.1)" : "scale(1)",
            }} />
          ))}
        </div>

        {/* Error */}
        <div style={{ height: 18, marginTop: -20 }}>
          {error && (
            <p style={{ color: "rgba(248,113,113,0.9)", fontSize: 12, fontWeight: 600, textAlign: "center" }}>
              {error}
            </p>
          )}
        </div>

        {/* Keypad */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, width: "100%" }}>
          {PAD.map(n => (
            <button key={n} onClick={() => handleDigit(String(n))}
              style={{
                height: 64, borderRadius: 18,
                background: "rgba(255,255,255,0.08)", border: "none",
                color: "white", fontSize: 20, fontWeight: 700,
                cursor: "pointer", transition: "transform 0.1s, background 0.1s",
              }}
              onMouseDown={e => e.currentTarget.style.transform = "scale(0.95)"}
              onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}
              onTouchStart={e => e.currentTarget.style.background = "rgba(255,255,255,0.15)"}
              onTouchEnd={e => e.currentTarget.style.background = "rgba(255,255,255,0.08)"}
            >
              {n}
            </button>
          ))}

          {/* Biometric or empty */}
          <button
            onClick={showBio ? handleBiometric : undefined}
            disabled={!showBio || bioLoading}
            style={{
              height: 64, borderRadius: 18,
              background: showBio ? "rgba(255,255,255,0.08)" : "transparent",
              border: "none", color: "white",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: showBio ? "pointer" : "default",
              opacity: !showBio ? 0 : 1,
            }}
          >
            {showBio && (
              bioLoading
                ? <div style={{ width: 20, height: 20, border: "2px solid white", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                : <FingerprintIcon />
            )}
          </button>

          <button onClick={() => handleDigit("0")}
            style={{
              height: 64, borderRadius: 18,
              background: "rgba(255,255,255,0.08)", border: "none",
              color: "white", fontSize: 20, fontWeight: 700,
              cursor: "pointer", transition: "transform 0.1s",
            }}
            onMouseDown={e => e.currentTarget.style.transform = "scale(0.95)"}
            onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}
          >
            0
          </button>

          <button onClick={handleDelete}
            style={{
              height: 64, borderRadius: 18,
              background: "rgba(255,255,255,0.08)", border: "none",
              color: "white", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "transform 0.1s",
            }}
            onMouseDown={e => e.currentTarget.style.transform = "scale(0.95)"}
            onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}
          >
            <BackspaceIcon />
          </button>
        </div>
      </div>

      {/* Bottom: biometric tip + forgot PIN */}
      <div style={{ paddingBottom: 32, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        {showBio && (
          <p style={{ color: "rgba(255,255,255,0.3)", fontSize: 11, textAlign: "center", padding: "0 24px" }}>
            Tap the fingerprint icon above to use face or fingerprint unlock
          </p>
        )}
        {!isDeviceVerify && (
          <button onClick={handleForgotPin}
            style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", fontSize: 13, cursor: "pointer" }}>
            Forgot PIN?
          </button>
        )}
      </div>
    </div>
  );
}
