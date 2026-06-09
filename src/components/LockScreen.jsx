import { useState } from "react";
import { supabase } from "../utils/supabase";

const FingerprintIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7" stroke="currentColor"
    strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12a10 10 0 0120 0" />
    <path d="M5.5 12a6.5 6.5 0 0113 0" />
    <path d="M9 12a3 3 0 016 0" />
    <path d="M12 12v5" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
  </svg>
);

const BackspaceIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor"
    strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z" />
    <line x1="18" y1="9" x2="13" y2="14" />
    <line x1="13" y1="9" x2="18" y2="14" />
  </svg>
);

export default function LockScreen({ lock, businessName }) {
  const { hasBiometric, bioAvailable, unlockWithPIN, unlockWithBiometric } = lock;

  const [pin,        setPin]        = useState("");
  const [error,      setError]      = useState("");
  const [bioLoading, setBioLoading] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const showBio = hasBiometric && bioAvailable;

  const handleDigit = (d) => {
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    setError("");
    if (next.length === 4) {
      unlockWithPIN(next).then(ok => {
        if (!ok) {
          setPin("");
          setError("Incorrect PIN. Please try again.");
        }
      });
    }
  };

  const handleDelete = () => {
    setPin(p => p.slice(0, -1));
    setError("");
  };

  const handleBiometric = async () => {
    if (bioLoading) return;
    setBioLoading(true);
    setError("");
    const ok = await unlockWithBiometric();
    setBioLoading(false);
    if (!ok) setError("Biometric failed. Use your PIN instead.");
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    await supabase?.auth.signOut();
  };

  const PAD = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  return (
    <div className="fixed inset-0 z-[100] bg-slate-900 flex flex-col items-center justify-between select-none"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>

      {/* ── Top ── */}
      <div className="flex flex-col items-center gap-3 pt-14">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-lg">
          <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 text-white"
            stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-xl font-extrabold text-white leading-tight">
            {businessName || "KudiAI Track"}
          </p>
          <p className="text-sm text-slate-400 mt-1">
            {showBio ? "Enter PIN or use biometric" : "Enter your PIN to continue"}
          </p>
        </div>
      </div>

      {/* ── Middle: dots + pad ── */}
      <div className="flex flex-col items-center gap-8 w-full max-w-[280px] mx-auto">

        {/* PIN dots */}
        <div className="flex gap-5">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className={`w-4 h-4 rounded-full border-2 transition-all duration-150 ${
              pin.length > i
                ? "bg-brand-500 border-brand-500 scale-110"
                : "border-slate-600 bg-transparent"
            }`} />
          ))}
        </div>

        {/* Error message */}
        <div className="h-4 -mt-4">
          {error && (
            <p className="text-xs font-semibold text-red-400 text-center">{error}</p>
          )}
        </div>

        {/* Number pad */}
        <div className="grid grid-cols-3 gap-3 w-full">
          {PAD.map(n => (
            <button key={n} onClick={() => handleDigit(String(n))}
              className="h-16 rounded-2xl bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-white text-xl font-bold transition-all active:scale-95 focus-visible:outline-none">
              {n}
            </button>
          ))}

          {/* Biometric / empty */}
          <button
            onClick={showBio ? handleBiometric : undefined}
            disabled={!showBio || bioLoading}
            className={`h-16 rounded-2xl flex items-center justify-center transition-all active:scale-95 focus-visible:outline-none ${
              showBio
                ? "bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-white"
                : "bg-transparent cursor-default"
            }`}>
            {showBio && (
              bioLoading
                ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : <FingerprintIcon />
            )}
          </button>

          <button onClick={() => handleDigit("0")}
            className="h-16 rounded-2xl bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-white text-xl font-bold transition-all active:scale-95 focus-visible:outline-none">
            0
          </button>

          <button onClick={handleDelete}
            className="h-16 rounded-2xl bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-white flex items-center justify-center transition-all active:scale-95 focus-visible:outline-none">
            <BackspaceIcon />
          </button>
        </div>
      </div>

      {/* ── Bottom: forgot ── */}
      <div className="pb-8 flex flex-col items-center gap-3">
        {showBio && (
          <p className="text-[11px] text-slate-500 text-center px-6">
            Tip: Tap the fingerprint icon above to use face or fingerprint unlock
          </p>
        )}
        <button onClick={handleSignOut} disabled={signingOut}
          className="text-sm text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-50">
          {signingOut ? "Signing out…" : "Forgot PIN? Sign out"}
        </button>
      </div>
    </div>
  );
}
