import { useState } from "react";
import { sha256, LS_PIN_HASH, LS_CRED_ID } from "../hooks/useBiometricLock";
import { fmt } from "../utils/helpers";

const BackspaceIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor"
    strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z" />
    <line x1="18" y1="9" x2="13" y2="14" /><line x1="13" y1="9" x2="18" y2="14" />
  </svg>
);

const FingerprintIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6" stroke="currentColor"
    strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12a10 10 0 0120 0" />
    <path d="M5.5 12a6.5 6.5 0 0113 0" />
    <path d="M9 12a3 3 0 016 0" />
    <path d="M12 12v5" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
  </svg>
);

async function verifyBiometric() {
  const credId = localStorage.getItem(LS_CRED_ID);
  if (!credId) return false;
  try {
    const b64 = credId.replace(/-/g, "+").replace(/_/g, "/");
    await navigator.credentials.get({
      publicKey: {
        challenge:        crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: "public-key", id: Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer, transports: ["internal"] }],
        userVerification: "required",
        timeout:          60000,
      },
    });
    return true;
  } catch {
    return false;
  }
}

async function checkBioAvailable() {
  try { return !!(await window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.()); }
  catch { return false; }
}

const PAD = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export default function TransactionPinModal({ amount, label = "payment", onConfirm, onCancel }) {
  const [pin,        setPin]        = useState("");
  const [error,      setError]      = useState("");
  const [bioLoading, setBioLoading] = useState(false);

  const hasCred    = !!localStorage.getItem(LS_CRED_ID);
  const [bioAvail] = useState(() => {
    // sync guess — will show bio button if credential stored
    return hasCred;
  });

  const handleDigit = async (d) => {
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    setError("");
    if (next.length === 4) {
      const entered = await sha256(next);
      const stored  = localStorage.getItem(LS_PIN_HASH);
      if (entered === stored) {
        onConfirm();
      } else {
        setPin("");
        setError("Incorrect PIN. Please try again.");
      }
    }
  };

  const handleBio = async () => {
    if (bioLoading) return;
    setBioLoading(true);
    setError("");
    const platformOk = await checkBioAvailable();
    if (!platformOk) { setBioLoading(false); setError("Biometric not available on this device."); return; }
    const ok = await verifyBiometric();
    setBioLoading(false);
    if (ok) { onConfirm(); } else { setError("Biometric failed. Enter your PIN instead."); }
  };

  return (
    /* Backdrop */
    <div className="fixed inset-0 z-[90] flex items-end justify-center" style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>

      {/* Sheet */}
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-t-3xl pb-safe select-none"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 24px)" }}>

        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-slate-200 dark:bg-slate-700" />
        </div>

        {/* Amount header */}
        <div className="px-6 pt-4 pb-5 text-center border-b border-slate-100 dark:border-slate-800">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Authorize {label}</p>
          {amount > 0
            ? <p className="text-3xl font-extrabold text-slate-900 dark:text-white">{fmt(amount)}</p>
            : <p className="text-xl font-extrabold text-green-600 dark:text-green-400">Free Transaction</p>
          }
          <p className="text-xs text-slate-400 mt-1">Enter your PIN to confirm</p>
        </div>

        <div className="px-6 pt-5 pb-3">
          {/* PIN dots */}
          <div className="flex justify-center gap-5 mb-2">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className={`w-3.5 h-3.5 rounded-full border-2 transition-all duration-150 ${
                pin.length > i
                  ? "bg-brand-600 border-brand-600 scale-110"
                  : "border-slate-300 dark:border-slate-600"
              }`} />
            ))}
          </div>

          {/* Error */}
          <div className="h-5 flex items-center justify-center mb-3">
            {error && <p className="text-xs font-semibold text-red-500">{error}</p>}
          </div>

          {/* Number pad */}
          <div className="grid grid-cols-3 gap-2.5">
            {PAD.map(n => (
              <button key={n} onClick={() => handleDigit(String(n))}
                className="h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:bg-slate-300 dark:active:bg-slate-600 text-slate-900 dark:text-white text-xl font-bold transition-all active:scale-95 focus-visible:outline-none">
                {n}
              </button>
            ))}

            {/* Biometric or empty */}
            <button
              onClick={bioAvail ? handleBio : undefined}
              disabled={!bioAvail || bioLoading}
              className={`h-14 rounded-2xl flex items-center justify-center transition-all active:scale-95 focus-visible:outline-none ${
                bioAvail
                  ? "bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300"
                  : "bg-transparent cursor-default"
              }`}>
              {bioAvail && (
                bioLoading
                  ? <div className="w-5 h-5 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
                  : <FingerprintIcon />
              )}
            </button>

            <button onClick={() => handleDigit("0")}
              className="h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:bg-slate-300 text-slate-900 dark:text-white text-xl font-bold transition-all active:scale-95 focus-visible:outline-none">
              0
            </button>

            <button onClick={() => { setPin(p => p.slice(0, -1)); setError(""); }}
              className="h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center transition-all active:scale-95 focus-visible:outline-none">
              <BackspaceIcon />
            </button>
          </div>

          {/* Cancel */}
          <button onClick={onCancel}
            className="w-full mt-4 py-3 text-sm font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
